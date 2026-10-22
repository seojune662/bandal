import type { LearningBinding } from '../../../../shared/types/learning'
import type { LearningView, LearningResourcePayload } from '../../../../shared/tabs'
import { useCoursesStore } from '../../stores/coursesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { workspaceKey, type WorkspaceRef } from '../../../../shared/types/workspace'
import { invoke } from '../../lib/ipc'
import { useUiStore } from '../../stores/uiStore'

export function openLearningHome(): void {
  const ui = useUiStore.getState()
  ui.closeSettings(); ui.closeBoardOverlay(); ui.closeLinkGraph()
  ui.setHomeTab('learning')
  useCoursesStore.getState().selectCourse(null, { preserveSurface: true })
  useWorkspaceStore.getState().showWorkspace(null)
}

export function returnToCourseWorkspace(courseId?: string): void {
  const courses = useCoursesStore.getState()
  const target = courseId ?? courses.selectedCourseId
  if (target && !courses.courses.some(course => course.id === target)) return
  courses.selectCourse(target)
  useUiStore.getState().showCourses()
}

export const RECENT_ENGLISH_KEY = 'bandal:lastEnglishBinding'
export function rememberEnglishBinding(binding: LearningBinding): void { try { localStorage.setItem(RECENT_ENGLISH_KEY, JSON.stringify(binding)) } catch { /* The explicit picker remains available. */ } }

export const LEARNING_CHANGED_EVENT = 'bandal:learning-changed'

export function notifyLearningChanged(): void {
  window.dispatchEvent(new Event(LEARNING_CHANGED_EVENT))
}

export function openLearningResource(binding: LearningBinding, resource: LearningResourcePayload['resource'], placement?: WorkspaceRef | null): void {
  const state = useWorkspaceStore.getState()
  const workspace = placement ?? state.activeWorkspace ?? { kind: 'project' as const, ...binding }
  if (workspace.courseId !== useCoursesStore.getState().selectedCourseId) useCoursesStore.getState().selectCourse(workspace.courseId, { preserveSurface: true })
  state.showWorkspace(workspace)
  state.openTab(descriptorFor('learning-resource', { ...binding, resource }))
}

/** Compatibility entry point: a project is a workspace, never a mutable dashboard tab. */
export function openLearning(binding: LearningBinding, view: LearningView = 'home', itemId?: string): void {
  const workspace: WorkspaceRef = { kind: 'project', ...binding }
  useCoursesStore.getState().selectCourse(binding.courseId, { preserveSurface: true })
  useUiStore.getState().setHomeTab('learning')
  useWorkspaceStore.getState().showWorkspace(workspace)
  if (view === 'vocabulary') openLearningResource(binding, { kind: 'vocabulary' }, workspace)
  else if (view === 'reader' && itemId) openLearningResource(binding, { kind: 'article', id: itemId }, workspace)
  else if (view === 'review' && itemId) openLearningResource(binding, { kind: 'artifact', id: itemId }, workspace)
  else if (view === 'reader') void invoke('learning:get', { binding }).then(project => {
    const article = project.articles.find(item => item.status === 'reading') ?? project.articles.find(item => item.status === 'unread') ?? project.articles.at(-1)
    if (article && useWorkspaceStore.getState().activeWorkspaceKey === workspaceKey(workspace)) openLearningResource(binding, { kind: 'article', id: article.id }, workspace)
  }).catch(() => {})
}

export function learningError(error: unknown): string {
  return error instanceof Error ? error.message : '학습 자료를 처리하지 못했어요.'
}
