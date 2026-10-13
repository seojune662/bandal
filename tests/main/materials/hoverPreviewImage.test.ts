import { readFile, mkdtemp, writeFile, rm, truncate } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, expect, test, vi } from 'vitest'
import { hoverImageContent, hoverImageDimensions, HOVER_IMAGE_BYTES } from '../../../src/main/features/materials/hoverPreviewImage'
import { extractMaterialHoverPreview } from '../../../src/main/features/materials/hoverPreviewExtract'
import { createMaterialHoverPreviewService } from '../../../src/main/features/materials/hoverPreview'
import JSZip from 'jszip'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }))
const folder = await mkdtemp(join(tmpdir(), 'bandal-hover-image-'))
afterAll(async () => { await rm(folder, { recursive: true, force: true }) })

function png(width: number, height: number): Buffer {
  const data = Buffer.alloc(33)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data)
  data.writeUInt32BE(13, 8); data.write('IHDR', 12)
  data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20)
  return data
}
function box(kind: string, body: Buffer): Buffer {
  const data = Buffer.alloc(8 + body.length)
  data.writeUInt32BE(data.length); data.write(kind, 4); body.copy(data, 8)
  return data
}
function ispe(width: number, height: number): Buffer {
  const data = Buffer.alloc(12); data.writeUInt32BE(width, 4); data.writeUInt32BE(height, 8)
  return box('ispe', data)
}

test('raster bytes are validated before any renderer decoder sees them', async () => {
  const source = await readFile(resolve('resources/icon.png'))
  expect(hoverImageContent(source, '.png')).toMatchObject({ kind: 'image', width: 512, height: 512 })
  const content = hoverImageContent(png(20000, 20000), '.png')
  expect(content).toMatchObject({ kind: 'unsupported', reason: 'too-large' })
  expect(hoverImageContent(png(0, 100), '.png')).toMatchObject({ kind: 'unsupported', reason: 'unreadable' })
  expect(hoverImageContent(Buffer.alloc(HOVER_IMAGE_BYTES + 1), '.jpg')).toMatchObject({ kind: 'unsupported', reason: 'too-large' })
  expect(hoverImageContent(Buffer.from('not an image at all'), '.png')).toMatchObject({ kind: 'unsupported', reason: 'unreadable' })
})

test('JPEG dimensions include EXIF rotation before the renderer requests resized decode', () => {
  const exif = Buffer.alloc(32)
  exif.write('Exif\0\0'); exif.write('II', 6); exif.writeUInt16LE(42, 8); exif.writeUInt32LE(8, 10)
  exif.writeUInt16LE(1, 14); exif.writeUInt16LE(0x112, 16); exif.writeUInt16LE(3, 18)
  exif.writeUInt32LE(1, 20); exif.writeUInt16LE(6, 24)
  const app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(exif.length + 2, 2)
  const frame = Buffer.from([0xff, 0xc0, 0, 8, 8, 0, 100, 0, 200, 0])
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exif, frame, Buffer.from([0xff, 0xda, 0, 2])])
  expect(hoverImageDimensions(jpeg, '.jpg')).toEqual({ mime: 'image/jpeg', width: 100, height: 200 })
})

test('GIF subframes, WebP bitstreams and BMP dimensions cannot bypass the pixel budget', () => {
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
  expect(hoverImageDimensions(gif, '.gif')).toMatchObject({ width: 1, height: 1 })
  const frame = gif.indexOf(0x2c, 13)
  const hugeFrame = Buffer.from(gif); hugeFrame.writeUInt16LE(60000, frame + 5)
  expect(hoverImageContent(hugeFrame, '.gif')).toMatchObject({ kind: 'unsupported', reason: 'too-large' })
  const webp = Buffer.alloc(30)
  webp.write('RIFF'); webp.writeUInt32LE(22, 4); webp.write('WEBPVP8X', 8); webp.writeUInt32LE(10, 16)
  webp.writeUIntLE(99, 24, 3); webp.writeUIntLE(49, 27, 3)
  expect(hoverImageDimensions(webp, '.webp')).toMatchObject({ width: 100, height: 50 })
  webp.writeUIntLE(20000, 24, 3)
  expect(hoverImageContent(webp, '.webp')).toMatchObject({ kind: 'unsupported', reason: 'too-large' })
  const bmp = Buffer.alloc(54)
  bmp.write('BM'); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(100, 18); bmp.writeInt32LE(-50, 22)
  expect(hoverImageDimensions(bmp, '.bmp')).toMatchObject({ width: 100, height: 50 })
})

test('AVIF/HEIC check every image property, not just an embedded tiny cover', () => {
  const make = (huge: boolean): Buffer => Buffer.concat([
    box('ftyp', Buffer.from('avif\0\0\0\0avif')),
    box('meta', Buffer.concat([Buffer.alloc(4), box('iprp', box('ipco', Buffer.concat([ispe(64, 64), ispe(huge ? 50000 : 400, 300)])))]))
  ])
  expect(hoverImageDimensions(make(false), '.avif')).toMatchObject({ width: 400, height: 300 })
  expect(hoverImageContent(make(true), '.heic')).toMatchObject({ kind: 'unsupported', reason: 'too-large' })
})

test('simple SVG is bounded; active, externally referenced and styled SVG never reaches decode', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 20"><path d="M0 0L24 20" /></svg>'
  expect(hoverImageContent(Buffer.from(svg), '.svg')).toMatchObject({ kind: 'image', width: 24, height: 20 })
  for (const body of ['<script/>', '<image href="https://example.test/image"/>', '<g style="filter:blur(100px)"/>', '<s:foreignObject/>']) {
    expect(hoverImageContent(Buffer.from(`<svg width="24" height="20">${body}</svg>`), '.svg')).toMatchObject({ kind: 'unsupported' })
  }
})

test('image service returns immutable validated bytes and skips oversized sources before extraction', async () => {
  const path = join(folder, 'safe.png')
  const bytes = await readFile(resolve('resources/icon.png'))
  await writeFile(path, bytes)
  const read = vi.fn(extractMaterialHoverPreview)
  const service = createMaterialHoverPreviewService({ materials: { absolutePathForAsync: async () => path }, userData: folder, extractor: { read, dispose: vi.fn() } })
  try {
    const result = await service.read({ courseId: 'course', relPath: 'safe.png' })
    expect(result.content).toMatchObject({ kind: 'image', sourceDataUrl: `data:image/png;base64,${bytes.toString('base64')}` })
    await truncate(path, HOVER_IMAGE_BYTES + 1)
    expect((await service.read({ courseId: 'course', relPath: 'safe.png' })).content).toMatchObject({ kind: 'unsupported', reason: 'too-large' })
    expect(read).toHaveBeenCalledOnce()
  } finally { service.dispose() }
})

test('compressed large-pixel Office thumbnail falls back to bounded slide text', async () => {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', '<p:sldId r:id="first"/>')
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationship Id="first" Target="slides/slide1.xml"/>')
  zip.file('ppt/slides/slide1.xml', '<a:p><a:t>미리보기 본문</a:t></a:p>')
  zip.file('docProps/thumbnail.png', png(2000, 2000))
  const path = join(folder, 'cover.pptx')
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  const result = await extractMaterialHoverPreview({ absolutePath: path, extension: '.pptx', userData: folder })
  expect(result).toEqual({ kind: 'slides', text: '미리보기 본문', slideCount: 1, truncated: false })
})
