import { describe, expect, test, vi } from 'vitest'
import {
  calendarMonthGrid,
  dueAtForLocalInput,
  localCalendarDayDifference,
  localDateKey,
  taskIsOverdue
} from '../../../src/renderer/src/features/calendar/calendarDate'
import type { BoardTask } from '../../../src/shared/types/board'

describe('local calendar dates', () => {
  test('uses local date parts for a day key', () => {
    expect(localDateKey(new Date(2026, 7, 8, 0, 1))).toBe('2026-08-08')
  })

  test('round-trips a local deadline without shifting its calendar cell', () => {
    const dueAt = dueAtForLocalInput('2026-08-08', '23:59', false)

    expect(localDateKey(dueAt)).toBe('2026-08-08')
    expect(new Date(dueAt).getHours()).toBe(23)
    expect(new Date(dueAt).getMinutes()).toBe(59)
  })

  test('round-trips an all-day key without consulting Date or a timezone', () => {
    const dateConstructor = vi.spyOn(globalThis, 'Date')
    try {
      const dueAt = dueAtForLocalInput('2026-08-08', '23:59', true)

      expect(dueAt).toBe('2026-08-08')
      expect(localDateKey(dueAt)).toBe('2026-08-08')
      expect(dateConstructor).not.toHaveBeenCalled()
    } finally {
      dateConstructor.mockRestore()
    }
  })

  test('interprets an all-day key as local midnight for date readers', () => {
    expect(localCalendarDayDifference('2026-08-09', '2026-08-08')).toBe(1)
    expect(localDateKey('2026-08-08')).toBe('2026-08-08')
  })

  test('counts the midnight boundary just before and after it', () => {
    const beforeMidnight = new Date(2026, 7, 31, 23, 59, 59)
    const afterMidnight = new Date(2026, 8, 1, 0, 0, 1)

    expect(localCalendarDayDifference(afterMidnight, beforeMidnight)).toBe(1)
    expect(localCalendarDayDifference(beforeMidnight, afterMidnight)).toBe(-1)
  })

  test('counts one day across month end', () => {
    expect(
      localCalendarDayDifference(
        new Date(2026, 1, 1, 0, 1),
        new Date(2026, 0, 31, 23, 59)
      )
    ).toBe(1)
  })

  test('counts one day across year end', () => {
    expect(
      localCalendarDayDifference(
        new Date(2027, 0, 1, 0, 1),
        new Date(2026, 11, 31, 23, 59)
      )
    ).toBe(1)
  })

  test('builds a local half-open range around a complete month grid', () => {
    const grid = calendarMonthGrid(new Date(2026, 7, 15), new Date(2026, 7, 8))

    expect(grid.days.length % 7).toBe(0)
    expect(grid.days[0]?.date.getDay()).toBe(0)
    expect(grid.days.at(-1)?.date.getDay()).toBe(6)
    expect(grid.days.find((day) => day.isToday)?.key).toBe('2026-08-08')
    expect(new Date(grid.from).getHours()).toBe(0)
    expect(new Date(grid.to).getHours()).toBe(0)
  })

  test('keeps an all-day entry active through its local calendar day', () => {
    const task: BoardTask = {
      id: 'exam',
      courseId: null,
      title: '시험',
      notes: '',
      status: 'todo',
      kind: 'exam',
      dueAt: '2026-08-08',
      allDay: true,
      sortOrder: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }

    expect(taskIsOverdue(task, new Date(2026, 7, 8, 23, 59))).toBe(false)
    expect(taskIsOverdue(task, new Date(2026, 7, 9, 0, 1))).toBe(true)
  })
})
