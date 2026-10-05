import { beforeEach, describe, expect, test, vi } from 'vitest'

const { invokeMock, openTabMock, selectCourseMock, showCourseWorkspaceMock, showToastMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openTabMock: vi.fn(),
  selectCourseMock: vi.fn(),
  showCourseWorkspaceMock: vi.fn(),
  showToastMock: vi.fn()
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: invokeMock
}))

vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({
  useCoursesStore: {
    getState: () => ({ courses: [{ id: 'course-activity' }], selectCourse: selectCourseMock })
  }
}))

vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({ openTab: openTabMock, showCourseWorkspace: showCourseWorkspaceMock })
  }
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: showToastMock
}))

import {
  MATERIAL_OPEN_DEDUPE_MS,
  openMaterialInCourse,
  shouldRecordMaterialOpen
} from '../../../src/renderer/src/features/workspace/openMaterial'

describe('material-opened activity deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ ok: true })
  })

  test('records a file with no prior activity', () => {
    expect(shouldRecordMaterialOpen(undefined, 1_000)).toBe(true)
  })

  test('suppresses the same file inside the five minute window', () => {
    expect(shouldRecordMaterialOpen(1_000, 1_000 + MATERIAL_OPEN_DEDUPE_MS - 1)).toBe(
      false
    )
  })

  test('records again at the boundary', () => {
    expect(shouldRecordMaterialOpen(1_000, 1_000 + MATERIAL_OPEN_DEDUPE_MS)).toBe(
      true
    )
  })

  test('recovers when the client clock moves backwards', () => {
    expect(shouldRecordMaterialOpen(2_000, 1_000)).toBe(true)
  })

  test('records a tab material and suppresses an immediate duplicate', () => {
    openMaterialInCourse('course-activity', 'note', 'quiz/activity-test.md')
    openMaterialInCourse('course-activity', 'note', 'quiz/activity-test.md')

    expect(selectCourseMock).toHaveBeenCalledWith('course-activity')
    expect(showCourseWorkspaceMock).toHaveBeenCalledWith('course-activity')
    expect(openTabMock).toHaveBeenCalledTimes(2)
    expect(showToastMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('activity:record', {
      courseId: 'course-activity',
      kind: 'material-opened',
      relPath: 'quiz/activity-test.md',
      summary: 'quiz/activity-test.md을(를) 열었습니다.'
    })
  })

  test('swallows activity recording failures', async () => {
    invokeMock.mockRejectedValueOnce(new Error('activity unavailable'))

    expect(() =>
      openMaterialInCourse('course-activity', 'note', 'quiz/failure-test.md')
    ).not.toThrow()
    await Promise.resolve()
    expect(openTabMock).toHaveBeenCalledWith({
      kind: 'note',
      payload: { courseId: 'course-activity', relPath: 'quiz/failure-test.md' }
    })
    expect(showToastMock).not.toHaveBeenCalled()
  })
})
