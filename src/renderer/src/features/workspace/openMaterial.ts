/**
 * Glue for the materials sidebar: clicking a file opens it as a
 * workspace tab (pdf/md/images) or reveals it in Finder (other files).
 * Kept here (not in the materials feature)
 * so the sidebar only needs a one-line call.
 */

import { sameWorkspace, workspaceKey, type WorkspaceRef } from '../../../../shared/types/workspace'
import { DEFAULT_WORKSPACE_WINDOW_ID, workspaceWindowKey } from '../../../../shared/workspaceWindows'
import type { TabDescriptor } from '../../../../shared/tabs'
import type { MaterialKind } from '../../../../shared/types/materials'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { useMaterialsStore } from '../../stores/materialsStore'
import { capturePendingWorkspaceTarget, useWorkspaceStore } from '../../stores/workspaceStore'
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { descriptorFor } from './tabIdentity'
import { isViewableFile } from '../file/fileFormats'
import { captureActiveWorkspaceTarget } from './captureWorkspaceTarget'
import type { WorkspaceTarget } from './placementContext'

interface OpenMaterialOptions {
  newInstance?: boolean
  workspace?: WorkspaceRef | null
  navigateToOwner?: boolean
  target?: WorkspaceTarget
  onOpened?: (panelId: string) => void
}

export const MATERIAL_OPEN_DEDUPE_MS = 5 * 60 * 1000

const materialOpenRecordedAt = new Map<string, number>()
let latestOpenRequest = 0
const latestOpenRequestsByWindow = new Map<string, number>()

/** Pure duplicate decision used by the renderer-side activity throttle. */
export function shouldRecordMaterialOpen(
  lastRecordedAt: number | undefined,
  now: number,
  dedupeMs = MATERIAL_OPEN_DEDUPE_MS
): boolean {
  return (
    lastRecordedAt === undefined ||
    now < lastRecordedAt ||
    now - lastRecordedAt >= dedupeMs
  )
}

function recordMaterialOpened(courseId: string, relPath: string): void {
  const key = `${courseId}\u0000${relPath}`
  const now = Date.now()
  if (!shouldRecordMaterialOpen(materialOpenRecordedAt.get(key), now)) return
  materialOpenRecordedAt.set(key, now)

  void invoke('activity:record', {
    courseId,
    kind: 'material-opened',
    relPath,
    summary: `${relPath}을(를) 열었습니다.`
  }).catch(() => {})
}

export function openMaterialInWorkspace(
  kind: MaterialKind,
  relPath: string,
  options?: OpenMaterialOptions
): void {
  const courseId = options?.target ? options.target.courseId : useMaterialsStore.getState().activeCourseId
  if (courseId === null) return
  const pendingTarget = options?.target || options?.workspace || options?.navigateToOwner ? undefined : capturePendingWorkspaceTarget()
  if (pendingTarget) {
    // Capture both the clicked resource and requested canvas. A later course
    // selection must neither redirect nor discard this explicit file open.
    void pendingTarget.then(target => openMaterialInCourse(courseId, kind, relPath, { ...options, target }))
      .catch(() => showToast('원래 작업 영역을 읽지 못해 자료를 열지 못했어요. 다시 시도해 주세요.', 'danger'))
    return
  }
  openMaterialInCourse(courseId, kind, relPath, { ...options, workspace: options?.workspace ?? useWorkspaceStore.getState().activeWorkspace })
}

/**
 * [M6-A] Course-explicit variant for callers that know their course (⌘P
 * quick search) — the materials store's activeCourseId only tracks the
 * sidebar, which may be closed.
 */
