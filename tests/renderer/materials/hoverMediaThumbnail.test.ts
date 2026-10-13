// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadVideoThumbnail, thumbnailFrameTime } from '../../../src/renderer/src/features/materials/preview/mediaThumbnails'

afterEach(() => vi.restoreAllMocks())

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
