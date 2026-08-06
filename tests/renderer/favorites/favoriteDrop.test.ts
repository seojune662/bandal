import { describe, expect, test } from 'vitest'
import type { TabDescriptor } from '../../../src/shared/tabs'
import {
  descriptorFromDrop,
  descriptorFromExternalUrl,
  FAVORITE_TAB_MIME,
  moveFavoriteBefore,
  moveFavoriteToEnd,
  parseFavoriteDragPayload,
  serializeFavoriteMaterialDrag,
  serializeFavoriteTabDrag
} from '../../../src/renderer/src/features/courses/favoriteDrop'

const pdf: TabDescriptor = {
  kind: 'pdf',
  payload: { courseId: 'c1', relPath: 'slides/week.pdf' }
}

function transfer(data: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? ''
  } as DataTransfer
}

describe('favorite drag payload', () => {
  test('round-trips the canonical versioned tab payload', () => {
    const raw = serializeFavoriteTabDrag(pdf)

    expect(JSON.parse(raw)).toEqual({ version: 1, descriptor: pdf })
    expect(parseFavoriteDragPayload(raw)).toEqual(pdf)
  })

  test('classifies PDF and Markdown material payloads by extension', () => {
    expect(
      parseFavoriteDragPayload(
        serializeFavoriteMaterialDrag('c1', '자료/LECTURE.PDF')
      )
    ).toEqual({
      kind: 'pdf',
      payload: { courseId: 'c1', relPath: '자료/LECTURE.PDF' }
    })
    expect(
      parseFavoriteDragPayload(
        serializeFavoriteMaterialDrag('c1', 'notes/week.markdown')
      )
    ).toEqual({
      kind: 'note',
      payload: { courseId: 'c1', relPath: 'notes/week.markdown' }
    })
    expect(
      parseFavoriteDragPayload(
        serializeFavoriteMaterialDrag('c1', 'images/diagram.png')
      )
    ).toBeNull()
  })

  test('rejects corrupt JSON, unknown versions, and malformed descriptors', () => {
    expect(parseFavoriteDragPayload('{broken')).toBeNull()
    expect(
      parseFavoriteDragPayload(
        JSON.stringify({ version: 2, descriptor: pdf })
      )
    ).toBeNull()
    expect(
      parseFavoriteDragPayload(
        JSON.stringify({
          version: 1,
          descriptor: { kind: 'pdf', payload: { courseId: 'c1' } }
        })
      )
    ).toBeNull()
  })

  test('accepts external http(s) URLs and rejects unsafe schemes', () => {
    const descriptor = descriptorFromExternalUrl(
      '# browser comment\nhttps://example.com/lecture?id=3'
    )

    expect(descriptor?.kind).toBe('browser')
    expect(descriptor?.payload).toMatchObject({
      initialUrl: 'https://example.com/lecture?id=3'
    })
    expect(descriptorFromExternalUrl('javascript:alert(1)')).toBeNull()
    expect(descriptorFromExternalUrl('not a url')).toBeNull()
  })

  test('prefers the Bandal custom MIME and falls back to uri-list', () => {
    expect(
      descriptorFromDrop(
        transfer({
          [FAVORITE_TAB_MIME]: serializeFavoriteTabDrag(pdf),
          'text/uri-list': 'https://example.com/'
        })
      )
    ).toEqual(pdf)

    expect(
      descriptorFromDrop(
        transfer({ 'text/uri-list': 'https://example.com/course' })
      )?.kind
    ).toBe('browser')
  })

  test('moves existing favorite ids without losing list members', () => {
    expect(moveFavoriteBefore(['a', 'b', 'c'], 'c', 'a')).toEqual([
      'c',
      'a',
      'b'
    ])
    expect(moveFavoriteBefore(['a', 'b', 'c'], 'missing', 'a')).toEqual([
      'a',
      'b',
      'c'
    ])
    expect(moveFavoriteToEnd(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
  })
})
