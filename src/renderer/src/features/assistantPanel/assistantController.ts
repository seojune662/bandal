import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import type { LearningBinding } from '../../../../shared/types/learning'
import { workspaceKey, type WorkspaceRef } from '../../../../shared/types/workspace'
import { useWorkspaceAssistantStore } from './workspaceAssistantStore'
import { updateComposerDraft } from '../chat/composerDraftStore'

// Retained as a compatibility registration API for restored tabs.
export function registerAssistantController(_panelId: string, _controller: { courseId: string | null; open: boolean; show(): void; focus(): void }, _workspaceCourseId?: string | null): () => void { return () => {} }
export function activeAssistantWorkspace(): WorkspaceRef | null {
  const state = useWorkspaceStore.getState()
  return state.activeWorkspace ?? (state.activeCourseId ? { kind: 'course', courseId: state.activeCourseId } : null)
}
export function openWorkspaceAssistant(workspace: WorkspaceRef, options: { conversationId?: string; text?: string } = {}): string {
  if (useWorkspaceStore.getState().activeWorkspaceKey !== workspaceKey(workspace)) {
    if (useCoursesStore.getState().selectedCourseId !== workspace.courseId) useCoursesStore.getState().selectCourse(workspace.courseId, { preserveSurface: true })
    useWorkspaceStore.getState().showWorkspace(workspace)
  }
  useUiStore.getState().setRightRailScope(workspaceKey(workspace))
  const conversationId = useWorkspaceAssistantStore.getState().select(workspace, options.conversationId)
  if (options.text) updateComposerDraft(conversationId, draft => ({ text: draft.text ? `${draft.text}\n\n${options.text}` : options.text! }))
  useUiStore.getState().showAssistant()
  window.dispatchEvent(new CustomEvent('bandal:focus-assistant', { detail: { conversationId } }))
  return conversationId
}
export function openActiveAssistant(): void {
  useWorkspaceStore.getState().afterWorkspaceTransition(() => {
    const workspace = activeAssistantWorkspace()
    if (workspace) openWorkspaceAssistant(workspace)
    else useUiStore.getState().showAssistant()
  })
}
export function useActiveAssistantOpen(): boolean {
  return useUiStore(state => state.rightRailOpen && state.rightRailTab === 'ai')
}
export async function openChosenAssistant(choice: { courseId: string; binding?: LearningBinding }): Promise<void> {
  if (!useCoursesStore.getState().courses.some(course => course.id === choice.courseId)) throw new Error('선택한 공간을 찾을 수 없어요.')
  const workspace: WorkspaceRef = choice.binding ? { kind: 'project', ...choice.binding } : { kind: 'course', courseId: choice.courseId }
  useWorkspaceStore.getState().showWorkspace(workspace)
  openWorkspaceAssistant(workspace)
}
export function resetAssistantControllersForTests(): void {}
