import { describe, expect, test } from 'vitest'
import {
  RATE_RULES,
  createRateGuard
} from '../../../src/main/features/group/rateGuard'

function guardAt(clock: { now: number }) {
  return createRateGuard({ now: () => clock.now })
}

describe('createRateGuard', () => {
  test('allows attempts up to the limit', () => {
    const clock = { now: 0 }
    const guard = guardAt(clock)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(guard.take('joinWithCode').allowed).toBe(true)
    }
  })

  test('rejects the attempt past the limit with a retry countdown', () => {
    const clock = { now: 0 }
    const guard = guardAt(clock)
    for (let attempt = 0; attempt < 5; attempt += 1) guard.take('joinWithCode')
    const decision = guard.take('joinWithCode')
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfter).toBeGreaterThan(0)
    expect(decision.retryAfter).toBeLessThanOrEqual(300)
  })

  test('a rejected attempt does not itself consume budget', () => {
    // Otherwise a client retrying in a loop would extend its own lockout
    // forever, which the server-side counter deliberately does not do.
    const clock = { now: 0 }
    const guard = guardAt(clock)
    for (let attempt = 0; attempt < 5; attempt += 1) guard.take('joinWithCode')
    guard.take('joinWithCode')
    clock.now = 5 * 60_000 + 1
    expect(guard.take('joinWithCode').allowed).toBe(true)
  })

  test('the window slides', () => {
    const clock = { now: 0 }
    const guard = guardAt(clock)
    for (let attempt = 0; attempt < 5; attempt += 1) guard.take('joinWithCode')
    clock.now = 5 * 60_000 + 1
    expect(guard.take('joinWithCode').allowed).toBe(true)
  })

  test('scopes are independent counters', () => {
    const clock = { now: 0 }
    const guard = guardAt(clock)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      guard.take('regenerateCode', 'group-a')
    }
    expect(guard.take('regenerateCode', 'group-a').allowed).toBe(false)
    expect(guard.take('regenerateCode', 'group-b').allowed).toBe(true)
  })

  test('an unknown action has no local opinion', () => {
    // The server still enforces its own limit; this guard is UX only, so a
    // missing rule must never block a legitimate call.
    const guard = createRateGuard()
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      expect(guard.take('somethingNew').allowed).toBe(true)
    }
  })

  test('reset clears a counter after a confirmed success', () => {
    const clock = { now: 0 }
    const guard = guardAt(clock)
    for (let attempt = 0; attempt < 5; attempt += 1) guard.take('joinWithCode')
    expect(guard.take('joinWithCode').allowed).toBe(false)
    guard.reset('joinWithCode')
    expect(guard.take('joinWithCode').allowed).toBe(true)
  })

  test('prune drops timestamps older than every window', () => {
    const clock = { now: 0 }
    const guard = guardAt(clock)
    guard.take('joinWithCode')
    clock.now = 25 * 60 * 60 * 1000
    guard.prune()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(guard.take('joinWithCode').allowed).toBe(true)
    }
  })

  test('local limits are never tighter than the server ones they mirror', () => {
    // The server is the authority; a stricter local guard would reject calls
    // the server would have accepted.
    expect(RATE_RULES['joinWithCode']?.limit).toBe(5)
    expect(RATE_RULES['createGroup']?.limit).toBe(10)
    expect(RATE_RULES['findProfile']?.limit).toBe(30)
    expect(RATE_RULES['inviteByNickname']?.limit).toBe(20)
  })
})
