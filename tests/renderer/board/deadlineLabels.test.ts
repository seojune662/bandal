import { describe, expect, test } from 'vitest'
import { dueDayLabel, dueState } from '../../../src/renderer/src/features/board/boardLogic'

describe('board D-day labels', () => {
  const now = new Date(2026, 7, 9, 18, 30)

  test('uses local calendar days instead of remaining hours', () => {
    expect(dueDayLabel(new Date(2026, 7, 9, 0, 1).toISOString(), now)).toBe('D-Day')
    expect(dueDayLabel(new Date(2026, 7, 11, 0, 1).toISOString(), now)).toBe('D-2')
    expect(dueDayLabel(new Date(2026, 7, 8, 23, 59).toISOString(), now)).toBe('D+1')
  })

  test('ignores absent and invalid due dates', () => {
    expect(dueDayLabel(null, now)).toBeNull()
    expect(dueDayLabel('invalid', now)).toBeNull()
  })

  test('keeps all-day deadlines active through the whole local day', () => {
    const dueAt = new Date(2026, 7, 9).toISOString()

    expect(dueState(dueAt, new Date(2026, 7, 9, 23, 59), true)).toBe('upcoming')
    expect(dueState(dueAt, new Date(2026, 7, 10, 0, 1), true)).toBe('overdue')
  })
})
