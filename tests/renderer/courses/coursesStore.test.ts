import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Course } from '../../../src/shared/types/course'

const workspaceMocks = vi.hoisted(() => ({
  discardPendingSave: vi.fn()
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))

vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({
      discardPendingSave: workspaceMocks.discardPendingSave
    })
  }
}))

import { invoke } from '../../../src/renderer/src/lib/ipc'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'

const invokeMock = vi.mocked(invoke)

function course(
  id: string,
  sortOrder: number,
  archived = false
): Course {
  return {
    id,
    name: id === 'c1' ? '자료구조' : '운영체제',
    slug: id,
    color: 'gold',
    folderPath: `/courses/${id}`,
    source: 'managed',
    missing: false,
    archived,
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

beforeEach(() => {
  invokeMock.mockReset()
  workspaceMocks.discardPendingSave.mockReset()
  useCoursesStore.setState({
    courses: [],
    selectedCourseId: null,
    isLoading: false,
    pendingCourseId: null,
    error: null
  })
})

describe('coursesStore archiveCourse', () => {
  test('archives with the requested boolean and removes the active row', async () => {
    const first = course('c1', 0)
    const second = course('c2', 1)
    useCoursesStore.setState({
      courses: [first, second],
      selectedCourseId: first.id
    })
    invokeMock.mockResolvedValue({ ...first, archived: true })

    await useCoursesStore.getState().archiveCourse(first.id, true)

    expect(invokeMock).toHaveBeenCalledWith('courses:archive', {
      courseId: first.id,
      archived: true
    })
    expect(useCoursesStore.getState().courses).toEqual([second])
    expect(useCoursesStore.getState().selectedCourseId).toBe(second.id)
    expect(workspaceMocks.discardPendingSave).toHaveBeenCalledWith(first.id)
  })

  test('restores the returned course into the sorted active list', async () => {
    const restored = course('c1', 0)
    const active = course('c2', 1)
    useCoursesStore.setState({
      courses: [active],
      selectedCourseId: active.id
    })
    invokeMock.mockResolvedValue(restored)

    await useCoursesStore.getState().archiveCourse(restored.id, false)

    expect(invokeMock).toHaveBeenCalledWith('courses:archive', {
      courseId: restored.id,
      archived: false
    })
    expect(useCoursesStore.getState().courses.map((item) => item.id)).toEqual([
      restored.id,
      active.id
    ])
    expect(useCoursesStore.getState().selectedCourseId).toBe(active.id)
    expect(workspaceMocks.discardPendingSave).not.toHaveBeenCalled()
  })
})
