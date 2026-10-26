import { workspaceWindowFromKey } from '../../../../shared/workspaceWindows'
import { workspaceFromKey } from '../../../../shared/types/workspace'
import { showToast } from '../../app/toast'
import { useCoursesStore } from '../../stores/coursesStore'
import { moveWorkspacePanel, useWorkspaceStore, workspaceApiForWindow, type WorkspacePanelMovePosition } from '../../stores/workspaceStore'
import { beginWorkspaceCourseMoveDrop, finishWorkspaceCourseMoveDrop, isWorkspaceCourseMoveDropCurrent, navigateWorkspaceCourseHover } from './courseTabMoveNavigation'
import type { WorkspaceTabDragSource } from './tabDragSession'

/** Course selection mounts Dockview asynchronously, even when its layout is cached. */
function waitForCourseWorkspace(courseId: string): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    let stopWorkspace = (): void => {}
    let stopCourses = (): void => {}
    const timer = setTimeout(() => finish(false), 15_000)
    const finish = (ready: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer); stopWorkspace(); stopCourses(); resolve(ready)
    }
    const check = (): void => {
      const courses = useCoursesStore.getState(), state = useWorkspaceStore.getState()
      if (courses.selectedCourseId !== workspaceFromKey(courseId).courseId || !courses.courses.some(course => course.id === workspaceFromKey(courseId).courseId)) { finish(false); return }
      const base = workspaceWindowFromKey(courseId).workspaceKey
      if (state.activeWorkspaceKey !== base || (courseId !== base && state.activeWindowKey !== courseId)) return
      if (state.hydration === 'error' || state.surface !== 'course') { finish(false); return }
      if (state.hydration === 'ready' && workspaceApiForWindow(state.activeWindowKey)) finish(true)
    }
    stopWorkspace = useWorkspaceStore.subscribe(check)
    stopCourses = useCoursesStore.subscribe(check)
    check()
  })
}

/** A row drop and a canvas drop use the same retained, one-shot transfer. */
export async function dropWorkspaceTabOnCourse(
  source: WorkspaceTabDragSource,
  targetCourseId: string,
  position?: WorkspacePanelMovePosition
): Promise<boolean> {
  const base = workspaceWindowFromKey(targetCourseId).workspaceKey
  if (source.courseId === targetCourseId || !beginWorkspaceCourseMoveDrop(source.nonce)) return false
  let accepted = false
  try {
    if (useWorkspaceStore.getState().activeWorkspaceKey !== base && !navigateWorkspaceCourseHover(source.nonce, targetCourseId)) return false
    if (!await waitForCourseWorkspace(targetCourseId)) {
      if (isWorkspaceCourseMoveDropCurrent(source.nonce) && useCoursesStore.getState().selectedCourseId === workspaceFromKey(targetCourseId).courseId && useWorkspaceStore.getState().activeWorkspaceKey === base)
        showToast('과목을 불러오지 못해 탭을 옮기지 못했어요. 원래 과목의 탭은 그대로 있어요.', 'danger')
      return false
    }
    // A subscriber may navigate again in the same turn that hydration becomes
    // ready, before this continuation runs. Do not commit behind that choice.
    const state = useWorkspaceStore.getState(), destinationKey = state.activeWindowKey, api = workspaceApiForWindow(destinationKey)
    if (!isWorkspaceCourseMoveDropCurrent(source.nonce) || useWorkspaceStore.getState().activeWorkspaceKey !== base || state.activeWorkspaceKey !== base || state.hydration !== 'ready' || state.surface !== 'course' || state.windowsOverviewOpen || !api || !destinationKey || (targetCourseId !== base && destinationKey !== targetCourseId)) return false
    const target = position ?? (api.activeGroup ? { groupId: api.activeGroup.id, direction: 'within' as const, index: api.activeGroup.panels.length } : undefined)
    accepted = await moveWorkspacePanel({ sourceCourseId: source.courseId, panelId: source.panelId, targetCourseId: destinationKey, ...(target ? { position: target } : {}) })
    return accepted
  } catch (error) {
    console.error('[Bandal] 탭 이동을 마무리하지 못했습니다.', error)
    showToast('탭을 옮기지 못했어요. 원래 과목에서 다시 시도해 주세요.', 'danger')
    return false
  } finally { finishWorkspaceCourseMoveDrop(source.nonce, accepted) }
}
