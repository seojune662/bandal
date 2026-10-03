import type { LearningBinding } from '../../../../shared/types/learning'
import type { LearningView } from '../../../../shared/tabs'
import { useCoursesStore } from '../../stores/coursesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'

export const LEARNING_CHANGED_EVENT = 'bandal:learning-changed'

export function notifyLearningChanged(): void {
  window.dispatchEvent(new Event(LEARNING_CHANGED_EVENT))
}

export function openLearning(binding: LearningBinding, view: LearningView = 'home', itemId?: string): void {
  useCoursesStore.getState().selectCourse(binding.courseId)
  useWorkspaceStore.getState().setActiveCourse(binding.courseId)
  useWorkspaceStore.getState().openTab(descriptorFor('learning', {
    ...binding, view, ...(itemId === undefined ? {} : { itemId })
  }))
}

export function openLearningOverview(courseId: string): void {
  useCoursesStore.getState().selectCourse(courseId)
  useWorkspaceStore.getState().setActiveCourse(courseId)
  useWorkspaceStore.getState().openTab(descriptorFor('learning', { courseId }))
}

export function learningError(error: unknown): string {
  return error instanceof Error ? error.message : '학습 자료를 처리하지 못했어요.'
}
