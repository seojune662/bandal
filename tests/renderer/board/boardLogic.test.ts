import { describe, expect, test } from 'vitest'
import type { BoardTask } from '../../../src/shared/types/board'
import {
  dueState,
  filterTasks,
  planTaskMove,
  sortTasks
} from '../../../src/renderer/src/features/board/boardLogic'

function task(
  id: string,
  status: BoardTask['status'],
  sortOrder: number,
  courseId: string | null = 'course-a'
): BoardTask {
  return {
    id,
    courseId,
    title: id,
    notes: '',
    status,
    dueAt: null,
    sortOrder,
    createdAt: `2026-08-0${sortOrder + 1}T00:00:00.000Z`,
    updatedAt: '2026-08-01T00:00:00.000Z'
  }
}

describe('board task ordering', () => {
  test('sorts by sortOrder with stable fallbacks', () => {
    const tasks = [task('third', 'todo', 3), task('first', 'todo', 0), task('second', 'todo', 2)]

    expect(sortTasks(tasks).map((entry) => entry.id)).toEqual([
      'first',
      'second',
      'third'
    ])
  })

  test('reorders within a column and normalizes sortOrder', () => {
    const tasks = [task('a', 'todo', 0), task('b', 'todo', 1), task('c', 'todo', 2)]

    const plan = planTaskMove(tasks, 'c', 'todo', 'a')
    const todo = sortTasks(plan.tasks.filter((entry) => entry.status === 'todo'))

    expect(todo.map(({ id, sortOrder }) => [id, sortOrder])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2]
    ])
    expect(plan.updates).toEqual([
      { id: 'a', status: 'todo', sortOrder: 1 },
      { id: 'b', status: 'todo', sortOrder: 2 },
      { id: 'c', status: 'todo', sortOrder: 0 }
    ])
  })

  test('moves between columns and closes gaps in the source', () => {
    const tasks = [
      task('a', 'todo', 0),
      task('b', 'todo', 1),
      task('c', 'todo', 2),
      task('p', 'in-progress', 0)
    ]

    const plan = planTaskMove(tasks, 'b', 'in-progress', 'p')

    expect(
      sortTasks(plan.tasks.filter((entry) => entry.status === 'todo')).map(
        ({ id, sortOrder }) => [id, sortOrder]
      )
    ).toEqual([
      ['a', 0],
      ['c', 1]
    ])
    expect(
      sortTasks(plan.tasks.filter((entry) => entry.status === 'in-progress')).map(
        ({ id, sortOrder }) => [id, sortOrder]
      )
    ).toEqual([
      ['b', 0],
      ['p', 1]
    ])
  })

  test('sorts only within the dragged task course partition', () => {
    const otherCourseTask = task('other', 'todo', 0, 'course-b')
    const tasks = [task('a', 'todo', 0), task('b', 'todo', 4), otherCourseTask]

    const plan = planTaskMove(tasks, 'b', 'todo', 'a')
    const untouched = plan.tasks.find((entry) => entry.id === 'other')

    expect(untouched).toBe(otherCourseTask)
    expect(plan.updates.some((update) => update.id === 'other')).toBe(false)
  })
})

describe('due date classification', () => {
  const now = Date.parse('2026-08-05T12:00:00.000Z')

  test('marks past dates as overdue', () => {
    expect(dueState('2026-08-05T11:59:59.999Z', now)).toBe('overdue')
  })

  test('marks dates within exactly 24 hours as upcoming', () => {
    expect(dueState('2026-08-06T12:00:00.000Z', now)).toBe('upcoming')
  })

  test('marks later, absent, and invalid dates correctly', () => {
    expect(dueState('2026-08-06T12:00:00.001Z', now)).toBe('later')
    expect(dueState(null, now)).toBe('none')
    expect(dueState('not-a-date', now)).toBe('none')
  })
})

describe('board filtering', () => {
  const tasks = [
    task('course-open', 'todo', 0),
    task('course-done', 'done', 0),
    task('other-course', 'todo', 0, 'course-b'),
    task('global', 'in-progress', 0, null)
  ]

  test('shows every course when courseId is undefined', () => {
    expect(filterTasks(tasks, { courseId: undefined, hideDone: false })).toHaveLength(4)
  })

  test('filters one course or global tasks', () => {
    expect(
      filterTasks(tasks, { courseId: 'course-a', hideDone: false }).map(
        (entry) => entry.id
      )
    ).toEqual(['course-open', 'course-done'])
    expect(
      filterTasks(tasks, { courseId: null, hideDone: false }).map(
        (entry) => entry.id
      )
    ).toEqual(['global'])
  })

  test('hides completed tasks in combination with a course filter', () => {
    expect(
      filterTasks(tasks, { courseId: 'course-a', hideDone: true }).map(
        (entry) => entry.id
      )
    ).toEqual(['course-open'])
  })
})
