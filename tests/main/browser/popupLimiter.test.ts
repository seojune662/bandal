/**
 * The popup cap.
 *
 * Allowing `about:blank` popups is what makes Korean report viewers work; it
 * also removed the only thing stopping a page from opening windows in a loop.
 * Chromium's popup blocker does not run for `<webview>` guests and
 * `HandlerDetails` carries no user-gesture flag, so this is the whole defence.
 */
import { describe, expect, test } from 'vitest'
import {
  createPopupLimiter,
  POPUP_MAX_PER_GUEST,
  POPUP_MAX_TOTAL,
  POPUP_BURST_WINDOW_MS
} from '../../../src/main/features/browser/popupLimiter'

/** A clock the test moves by hand — no timers, no flake. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let at = 1_000_000
  return {
    now: () => at,
    advance: (ms) => {
      at += ms
    }
  }
}

describe('createPopupLimiter', () => {
  test('a loop of window.open is stopped by the burst window', () => {
    const clock = fakeClock()
    const limiter = createPopupLimiter(clock.now)
    expect(limiter.admit(1).ok).toBe(true)
    expect(limiter.admit(1).ok).toBe(true)
    expect(limiter.admit(1)).toEqual({ ok: false, reason: 'burst' })
  })

  test('the burst budget refills once the window passes', () => {
    const clock = fakeClock()
    const limiter = createPopupLimiter(clock.now)
    limiter.admit(1)
    limiter.admit(1)
    clock.advance(POPUP_BURST_WINDOW_MS + 1)
    expect(limiter.admit(1).ok).toBe(true)
  })

  test('a slow drip still stops at the concurrent cap', () => {
    // The burst window would let this through forever otherwise.
    const clock = fakeClock()
    const limiter = createPopupLimiter(clock.now)
    for (let i = 0; i < POPUP_MAX_PER_GUEST; i += 1) {
      expect(limiter.admit(1).ok).toBe(true)
      clock.advance(POPUP_BURST_WINDOW_MS + 1)
    }
    expect(limiter.admit(1)).toEqual({ ok: false, reason: 'limit' })
  })

  test('closing a popup frees its slot', () => {
    const clock = fakeClock()
    const limiter = createPopupLimiter(clock.now)
    for (let i = 0; i < POPUP_MAX_PER_GUEST; i += 1) {
      limiter.admit(1)
      clock.advance(POPUP_BURST_WINDOW_MS + 1)
    }
    expect(limiter.admit(1).ok).toBe(false)
    limiter.release(1)
    expect(limiter.admit(1).ok).toBe(true)
  })

  test('guests have their own budgets', () => {
    const clock = fakeClock()
    const limiter = createPopupLimiter(clock.now)
    limiter.admit(1)
    limiter.admit(1)
    expect(limiter.admit(1).ok).toBe(false)
    expect(limiter.admit(2).ok).toBe(true)
  })

  test('but the app-wide ceiling still binds', () => {
    // Otherwise a split view of five tabs could bury the app between them.
    const clock = fakeClock()
    const limiter = createPopupLimiter(clock.now)
    let admitted = 0
    for (let guest = 1; guest <= 6; guest += 1) {
      for (let i = 0; i < POPUP_MAX_PER_GUEST; i += 1) {
        if (limiter.admit(guest).ok) admitted += 1
        clock.advance(POPUP_BURST_WINDOW_MS + 1)
      }
    }
    expect(admitted).toBe(POPUP_MAX_TOTAL)
  })

  test('releasing more than was admitted does not create free slots', () => {
    const clock = fakeClock()
    const limiter = createPopupLimiter(clock.now)
    limiter.admit(1)
    limiter.release(1)
    limiter.release(1)
    limiter.release(1)
    clock.advance(POPUP_BURST_WINDOW_MS + 1)
    for (let i = 0; i < POPUP_MAX_PER_GUEST; i += 1) {
      expect(limiter.admit(1).ok).toBe(true)
      clock.advance(POPUP_BURST_WINDOW_MS + 1)
    }
    expect(limiter.admit(1).ok).toBe(false)
  })

  test('forgetting a destroyed guest returns its slots to the app', () => {
    const clock = fakeClock()
    const limiter = createPopupLimiter(clock.now)
    for (let guest = 1; guest <= 2; guest += 1) {
      for (let i = 0; i < POPUP_MAX_PER_GUEST; i += 1) {
        limiter.admit(guest)
        clock.advance(POPUP_BURST_WINDOW_MS + 1)
      }
    }
    expect(limiter.admit(3).ok).toBe(false)
    limiter.forget(1)
    expect(limiter.admit(3).ok).toBe(true)
  })
})
