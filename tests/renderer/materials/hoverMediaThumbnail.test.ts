// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadImageThumbnail, loadVideoThumbnail, thumbnailFrameTime } from '../../../src/renderer/src/features/materials/preview/mediaThumbnails'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('hover video frame extraction', () => {
  test('selects an early frame even for subsecond videos', () => {
    expect(thumbnailFrameTime(120)).toBe(1)
    expect(thumbnailFrameTime(0.4)).toBeCloseTo(0.04)
    expect(thumbnailFrameTime(Infinity)).toBe(0)
    expect(thumbnailFrameTime(0)).toBe(0)
  })

  test('uses only metadata/seek and unloads without calling play when cancelled', async () => {
    const video = document.createElement('video')
    const original = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) => tag === 'video' ? video : original(tag, options))
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined)
    const load = vi.spyOn(video, 'load').mockImplementation(() => undefined)
    const controller = new AbortController()
    const pending = loadVideoThumbnail('c', 'movie.mp4', '1', controller.signal)
    expect(video.muted).toBe(true)
    expect(video.preload).toBe('metadata')
    controller.abort(new Error('left row'))
    await expect(pending).rejects.toThrow('left row')
    expect(play).not.toHaveBeenCalled()
    expect(pause).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledTimes(2)
    expect(video.hasAttribute('src')).toBe(false)
  })
})

describe('bounded static image thumbnails', () => {
  test('decodes to a small frame, closes the bitmap, and caches only completed thumbnails', async () => {
    const bitmap = { close: vi.fn() }
    const decode = vi.fn(async () => bitmap)
    vi.stubGlobal('createImageBitmap', decode)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,small')
    const source = { sourceDataUrl: 'data:image/png;base64,AAAA', width: 4000, height: 2000 }
    const value = await loadImageThumbnail('c', 'bounded.png', '1', source, new AbortController().signal)
    expect(value).toEqual({ dataUrl: 'data:image/png;base64,small' })
    expect(decode).toHaveBeenCalledWith(expect.any(Blob), { resizeWidth: 360, resizeHeight: 180, resizeQuality: 'high' })
    expect(bitmap.close).toHaveBeenCalledOnce()
    await loadImageThumbnail('c', 'bounded.png', '1', source, new AbortController().signal)
    expect(decode).toHaveBeenCalledOnce()
    await loadImageThumbnail('c', 'bounded.png', '2', source, new AbortController().signal)
    expect(decode).toHaveBeenCalledTimes(2)
  })

  test('rejects unbounded dimensions before creating a decoder', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(loadImageThumbnail('c', 'large.png', '1', { sourceDataUrl: 'data:image/png;base64,AAAA', width: 8193, height: 2 }, new AbortController().signal)).rejects.toThrow('dimensions exceed')
    expect(decode).not.toHaveBeenCalled()
  })

  test('closes a bitmap that finishes after the row was dismissed', async () => {
    const bitmap = { close: vi.fn() }
    let finish!: (value: typeof bitmap) => void
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    const controller = new AbortController()
    const pending = loadImageThumbnail('c', 'late.png', '1', { sourceDataUrl: 'data:image/png;base64,AAAA', width: 200, height: 100 }, controller.signal)
    const rejection = expect(pending).rejects.toThrow('closed')
    controller.abort(new Error('closed'))
    await rejection
    finish(bitmap)
    await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce())
  })
})
