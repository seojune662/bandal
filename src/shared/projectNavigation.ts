import type { LearningBinding } from './types/learning'

export interface ProjectGroup { id: string; name: string; sortOrder: number }
export interface ProjectNavigationEntry extends LearningBinding { groupId: string | null; sortOrder: number }
export interface ProjectNavigation { groups: ProjectGroup[]; entries: ProjectNavigationEntry[]; initialized: boolean; revision: number }
export interface ProjectNavigationContract {
  'projects:navigation': { req: Record<string, never>; res: ProjectNavigation }
  'projects:saveNavigation': { req: Pick<ProjectNavigation, 'groups' | 'entries' | 'revision'>; res: ProjectNavigation }
}
export const PROJECT_NAVIGATION_CHANNELS = ['projects:navigation', 'projects:saveNavigation'] as const
export const projectBindingKey = (binding: LearningBinding): string => JSON.stringify([binding.courseId, binding.rootRelPath])
