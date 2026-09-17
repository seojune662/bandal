// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PptxPresentation } from '@silurus/ooxml/pptx'
import { SlideRenderCache } from '../../../src/renderer/src/features/file/pptx/slideRenderCache'

const caches: SlideRenderCache[] = []
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
})
afterEach(() => { caches.forEach((cache) => cache.dispose()); caches.length = 0; vi.restoreAllMocks() })
const signal = (): AbortSignal => new AbortController().signal
function make(render: ReturnType<typeof vi.fn>, budget?: number): SlideRenderCache {
  const cache = new SlideRenderCache({ renderSlideToBitmap: render } as unknown as PptxPresentation, budget)
  caches.push(cache)
  return cache
}
const bitmap = () => ({ width: 100, height: 75, close: vi.fn() })

test('deduplicates pending requests and reuses completed pixels on page return', async () => {
  const image = bitmap()
  const render = vi.fn(async () => image)
  const cache = make(render)
  const first = cache.render(0, 100, 1, signal())
  const second = cache.render(0, 100, 1, signal())
  expect(await first).toBe(await second)
  expect(await cache.render(0, 100, 1, signal())).toBe(await first)
  expect(render).toHaveBeenCalledTimes(1)
  expect(image.close).toHaveBeenCalledOnce()
})

test('evicts old pixels at its byte budget and retries failed renders', async () => {
  const render = vi.fn(async () => bitmap())
  const cache = make(render, 30_000)
  await cache.render(0, 100, 1, signal())
  await cache.render(1, 100, 1, signal())
  await cache.render(0, 100, 1, signal())
  expect(render).toHaveBeenCalledTimes(3)
  render.mockRejectedValueOnce(new Error('temporary failure'))
  await expect(cache.render(2, 100, 1, signal())).rejects.toThrow('temporary failure')
  await expect(cache.render(2, 100, 1, signal())).resolves.toHaveProperty('canvas')
})

test('skips obsolete queued pages and closes late bitmaps after disposal', async () => {
  let resolveFirst!: (value: ReturnType<typeof bitmap>) => void
  let resolveSecond!: (value: ReturnType<typeof bitmap>) => void
  const render = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
  const cache = make(render)
  const first = cache.render(0, 100, 1, signal()).catch((error) => error)
  const second = cache.render(1, 100, 1, signal()).catch((error) => error)
  const abort = new AbortController()
  const queued = cache.render(2, 100, 1, abort.signal).catch((error) => error)
  abort.abort()
  expect(render).toHaveBeenCalledTimes(2)
  cache.dispose()
  const a = bitmap(), b = bitmap()
  resolveFirst(a); resolveSecond(b)
  expect((await first).name).toBe('AbortError')
  expect((await second).name).toBe('AbortError')
  expect((await queued).name).toBe('AbortError')
  expect(a.close).toHaveBeenCalledOnce()
  expect(b.close).toHaveBeenCalledOnce()
  expect(render).toHaveBeenCalledTimes(2)
})
