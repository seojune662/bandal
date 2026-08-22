import { describe, expect, test, vi } from 'vitest'
import type { PipState } from '../../../src/shared/types/pip'
import {
  playWithMutedFallback,
  syncInitialPipState,
  type PipPlayable
} from '../../../src/renderer/src/features/pip/pipStartup'

const initialState: PipState = {
  open: true,
  source: {
    kind: 'local',
    courseId: 'course-1',
    relPath: 'lecture.mp4',
    title: '강의'
  },
  positionSec: 1.5,
  playbackRate: 1.25
}

describe('PiP startup synchronization', () => {
  test('gets state on mount and applies it as a playing initial seek', async () => {
    const getState = vi.fn(async () => initialState)
    const applySeek = vi.fn()

    await syncInitialPipState({ getState, applySeek })

    expect(getState).toHaveBeenCalledOnce()
    expect(applySeek).toHaveBeenCalledWith({
      positionSec: 1.5,
      playbackRate: 1.25,
      play: true
    })
  })

  test('does not let a late state response replace a newer seek push', async () => {
    const applySeek = vi.fn()

    await syncInitialPipState({
      getState: async () => initialState,
      applySeek,
      shouldApply: () => false
    })

    expect(applySeek).not.toHaveBeenCalled()
  })
})

describe('PiP autoplay fallback', () => {
  test('retries muted after audible play is rejected', async () => {
    const order: string[] = []
    let muted = false
    const video: PipPlayable = {
      get muted() {
        return muted
      },
      set muted(value: boolean) {
        muted = value
        order.push(`muted:${String(value)}`)
      },
      play: vi
        .fn()
        .mockImplementationOnce(async () => {
          order.push('play:audible')
          throw new Error('NotAllowedError')
        })
        .mockImplementationOnce(async () => {
          order.push('play:muted')
        })
    }

    const result = await playWithMutedFallback(video, () => {
      order.push('ui:muted')
    })

    expect(result).toBe('muted-playing')
    expect(video.muted).toBe(true)
    expect(order).toEqual([
      'play:audible',
      'muted:true',
      'ui:muted',
      'play:muted'
    ])
    expect(video.play).toHaveBeenCalledTimes(2)
  })

  test('keeps the blocked-button path when muted playback also fails', async () => {
    const video: PipPlayable = {
      muted: false,
      play: vi.fn(async () => {
        throw new Error('NotAllowedError')
      })
    }

    await expect(playWithMutedFallback(video, vi.fn())).resolves.toBe(
      'blocked'
    )
    expect(video.muted).toBe(true)
    expect(video.play).toHaveBeenCalledTimes(2)
  })
})
