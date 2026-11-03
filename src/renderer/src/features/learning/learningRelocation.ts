import type { LearningBinding, LearningProjectSummary } from '../../../../shared/types/learning'

/** A copy can share an id; the original folder must be absent before recovery. */
export function findMovedLearningBinding(original: LearningBinding, projectId: string, projects: LearningProjectSummary[]): LearningBinding | null {
  const peers = projects.filter(project => project.binding.courseId === original.courseId)
  if (peers.some(project => project.binding.rootRelPath === original.rootRelPath)) return null
  const candidates = peers.filter(project => project.projectId === projectId && !project.warning)
  return candidates.length === 1 ? candidates[0]!.binding : null
}
