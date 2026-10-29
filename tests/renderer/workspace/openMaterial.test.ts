import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspaceRef } from '../../../src/shared/types/workspace'

const { invokeMock, openTabMock, selectCourseMock, showCourseWorkspaceMock, pendingTargetMock, materials, workspace } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openTabMock: vi.fn(), selectCourseMock: vi.fn(), showCourseWorkspaceMock: vi.fn(),
  pendingTargetMock: vi.fn<() => Promise<import('../../../src/renderer/src/features/workspace/placementContext').WorkspaceTarget> | undefined>(), materials: { activeCourseId: 'course-1' },
  workspace: { activeCourseId: 'course-1', activeWorkspaceKey: 'course-1', activeWindowId: 'main', activeWorkspace: { kind: 'course', courseId: 'course-1' } as WorkspaceRef, activePanelId: null, surface: 'course' }
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: invokeMock
}))

vi.mock('../../../src/renderer/src/app/toast', () => ({
  showToast: vi.fn()
}))

vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({
  useMaterialsStore: {
    getState: () => materials
  }
}))

vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({
  workspaceApiForWindow: () => ({ activeGroup: { id: 'source-group' } }),
  capturePendingWorkspaceTarget: pendingTargetMock,
  useWorkspaceStore: {
    getState: () => ({ ...workspace, openTab: openTabMock, showWorkspace: showCourseWorkspaceMock })
  }
}))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({
  useCoursesStore: { getState: () => ({ courses: [{ id: 'course-1' }, { id: 'course-2' }], selectCourse: selectCourseMock }) }
}))

import { openMaterialInCourse, openMaterialInWorkspace } from '../../../src/renderer/src/features/workspace/openMaterial'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
const originalTarget = { courseId: 'course-1', workspace: { kind: 'course' as const, courseId: 'course-1' }, windowId: 'main', groupId: 'source-group' }

