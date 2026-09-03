import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Course } from '../../../src/shared/types/course'

const workspaceMocks = vi.hoisted(() => ({
  discardPendingSave: vi.fn()
}))

vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({
      discardPendingSave: workspaceMocks.discardPendingSave
    })
  }
}))

import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { resetSettingsSnapshotForTests } from '../../../src/renderer/src/stores/settingsSnapshot'

const invokeMock = vi.fn<(channel: string, req: unknown) => Promise<unknown>>()

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
    groupId: null,
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  invokeMock.mockReset()
  setIpcAdapter({
    invoke: invokeMock,
    on: vi.fn(() => () => undefined)
  } as unknown as IpcAdapter)
  resetSettingsSnapshotForTests()
  workspaceMocks.discardPendingSave.mockReset()
  useCoursesStore.setState({
    courses: [],
    groups: [],
    selectedCourseId: null,
    isLoading: false,
    pendingCourseId: null,
    error: null
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  setIpcAdapter(null)
  resetSettingsSnapshotForTests()
})

describe('coursesStore selection persistence', () => {
  test('persists a newly created course through the selectCourse path', async () => {
    const created = course('c1', 0)
    invokeMock.mockResolvedValue(created)

    await useCoursesStore.getState().createCourse({
      name: created.name,
      color: created.color
    })
    await vi.advanceTimersByTimeAsync(800)

    expect(useCoursesStore.getState().selectedCourseId).toBe(created.id)
    expect(invokeMock).toHaveBeenCalledWith('settings:set', {
      lastActiveCourseId: created.id
    })
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

describe('coursesStore setCourseColor', () => {
  test('persists the color and replaces the course with the server response', async () => {
    const original = course('c1', 0)
    const updated = { ...original, color: 'violet' }
    useCoursesStore.setState({ courses: [original] })
    invokeMock.mockResolvedValue(updated)

    await useCoursesStore.getState().setCourseColor(original.id, 'violet')

    expect(invokeMock).toHaveBeenCalledWith('courses:setColor', {
      courseId: original.id,
      color: 'violet'
    })
    expect(useCoursesStore.getState().courses[0]?.color).toBe('violet')
    expect(useCoursesStore.getState().pendingCourseId).toBeNull()
  })
})
