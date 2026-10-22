import { projectBindingKey, type ProjectNavigation } from '../../../../shared/projectNavigation'
import type { LearningProjectSummary } from '../../../../shared/types/learning'

export function initializeProjectNavigation(projects: LearningProjectSummary[]): ProjectNavigation {
  const purposes = [['english-reading', '영어 이어읽기'], ['course-review', '과목 복습'], ['unclassified', '종류 확인 필요']] as const
  const groups = purposes.filter(([purpose]) => projects.some(project => (project.purpose ?? 'unclassified') === purpose)).map(([purpose, name], sortOrder) => ({ id: `project-group-${purpose}`, name, sortOrder }))
  const entries = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((project, sortOrder) => ({ ...project.binding, sortOrder, groupId: groups.find(group => group.id === `project-group-${project.purpose ?? 'unclassified'}`)?.id ?? null }))
  return { groups, entries, initialized: true, revision: 0 }
}

export function moveProject(nav: ProjectNavigation, key: string, groupId: string | null, before?: string): ProjectNavigation {
  const moved = nav.entries.find(entry => projectBindingKey(entry) === key)
  if (!moved || groupId !== null && !nav.groups.some(group => group.id === groupId)) return nav
  const entries = nav.entries.filter(entry => projectBindingKey(entry) !== key)
  const index = before ? entries.findIndex(entry => projectBindingKey(entry) === before) : -1
  entries.splice(index < 0 ? entries.length : index, 0, { ...moved, groupId })
  return { ...nav, entries: entries.map((entry, sortOrder) => ({ ...entry, sortOrder })) }
}
