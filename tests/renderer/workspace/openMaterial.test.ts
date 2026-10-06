import { beforeEach, describe, expect, test, vi } from 'vitest'

const { invokeMock, openTabMock, selectCourseMock, showCourseWorkspaceMock, workspace } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openTabMock: vi.fn(), selectCourseMock: vi.fn(), showCourseWorkspaceMock: vi.fn(),
  workspace: { activeCourseId: 'course-1', activePanelId: null, surface: 'course' }
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: invokeMock
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: vi.fn()
}))

vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({
  useMaterialsStore: {
    getState: () => ({ activeCourseId: 'course-1' })
  }
}))

vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({ ...workspace, openTab: openTabMock, showCourseWorkspace: showCourseWorkspaceMock })
  }
}))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({
  useCoursesStore: { getState: () => ({ courses: [{ id: 'course-1' }], selectCourse: selectCourseMock }) }
}))

import { openMaterialInCourse } from '../../../src/renderer/src/features/workspace/openMaterial'

describe('openMaterialInCourse', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    openTabMock.mockReset()
    selectCourseMock.mockReset(); showCourseWorkspaceMock.mockReset()
    invokeMock.mockResolvedValue({ ok: true })
    workspace.activeCourseId = 'course-1'; workspace.surface = 'course'
  })

  test('opens an image tab and records material activity', () => {
    openMaterialInCourse('course-1', 'image', 'figures/diagram.png')

    expect(openTabMock).toHaveBeenCalledWith({
      kind: 'image',
      payload: { courseId: 'course-1', relPath: 'figures/diagram.png' }
    })
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('activity:record', {
      courseId: 'course-1',
      kind: 'material-opened',
      relPath: 'figures/diagram.png',
      summary: 'figures/diagram.png을(를) 열었습니다.'
    })
  })

  test('routes video materials into the generic file tab', () => {
    openMaterialInCourse('course-1', 'video', 'week1/lecture.mp4')

    expect(openTabMock).toHaveBeenCalledWith({
      kind: 'file',
      payload: { courseId: 'course-1', relPath: 'week1/lecture.mp4' }
    })
    expect(invokeMock).toHaveBeenCalledWith('activity:record', {
      courseId: 'course-1',
      kind: 'material-opened',
      relPath: 'week1/lecture.mp4',
      summary: 'week1/lecture.mp4을(를) 열었습니다.'
    })
  })

  test('keeps other files on the Finder reveal path', async () => {
    openMaterialInCourse('course-1', 'other', 'archive.zip')
    await Promise.resolve()

    expect(openTabMock).not.toHaveBeenCalled()
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'materials:reveal', {
      courseId: 'course-1',
      relPath: 'archive.zip'
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'activity:record', {
      courseId: 'course-1',
      kind: 'material-opened',
      relPath: 'archive.zip',
      summary: 'archive.zip을(를) 열었습니다.'
    })
  })

  test('an original source first selects its owning course rather than opening inside the review workspace', () => {
    openMaterialInCourse('course-1', 'pdf', 'original.pdf')
    expect(selectCourseMock).toHaveBeenCalledWith('course-1')
    expect(showCourseWorkspaceMock).toHaveBeenCalledWith('course-1')
    expect(showCourseWorkspaceMock.mock.invocationCallOrder[0]).toBeLessThan(openTabMock.mock.invocationCallOrder[0]!)
  })

  test('a resolved recording opens when its request is still current', async () => {
    invokeMock.mockResolvedValueOnce({ id: 'recording-1', title: 'Lecture' })
    openMaterialInCourse('course-1', 'other', 'lecture.wav')
    await Promise.resolve()
    expect(openTabMock).toHaveBeenCalledWith({ kind: 'recording', payload: { courseId: 'course-1', sessionId: 'recording-1', title: 'Lecture' } })
  })

  test.each(['course', 'home', 'another-file'])('a late recording result respects navigation to %s', async next => {
    let resolve!: (value: unknown) => void
    invokeMock.mockReturnValueOnce(new Promise(done => { resolve = done }))
    openMaterialInCourse('course-1', 'other', 'lecture.wav')
    if (next === 'course') workspace.activeCourseId = 'course-2'
    else if (next === 'home') workspace.surface = 'learning-home'
    else openMaterialInCourse('course-1', 'note', 'next.md')
    openTabMock.mockClear(); selectCourseMock.mockClear()
    resolve({ id: 'old-recording', title: 'Old' })
    await Promise.resolve()
    expect(openTabMock).not.toHaveBeenCalled()
    expect(selectCourseMock).not.toHaveBeenCalled()
  })
})
