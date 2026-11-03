import type { LearningProjectSnapshot } from '../../../../shared/types/learning'

export function learningNeedsSettings(project: Pick<LearningProjectSnapshot, 'purpose' | 'readingSetupConfirmed' | 'ai'>): boolean {
  return !project.purpose || project.purpose === 'unclassified' || !project.ai?.model || project.purpose === 'english-reading' && !project.readingSetupConfirmed
}
