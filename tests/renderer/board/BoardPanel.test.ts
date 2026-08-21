import { afterEach, describe, expect, test, vi } from 'vitest'
import type { BoardTask } from '../../../src/shared/types/board'
import { reorderCourseTasks } from '../../../src/renderer/src/features/board/BoardPanel'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

function task(id: string, sortOrder: number): BoardTask {
  return {
    id,
    courseId: 'course-a',
    title: id,
    notes: '',
    status: 'todo',
    kind: 'task',
    dueAt: null,
    allDay: false,
    sortOrder,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z'
  }
}

afterEach(() => setIpcAdapter(null))

describe('BoardPanel task reorder persistence', () => {
  test('persists all changed rows with one board:reorderTasks invocation', async () => {
    const changed = [task('b', 0), task('a', 1)]
    const invoke = vi.fn(async () => changed)
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    await expect(
      reorderCourseTasks('course-a', [
        { id: 'b', sortOrder: 0 },
        { id: 'a', status: 'todo', sortOrder: 1 }
      ])
    ).resolves.toEqual(changed)

    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('board:reorderTasks', {
      courseId: 'course-a',
      updates: [
        { id: 'b', sortOrder: 0 },
        { id: 'a', status: 'todo', sortOrder: 1 }
      ]
    })
  })
})
