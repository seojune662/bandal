import type { Database } from 'better-sqlite3'
import type { ProjectNavigation, ProjectGroup, ProjectNavigationEntry } from '../../shared/projectNavigation'
import { ValidationError } from './errors'
import { requireId, requireInt, requireNonEmptyString } from './validate'

/** Navigation is durable metadata, independent of the rediscoverable learning cache. */
export function createProjectNavigationRepo(db: Database): { get(): ProjectNavigation; save(input: { groups: ProjectGroup[]; entries: ProjectNavigationEntry[]; revision: number }): ProjectNavigation } {
  const revision = (): number => Number((db.prepare("SELECT value FROM app_workspace_metadata WHERE key = 'projects-navigation-revision'").get() as { value: string } | undefined)?.value ?? 0)
  const get = (): ProjectNavigation => ({
    revision: revision(),
    groups: db.prepare('SELECT id, name, sort_order AS sortOrder FROM project_groups ORDER BY sort_order, id').all() as ProjectGroup[],
    entries: db.prepare('SELECT course_id AS courseId, root_rel_path AS rootRelPath, group_id AS groupId, sort_order AS sortOrder FROM project_navigation ORDER BY sort_order').all() as ProjectNavigationEntry[],
    initialized: !!db.prepare("SELECT 1 FROM app_workspace_metadata WHERE key = 'project-navigation-initialized'").get()
  })
  const write = db.transaction((input: { groups: ProjectGroup[]; entries: ProjectNavigationEntry[]; revision: number }) => {
    if (requireInt(input.revision, 'revision', 0) !== revision()) throw new ValidationError('프로젝트 목록이 다른 작업에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.')
    if (!Array.isArray(input.groups) || !Array.isArray(input.entries) || input.groups.length > 1000 || input.entries.length > 10000) throw new ValidationError('프로젝트 목록이 올바르지 않습니다.')
    const groups = input.groups.map((group, index) => ({ id: requireId(group.id, 'groupId'), name: requireNonEmptyString(group.name, 'name').slice(0, 120), sortOrder: index }))
    if (new Set(groups.map(group => group.id)).size !== groups.length) throw new ValidationError('그룹이 중복되었습니다.')
    const ids = new Set(groups.map(group => group.id))
    const seen = new Set<string>()
    const entries = input.entries.map((entry, index) => {
      const courseId = requireId(entry.courseId, 'courseId')
      if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) throw new ValidationError('프로젝트의 과목을 찾을 수 없습니다.')
      if (typeof entry.rootRelPath !== 'string' || (/^[A-Za-z]:/.test(entry.rootRelPath) || /[\u0000-\u001f]/.test(entry.rootRelPath) || entry.rootRelPath.startsWith('/')) || entry.rootRelPath.includes('\\') || entry.rootRelPath.split('/').some(part => part === '..' || part === '.')) throw new ValidationError('프로젝트 경로가 올바르지 않습니다.')
      const key = JSON.stringify([courseId, entry.rootRelPath])
      if (seen.has(key)) throw new ValidationError('프로젝트가 중복되었습니다.')
      seen.add(key)
      if (entry.groupId !== null && !ids.has(entry.groupId)) throw new ValidationError('그룹을 찾을 수 없습니다.')
      return { courseId, rootRelPath: entry.rootRelPath, groupId: entry.groupId, sortOrder: index }
    })
    db.prepare('DELETE FROM project_navigation').run()
    db.prepare('DELETE FROM project_groups').run()
    const groupInsert = db.prepare('INSERT INTO project_groups(id, name, sort_order) VALUES (?, ?, ?)')
    for (const group of groups) groupInsert.run(group.id, group.name, group.sortOrder)
    const entryInsert = db.prepare('INSERT INTO project_navigation(course_id, root_rel_path, group_id, sort_order) VALUES (?, ?, ?, ?)')
    for (const entry of entries) entryInsert.run(entry.courseId, entry.rootRelPath, entry.groupId, entry.sortOrder)
    db.prepare("INSERT OR REPLACE INTO app_workspace_metadata(key, value) VALUES ('project-navigation-initialized', 'true')").run()
    db.prepare("INSERT OR REPLACE INTO app_workspace_metadata(key, value) VALUES ('projects-navigation-revision', ?)").run(String(input.revision + 1))
  })
  return { get, save(input) { write(input); return get() } }
}
