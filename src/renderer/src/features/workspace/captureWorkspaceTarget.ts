import { workspaceKey } from '../../../../shared/types/workspace'
import { DEFAULT_WORKSPACE_WINDOW_ID, workspaceWindowKey, type WorkspaceWindowRef } from '../../../../shared/workspaceWindows'
import { useWorkspaceStore, workspaceApiForWindow } from '../../stores/workspaceStore'
import type { WorkspaceTarget } from './placementContext'

/** Keep delayed creation in the window and split that initiated the request. */
export function captureActiveWorkspaceTarget(): (WorkspaceTarget & WorkspaceWindowRef) | undefined {
  const state = useWorkspaceStore.getState()
  const workspace = state.activeWorkspace
  if (state.surface !== 'course' || !workspace) return undefined
  const windowId = state.activeWindowId ?? DEFAULT_WORKSPACE_WINDOW_ID
  const key = state.activeWindowKey ?? workspaceWindowKey(workspaceKey(workspace), windowId)
  const groupId = workspaceApiForWindow(key)?.activeGroup?.id
  return { courseId: workspace.courseId, workspace, windowId, ...(groupId ? { groupId } : {}) }
}
