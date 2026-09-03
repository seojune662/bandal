import { describe, expect, test } from 'vitest'
import {
  dueKeys,
  type DeadlineTask
} from '../../../src/main/features/notifications/deadlineScheduler'

function task(over: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    id: 'task-1',
    courseId: 'course-1',
    courseName: '자료구조',
    title: '과제',
    dueAt: '2026-09-08T12:00:00.000Z',
    allDay: false,
    ...over
  }
}

describe('dueKeys', () => {
  test('includes the exact lead-day boundary', () => {
    expect(
      dueKeys(new Date('2026-09-05T12:00:00.000Z'), [3], [task()])
    ).toEqual(['task-1:3'])
  })

  test('excludes a task once its due instant has passed', () => {
    expect(
      dueKeys(new Date('2026-09-08T12:00:00.001Z'), [1, 3], [task()])
    ).toEqual([])
  })

  test('treats an all-day due date as local midnight', () => {
    const due = new Date(2026, 8, 8)
    const oneDayBefore = new Date(due.getTime() - 24 * 60 * 60 * 1000)
    expect(
      dueKeys(oneDayBefore, [1], [
        task({ dueAt: '2026-09-08', allDay: true })
      ])
    ).toEqual(['task-1:1'])
  })
})
