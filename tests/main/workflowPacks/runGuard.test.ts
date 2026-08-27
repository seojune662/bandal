import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createPackRunGuard,
  PACK_RUN_GUARD_TTL_MS
} from '../../../src/main/features/workflowPacks/runGuard'

describe('packRunGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('arms and clears a copied allowlist per course', () => {
    const guard = createPackRunGuard()
    const allowed = new Set(['write_file'])
    guard.arm('course-a', { packId: 'custom:a', allowed })
    allowed.add('create_note')

    expect([...guard.restrictionFor('course-a') ?? []]).toEqual(['write_file'])
    expect(guard.restrictionFor('course-b')).toBeNull()

    guard.clear('course-a')
    expect(guard.restrictionFor('course-a')).toBeNull()
  })

  test('expires an abandoned restriction after the 15-minute backstop', () => {
    const guard = createPackRunGuard()
    guard.arm('course-a', {
      packId: 'custom:a',
      allowed: new Set(['write_file'])
    })

    vi.advanceTimersByTime(PACK_RUN_GUARD_TTL_MS - 1)
    expect(guard.restrictionFor('course-a')).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(guard.restrictionFor('course-a')).toBeNull()
  })
})