describe('openMaterialInCourse', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    openTabMock.mockReset()
    selectCourseMock.mockReset(); showCourseWorkspaceMock.mockReset()
    pendingTargetMock.mockReset()
    useUiStore.getState().closeMaterialsExpanded()
    materials.activeCourseId = 'course-1'
    invokeMock.mockResolvedValue({ ok: true })
    workspace.activeCourseId = 'course-1'; workspace.activeWorkspaceKey = 'course-1'; workspace.activeWindowId = 'main'; workspace.activeWorkspace = {kind: 'course', courseId: 'course-1'}; workspace.surface = 'course'
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

  test('external file reveal closes expanded materials only after success and keeps failures open', async () => {
    let finish!: () => void
    invokeMock.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    useUiStore.getState().setMaterialsExpanded(true)
    openMaterialInCourse('course-1', 'other', 'success.zip')
    expect(useUiStore.getState().materialsExpanded).toBe(true)
    finish(); await Promise.resolve()
    expect(useUiStore.getState().materialsExpanded).toBe(false)
    invokeMock.mockRejectedValueOnce(new Error('Reveal failed'))
    useUiStore.getState().setMaterialsExpanded(true)
    openMaterialInCourse('course-1', 'other', 'failure.zip')
    await Promise.resolve(); await Promise.resolve()
    expect(useUiStore.getState().materialsExpanded).toBe(true)
  })

  test('a delayed reveal from another window does not dismiss its newer browser', async () => {
    let finish!: () => void
    invokeMock.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    useUiStore.getState().setMaterialsExpanded(true)
    openMaterialInCourse('course-1', 'other', 'earlier-window.zip', { target: originalTarget })
    workspace.activeWindowId = 'second'
    finish(); await Promise.resolve()
    expect(useUiStore.getState().materialsExpanded).toBe(true)
  })

  test('explicit owner navigation selects the owning course before opening the document', () => {
    openMaterialInCourse('course-1', 'pdf', 'original.pdf', { navigateToOwner: true })
    expect(selectCourseMock).toHaveBeenCalledWith('course-1', { preserveSurface: true })
    expect(showCourseWorkspaceMock).toHaveBeenCalledWith({ kind: 'course', courseId: 'course-1' })
    expect(showCourseWorkspaceMock.mock.invocationCallOrder[0]).toBeLessThan(openTabMock.mock.invocationCallOrder[0]!)
  })

  test('a resolved recording opens when its request is still current', async () => {
    invokeMock.mockResolvedValueOnce({ id: 'recording-1', title: 'Lecture' })
    openMaterialInCourse('course-1', 'other', 'lecture.wav')
    await Promise.resolve()
    expect(openTabMock).toHaveBeenCalledWith({ kind: 'recording', payload: { courseId: 'course-1', sessionId: 'recording-1', title: 'Lecture' } }, { target: originalTarget })
  })

  test.each(['course', 'home', 'another-window', 'another-file'])('a late recording result respects navigation to %s', async next => {
    let resolve!: (value: unknown) => void
    invokeMock.mockReturnValueOnce(new Promise(done => { resolve = done }))
    openMaterialInCourse('course-1', 'other', 'lecture.wav')
    if (next === 'course') workspace.activeWorkspaceKey = 'course-2'
    else if (next === 'home') workspace.surface = 'learning-home'
    else if (next === 'another-window') {
      workspace.activeWindowId = 'second'
      openMaterialInCourse('course-1', 'note', 'other-window.md')
    }
    else openMaterialInCourse('course-1', 'note', 'next.md')
    openTabMock.mockClear(); selectCourseMock.mockClear(); showCourseWorkspaceMock.mockClear()
    resolve({ id: 'old-recording', title: 'Old' })
    await Promise.resolve()
    if (next === 'another-file') expect(openTabMock).not.toHaveBeenCalled()
    else expect(openTabMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'recording' }), { target: originalTarget })
    expect(selectCourseMock).not.toHaveBeenCalled()
    expect(showCourseWorkspaceMock).not.toHaveBeenCalled()
  })

  test('explicit target delivery preserves the current workspace and original split', () => {
    workspace.activeWindowId = 'second'
    openMaterialInCourse('course-1', 'note', 'created.md', { target: originalTarget, newInstance: true })
    expect(openTabMock).toHaveBeenCalledWith({ kind: 'note', payload: { courseId: 'course-1', relPath: 'created.md' } }, { target: originalTarget, newInstance: true })
    expect(selectCourseMock).not.toHaveBeenCalled()
    expect(showCourseWorkspaceMock).not.toHaveBeenCalled()
  })

  test('search navigation forwards the exact-panel callback without changing its captured destination', () => {
    const onOpened = vi.fn()
    openMaterialInCourse('course-1', 'pdf', 'search-result.pdf', { target: originalTarget, newInstance: true, onOpened })
    expect(openTabMock).toHaveBeenCalledExactlyOnceWith(
      { kind: 'pdf', payload: { courseId: 'course-1', relPath: 'search-result.pdf' } },
      { target: originalTarget, newInstance: true, onOpened }
    )
    expect(onOpened).not.toHaveBeenCalled()
  })

  test.each<WorkspaceRef>([
    { kind: 'course', courseId: 'course-2' },
    { kind: 'project', courseId: 'course-2', rootRelPath: 'Reading' }
  ])('a sidebar click waits for its selected $kind without mixing the resource owner with the old canvas', async destination => {
    materials.activeCourseId = 'course-2'
    const target = { courseId: 'course-2', workspace: destination, windowId: 'selected-window' }
    let finishTarget!: (value: typeof target) => void
    pendingTargetMock.mockReturnValue(new Promise(resolve => { finishTarget = resolve }))
    openMaterialInWorkspace('note', 'selected.md', { newInstance: true })
    expect(openTabMock).not.toHaveBeenCalled()
    expect(selectCourseMock).not.toHaveBeenCalled()
    expect(showCourseWorkspaceMock).not.toHaveBeenCalled()
    workspace.activeWorkspace = destination
    workspace.activeCourseId = 'course-2'
    workspace.activeWindowId = 'selected-window'
    // A subsequent tree update must not change the resource captured by click.
    materials.activeCourseId = 'course-1'
    workspace.activeWorkspace = { kind: 'course', courseId: 'course-1' }
    workspace.activeWindowId = 'another-window'
    finishTarget(target)
    await Promise.resolve()
    expect(showCourseWorkspaceMock).not.toHaveBeenCalled()
    expect(selectCourseMock).not.toHaveBeenCalled()
    expect(openTabMock).toHaveBeenCalledExactlyOnceWith({ kind: 'note', payload: { courseId: 'course-2', relPath: 'selected.md' } }, { newInstance: true, target })
  })

  test('an explicit sidebar target bypasses pending navigation and keeps the original window', () => {
    materials.activeCourseId = 'course-2'
    workspace.activeWindowId = 'other-window'
    pendingTargetMock.mockReturnValue(new Promise(() => {}))
    openMaterialInWorkspace('note', 'original.md', { target: originalTarget })
    expect(pendingTargetMock).not.toHaveBeenCalled()
    expect(openTabMock).toHaveBeenCalledExactlyOnceWith({ kind: 'note', payload: { courseId: 'course-1', relPath: 'original.md' } }, { target: originalTarget })
    expect(showCourseWorkspaceMock).not.toHaveBeenCalled()
  })

  test('an explicitly chosen project is not redirected by the pending sidebar navigation', () => {
    const destination: WorkspaceRef = { kind: 'project', courseId: 'course-1', rootRelPath: 'Original' }
    pendingTargetMock.mockReturnValue(new Promise(() => {}))
    openMaterialInWorkspace('pdf', 'original.pdf', { workspace: destination })
    expect(pendingTargetMock).not.toHaveBeenCalled()
    expect(showCourseWorkspaceMock).toHaveBeenCalledExactlyOnceWith(destination)
    expect(openTabMock).toHaveBeenCalledExactlyOnceWith({ kind: 'pdf', payload: { courseId: 'course-1', relPath: 'original.pdf' } })
  })

  test('a recording keeps the resolved cold window through another internal-window selection', async () => {
    materials.activeCourseId = 'course-2'
    const target = { courseId: 'course-2', workspace: { kind: 'course' as const, courseId: 'course-2' }, windowId: 'saved-window' }
    pendingTargetMock.mockResolvedValue(target)
    let resolveRecording!: (value: unknown) => void
    invokeMock.mockImplementation(channel => channel === 'recordings:resolve' ? new Promise(resolve => { resolveRecording = resolve }) : Promise.resolve({ ok: true }))
    openMaterialInWorkspace('other', 'cold-recording.wav')
    await Promise.resolve()
    workspace.activeWorkspace = target.workspace
    workspace.activeWindowId = 'newer-window'
    materials.activeCourseId = 'course-1'
    resolveRecording({ id: 'cold-recording', title: 'Lecture' })
    await Promise.resolve()
    expect(pendingTargetMock).toHaveBeenCalledTimes(1)
    expect(openTabMock).toHaveBeenCalledExactlyOnceWith({ kind: 'recording', payload: { courseId: 'course-2', sessionId: 'cold-recording', title: 'Lecture' } }, { target })
    expect(showCourseWorkspaceMock).not.toHaveBeenCalled()
  })
})
