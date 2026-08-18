import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import {
  createMediaProtocolHandler,
  mediaContentTypeFor,
  parseMediaUrl,
  parseRangeHeader
} from '../../src/main/features/materials/mediaProtocol'
import { mediaUrlFor } from '../../src/renderer/src/features/materials/mediaUrl'

describe('parseMediaUrl', () => {
  test('parses course id and nested rel path', () => {
    expect(
      parseMediaUrl('bandal-media://material/course-1/week1/lecture.mp4')
    ).toEqual({ courseId: 'course-1', relPath: 'week1/lecture.mp4' })
  })

  test('decodes each segment once (Korean file names)', () => {
    const url = `bandal-media://material/course-1/${encodeURIComponent('강의 1')}/${encodeURIComponent('1주차 녹화.mp4')}`
    expect(parseMediaUrl(url)).toEqual({
      courseId: 'course-1',
      relPath: '강의 1/1주차 녹화.mp4'
    })
  })

  test('round-trips with mediaUrlFor', () => {
    const url = mediaUrlFor('course-1', '강의/2주차 #복습.webm')
    expect(parseMediaUrl(url)).toEqual({
      courseId: 'course-1',
      relPath: '강의/2주차 #복습.webm'
    })
  })

  test('rejects traversal, separators and empty segments', () => {
    expect(
      parseMediaUrl('bandal-media://material/course-1/..%2Fsecret.mp4')
    ).toBeNull()
    expect(parseMediaUrl('bandal-media://material/course-1/%2E%2E')).toBeNull()
    expect(parseMediaUrl('bandal-media://material/course-1/a.mp4/')).toBeNull()
    expect(
      parseMediaUrl('bandal-media://material/course-1/a%5Cb.mp4')
    ).toBeNull()
  })

  test('rejects wrong scheme, wrong host, missing parts and malformed input', () => {
    expect(parseMediaUrl('https://material/course-1/a.mp4')).toBeNull()
    expect(parseMediaUrl('bandal-media://other/course-1/a.mp4')).toBeNull()
    expect(parseMediaUrl('bandal-media://material/course-1')).toBeNull()
    expect(parseMediaUrl('bandal-media://material/course-1/%zz.mp4')).toBeNull()
    expect(parseMediaUrl('not a url')).toBeNull()
  })
})

describe('parseRangeHeader', () => {
  test('parses bounded, open-ended and suffix ranges', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({
      start: 500,
      end: 999
    })
    expect(parseRangeHeader('bytes=-100', 1000)).toEqual({
      start: 900,
      end: 999
    })
  })

  test('clamps an end beyond the file size', () => {
    expect(parseRangeHeader('bytes=900-5000', 1000)).toEqual({
      start: 900,
      end: 999
    })
  })

  test('falls back to null (full response) for invalid or unsatisfiable input', () => {
    expect(parseRangeHeader(null, 1000)).toBeNull()
    expect(parseRangeHeader('bytes=0-99', 0)).toBeNull()
    expect(parseRangeHeader('bytes=1000-', 1000)).toBeNull()
    expect(parseRangeHeader('bytes=9-5', 1000)).toBeNull()
    expect(parseRangeHeader('bytes=-0', 1000)).toBeNull()
    expect(parseRangeHeader('bytes=-', 1000)).toBeNull()
    expect(parseRangeHeader('bytes=0-1,5-9', 1000)).toBeNull()
    expect(parseRangeHeader('items=0-99', 1000)).toBeNull()
  })
})

describe('mediaContentTypeFor', () => {
  test('maps media extensions and defaults to octet-stream', () => {
    expect(mediaContentTypeFor('week1/lecture.MP4')).toBe('video/mp4')
    expect(mediaContentTypeFor('a.m4v')).toBe('video/mp4')
    expect(mediaContentTypeFor('a.webm')).toBe('video/webm')
    expect(mediaContentTypeFor('figure.png')).toBe('image/png')
    expect(mediaContentTypeFor('archive.zip')).toBe('application/octet-stream')
  })
})

describe('createMediaProtocolHandler', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bandal-media-test-'))
  const filePath = join(dir, 'lecture.mp4')
  const bytes = Buffer.from('0123456789abcdef')
  writeFileSync(filePath, bytes)

  const handler = createMediaProtocolHandler({
    absolutePathFor: (courseId, relPath) => {
      if (courseId !== 'course-1' || relPath !== 'lecture.mp4') {
        throw new Error('path guard')
      }
      return filePath
    }
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('serves the whole file with 200 when no Range is sent', async () => {
    const response = await handler(
      new Request('bandal-media://material/course-1/lecture.mp4')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect(response.headers.get('Content-Length')).toBe(String(bytes.length))
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
  })

  test('serves a 206 partial response for a Range request', async () => {
    const response = await handler(
      new Request('bandal-media://material/course-1/lecture.mp4', {
        headers: { range: 'bytes=4-7' }
      })
    )

    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(
      `bytes 4-7/${bytes.length}`
    )
    expect(response.headers.get('Content-Length')).toBe('4')
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('4567')
  })

  test('returns 404 when the path guard rejects', async () => {
    const response = await handler(
      new Request('bandal-media://material/course-2/lecture.mp4')
    )
    expect(response.status).toBe(404)
  })

  test('returns 404 for an unparseable URL', async () => {
    const response = await handler(
      new Request('bandal-media://material/course-1')
    )
    expect(response.status).toBe(404)
  })

  test('returns 404 when the file does not exist on disk', async () => {
    const missing = createMediaProtocolHandler({
      absolutePathFor: () => join(dir, 'missing.mp4')
    })
    const response = await missing(
      new Request('bandal-media://material/course-1/lecture.mp4')
    )
    expect(response.status).toBe(404)
  })
})
