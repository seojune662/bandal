import { afterEach, describe, expect, test, vi } from 'vitest'
import { subscribeToToday } from '../../../src/renderer/src/features/calendar/CalendarView'

afterEach(() => {
  vi.useRealTimers()
})

describe('useToday', () => {
  test('updates at the next local midnight, reschedules, and cleans up', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 22, 23, 59, 59, 750))
    const updates: Date[] = []
    const unsubscribe = subscribeToToday((today) => updates.push(today))

    vi.advanceTimersByTime(249)
    expect(updates).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.getDate()).toBe(23)
    expect(updates[0]?.getHours()).toBe(0)

    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(updates).toHaveLength(2)
    expect(updates[1]?.getDate()).toBe(24)

    unsubscribe()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(updates).toHaveLength(2)
  })
})