export function openMaterialInCourse(
  courseId: string,
  kind: MaterialKind,
  relPath: string,
  options?: OpenMaterialOptions
): void {
  const request = ++latestOpenRequest
  const initialWorkspace = useWorkspaceStore.getState()
  const initialCourse = useCoursesStore.getState().selectedCourseId
  const destination = options?.target?.workspace ?? (options?.navigateToOwner ? { kind: 'course' as const, courseId } : options?.workspace ?? initialWorkspace.activeWorkspace ?? { kind: 'course' as const, courseId })
  const isRecording = relPath.toLowerCase().endsWith('.wav')
  const target = options?.target ?? (isRecording && sameWorkspace(destination, initialWorkspace.activeWorkspace) ? captureActiveWorkspaceTarget() : undefined)
  const requestWindow = workspaceWindowKey(workspaceKey(destination), target?.windowId ?? initialWorkspace.activeWindowId ?? DEFAULT_WORKSPACE_WINDOW_ID)
  latestOpenRequestsByWindow.set(requestWindow, request)
  const stillRequested = (): boolean => {
    if (latestOpenRequestsByWindow.get(requestWindow) !== request) return false
    if (target) return true
    const current = useWorkspaceStore.getState()
    return current.surface === initialWorkspace.surface &&
      current.activeWorkspaceKey === initialWorkspace.activeWorkspaceKey &&
      current.activeWindowId === initialWorkspace.activeWindowId &&
      current.activePanelId === initialWorkspace.activePanelId &&
      useCoursesStore.getState().selectedCourseId === initialCourse
  }
  const finishReveal = (): void => {
    const current = useWorkspaceStore.getState()
    if (stillRequested() && sameWorkspace(current.activeWorkspace, destination) &&
        current.activeWindowId === (target?.windowId ?? initialWorkspace.activeWindowId)) {
      useUiStore.getState().closeMaterialsExpanded()
    }
  }
  const openTab = (descriptor: TabDescriptor): void => {
    const courses = useCoursesStore.getState()
    if (!courses.courses.some(course => course.id === courseId)) {
      showToast('원본 과목을 찾을 수 없어요.', 'danger')
      return
    }
    const openOptions = { ...(options?.newInstance === true ? { newInstance: true } : {}), ...(options?.onOpened ? { onOpened: options.onOpened } : {}) }
    if (target) {
      useWorkspaceStore.getState().openTab(descriptor, { target, ...openOptions })
      return
    }
    if (courses.selectedCourseId !== destination.courseId) courses.selectCourse(destination.courseId, { preserveSurface: true })
    useWorkspaceStore.getState().showWorkspace(destination)
    if (options?.newInstance === true || options?.onOpened) {
      useWorkspaceStore.getState().openTab(descriptor, openOptions)
      return
    }
    useWorkspaceStore.getState().openTab(descriptor)
  }

  if (isRecording) {
    void invoke('recordings:resolve', { courseId, relPath }).then((recording) => {
      if (!stillRequested()) return
      if (recording) {
        openTab(descriptorFor('recording', {
          courseId, sessionId: recording.id, title: recording.title
        }))
        recordMaterialOpened(courseId, relPath)
      } else {
        void invoke('materials:reveal', { courseId, relPath }).then(finishReveal).catch(() =>
          showToast('파일을 열지 못했습니다.', 'danger'))
      }
    }).catch(() => { if (stillRequested()) showToast('녹음 파일을 열지 못했습니다.', 'danger') })
    return
  }

  if (kind === 'other' && isViewableFile(relPath)) {
    openTab(descriptorFor('file', { courseId, relPath }))
    recordMaterialOpened(courseId, relPath)
    return
  }
  // 동영상은 범용 파일 탭으로 연다 — FileTab 의 'video' 분기(현재는 자리표시자,
  // VideoTab 워커가 bandal-media 스트리밍 뷰어로 교체)가 렌더링을 맡는다.
  if (kind === 'video') {
    openTab(descriptorFor('file', { courseId, relPath }))
    recordMaterialOpened(courseId, relPath)
    return
  }
  if (kind === 'pdf' || kind === 'note' || kind === 'image') {
    openTab(descriptorFor(kind, { courseId, relPath }))
    recordMaterialOpened(courseId, relPath)
    return
  }
  // Unsupported files are handed off to Finder.
  void invoke('materials:reveal', { courseId, relPath })
    .then(() => {
      recordMaterialOpened(courseId, relPath)
      finishReveal()
    })
    .catch((error: unknown) => {
      console.error('[Bandal] 파일 위치를 열지 못했습니다.', error)
      showToast('파일 위치를 열지 못했습니다.', 'danger')
    })
}
