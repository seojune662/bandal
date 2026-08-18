import { describe, expect, test, vi } from 'vitest'
import {
  createVideoProgressMemory,
  createVideoSaveTiming,
  isVideoComplete,
  isVideoIpcSaveDue,
  planVideoDebouncedSave,
  planVideoTimeUpdate,
  playbackRateForVideoRestore,
  positionForVideoRestore,
  registerVideoProgressFlushTriggers,
  VIDEO_PROGRESS_INTERVAL_MS,
  type VideoProgressSnapshot
} from '../../../src/renderer/src/features/file/lib/videoProgress'

const progress = (positionSec: number): VideoProgressSnapshot => ({
  positionSec,
  durationSec: 100,
  playbackRate: 1
})

describe('video progress timing', () => {
  test('throttles session-memory writes to one per five seconds', () => {
    const initial = createVideoSaveTiming()
    const first = planVideoTimeUpdate(initial, 1_000)
    const throttled = planVideoTimeUpdate(first.timing, 5_999)
    const next = planVideoTimeUpdate(throttled.timing, 6_000)

    expect(first.writeMemory).toBe(true)
    expect(throttled.writeMemory).toBe(false)
    expect(throttled.timing.lastMemoryWriteAtMs).toBe(1_000)
    expect(next.writeMemory).toBe(true)
    expect(next.timing.lastMemoryWriteAtMs).toBe(6_000)
  })

  test('debounces IPC by moving the deadline after each update', () => {
    const first = planVideoTimeUpdate(createVideoSaveTiming(), 2_000)
    const second = planVideoTimeUpdate(first.timing, 3_500)
    const rateChange = planVideoDebouncedSave(second.timing, 4_000)

    expect(first.timing.ipcDueAtMs).toBe(
      2_000 + VIDEO_PROGRESS_INTERVAL_MS
    )
    expect(second.timing.ipcDueAtMs).toBe(
      3_500 + VIDEO_PROGRESS_INTERVAL_MS
    )
    expect(rateChange.ipcDueAtMs).toBe(
      4_000 + VIDEO_PROGRESS_INTERVAL_MS
    )
    expect(isVideoIpcSaveDue(rateChange.ipcDueAtMs, 8_999)).toBe(false)
    expect(isVideoIpcSaveDue(rateChange.ipcDueAtMs, 9_000)).toBe(true)
  })
})

describe('video completion and restore', () => {
  test('treats the final five seconds as complete, including the boundary', () => {
    expect(isVideoComplete(94.999, 100)).toBe(false)
    expect(isVideoComplete(95, 100)).toBe(true)
    expect(isVideoComplete(100, 100)).toBe(true)
    expect(positionForVideoRestore(95, 100)).toBe(0)
  })

  test('keeps an unfinished position and sanitizes invalid progress', () => {
    expect(positionForVideoRestore(42.5, 100)).toBe(42.5)
    expect(positionForVideoRestore(Number.NaN, 100)).toBe(0)
    expect(positionForVideoRestore(-3, 100)).toBe(0)
    expect(isVideoComplete(99, null)).toBe(false)
  })

  test('restores only playback rates offered by the viewer', () => {
    expect(playbackRateForVideoRestore(0.5)).toBe(0.5)
    expect(playbackRateForVideoRestore(1.25)).toBe(1.25)
    expect(playbackRateForVideoRestore(3)).toBe(1)
  })
})

describe('video progress session memory', () => {
  test('returns the latest progress for the same file without IPC', () => {
    const memory = createVideoProgressMemory(2)

    memory.set('course-1', 'week-1/lecture.mp4', progress(37))

    expect(memory.get('course-1', 'week-1/lecture.mp4')).toEqual(progress(37))
    expect(memory.get('course-2', 'week-1/lecture.mp4')).toBeNull()
  })

  test('touches entries and evicts the least recently used file', () => {
    const memory = createVideoProgressMemory(2)
    memory.set('course', 'a.mp4', progress(1))
    memory.set('course', 'b.mp4', progress(2))

    memory.get('course', 'a.mp4')
    memory.set('course', 'c.mp4', progress(3))

    expect(memory.get('course', 'a.mp4')).toEqual(progress(1))
    expect(memory.get('course', 'b.mp4')).toBeNull()
    expect(memory.keys()).toEqual([
      'course\u0000c.mp4',
      'course\u0000a.mp4'
    ])
  })
})

describe('video progress flush triggers', () => {
  test('flushes on unload, blur, and hidden visibility, then disposes', () => {
    const windowTarget = new EventTarget()
    const documentTarget = new EventTarget()
    const flush = vi.fn()
    let visibilityState: DocumentVisibilityState = 'visible'
    const dispose = registerVideoProgressFlushTriggers({
      windowTarget,
      documentTarget,
      visibilityState: () => visibilityState,
      flush
    })

    windowTarget.dispatchEvent(new Event('blur'))
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    visibilityState = 'hidden'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    windowTarget.dispatchEvent(new Event('beforeunload'))

    expect(flush).toHaveBeenCalledTimes(3)

    dispose()
    windowTarget.dispatchEvent(new Event('blur'))
    expect(flush).toHaveBeenCalledTimes(3)
  })
})
