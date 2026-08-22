import { describe, expect, test, vi } from 'vitest'
import {
  PROGRESS_DELAY_MS,
  scheduleProgressVisibility,
  shouldHandleLoadFailure,
  shouldFinishMainFrameLoading
} from '../../../src/renderer/src/features/browser/loadingIndicator'

describe('browser loading indicator', () => {
  test('a subframe stop does not finish main-frame loading', () => {
    expect(
      shouldFinishMainFrameLoading({ isLoadingMainFrame: () => true })
    ).toBe(false)
    expect(
      shouldFinishMainFrameLoading({ isLoadingMainFrame: () => false })
    ).toBe(true)
  })

  test('a subframe failure does not finish or replace the main-frame load', () => {
    expect(shouldHandleLoadFailure(false)).toBe(false)
    expect(shouldHandleLoadFailure(true)).toBe(true)
  })

  test('does not become active before the 250ms rising-edge delay', () => {
    vi.useFakeTimers()
    try {
      const setVisible = vi.fn()
      const dispose = scheduleProgressVisibility(true, setVisible)

      vi.advanceTimersByTime(PROGRESS_DELAY_MS - 1)
      expect(setVisible).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(setVisible).toHaveBeenCalledOnce()
      expect(setVisible).toHaveBeenLastCalledWith(true)
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a short load is cancelled without ever activating the bar', () => {
    vi.useFakeTimers()
    try {
      const setVisible = vi.fn()
      const cancelRise = scheduleProgressVisibility(true, setVisible)
      vi.advanceTimersByTime(PROGRESS_DELAY_MS - 1)
      cancelRise()
      scheduleProgressVisibility(false, setVisible)
      vi.runAllTimers()

      expect(setVisible).toHaveBeenCalledTimes(1)
      expect(setVisible).toHaveBeenCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
