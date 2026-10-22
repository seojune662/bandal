/** Layout placement is independent of the original owner of an open document. */
import type { Database } from 'better-sqlite3'
import { ValidationError } from './errors'
import { nowIso, requireId } from './validate'
import { workspaceKey } from '../../shared/types/workspace'

export interface LayoutEntry { courseId: string; projectRootRelPath?: string; layout: unknown }
export interface LayoutRepo {
  get(courseId: string, projectRootRelPath?: string): { layout: unknown | null; legacyProjectLayout?: boolean }
  save(courseId: string, layout: unknown, projectRootRelPath?: string): { ok: true }
  saveMany(layouts: LayoutEntry[]): { ok: true }
}

function validRoot(value: string | undefined): void {
  if (value !== undefined && (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f]/.test(value) || (value !== '' && value.split('/').some(part => !part || part === '.' || part === '..')))) {
    throw new ValidationError('Invalid project layout root')
  }
}
function record(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** Old nested projects shared their course layout. Never steal unrelated panes. */
export function selectLegacyProjectLayout(raw: unknown, courseId: string, rootRelPath: string): unknown {
  if (!record(raw) || !record(raw.panels) || !record(raw.grid)) return raw
  const panels = Object.fromEntries(Object.entries(raw.panels).filter(([, panel]) => {
    if (!record(panel)) return false
    const descriptor = panel.params?.descriptor
    const payload = descriptor?.payload
    if (!record(payload) || payload.courseId !== courseId) return false
    if (descriptor.kind === 'learning' || descriptor.kind === 'learning-resource') return payload.rootRelPath === rootRelPath
    return rootRelPath !== '' && typeof payload.relPath === 'string' && (payload.relPath === rootRelPath || payload.relPath.startsWith(`${rootRelPath}/`))
  }))
  const prune = (node: any): any => {
    if (!record(node)) return null
    if (Array.isArray(node.data)) { const children = node.data.map(prune).filter(Boolean); return children.length ? { ...node, data: children } : null }
    if (!record(node.data) || !Array.isArray(node.data.views)) return null
    const views = node.data.views.filter((id: string) => panels[id])
    return views.length ? { ...node, data: { ...node.data, views, activeView: views.includes(node.data.activeView) ? node.data.activeView : views[0] } } : null
  }
  return { ...raw, panels, grid: { ...raw.grid, root: prune(raw.grid.root) ?? { type: 'branch', data: [] } } }
}

export function createLayoutRepo(db: Database): LayoutRepo {
  function assertCourseExists(courseId: string): void {
    if (!db.prepare('SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL').get(courseId)) throw new ValidationError(`courseId "${courseId}" does not exist`)
  }
  const key = (courseId: string, root?: string): string => workspaceKey(root === undefined ? { kind: 'course', courseId } : { kind: 'project', courseId, rootRelPath: root })
  const read = (courseId: string, root?: string): { layout_json: string } | undefined => root === undefined
    ? db.prepare('SELECT layout_json FROM tabs_layout WHERE course_id = ?').get(courseId) as { layout_json: string } | undefined
    : db.prepare('SELECT layout_json FROM project_tabs_layout WHERE course_id = ? AND root_rel_path = ?').get(courseId, root) as { layout_json: string } | undefined
  function serialize(entry: LayoutEntry): LayoutEntry & { json: string } {
    const courseId = requireId(entry.courseId, 'courseId')
    validRoot(entry.projectRootRelPath); assertCourseExists(courseId)
    let json: string | undefined
    try { json = JSON.stringify(entry.layout) } catch { throw new ValidationError('layout must be JSON-serializable') }
    if (json === undefined) throw new ValidationError('layout must be JSON-serializable')
    return { ...entry, courseId, json }
  }
  const writeMany = db.transaction((entries: ReturnType<typeof serialize>[]) => {
    const now = nowIso()
    for (const entry of entries) {
      const old = read(entry.courseId, entry.projectRootRelPath) ?? read(entry.courseId)
      if (old) db.prepare('INSERT OR IGNORE INTO workspace_layout_backups(scope_key,layout_json,created_at) VALUES(?,?,?)').run(key(entry.courseId, entry.projectRootRelPath), old.layout_json, now)
      if (entry.projectRootRelPath === undefined) {
        db.prepare(`INSERT INTO tabs_layout(course_id,layout_json,created_at,updated_at) VALUES(?,?,?,?)
          ON CONFLICT(course_id) DO UPDATE SET layout_json=excluded.layout_json,updated_at=excluded.updated_at`).run(entry.courseId, entry.json, now, now)
      } else {
        db.prepare(`INSERT INTO project_tabs_layout(course_id,root_rel_path,layout_json,created_at,updated_at) VALUES(?,?,?,?,?)
          ON CONFLICT(course_id,root_rel_path) DO UPDATE SET layout_json=excluded.layout_json,updated_at=excluded.updated_at`).run(entry.courseId, entry.projectRootRelPath, entry.json, now, now)
      }
    }
  })
  return {
    get(courseId, projectRootRelPath) {
      const id = requireId(courseId, 'courseId'); validRoot(projectRootRelPath)
      let row = read(id, projectRootRelPath)
      const legacyProjectLayout = projectRootRelPath !== undefined && row === undefined
      if (legacyProjectLayout) row = read(id)
      if (!row) return { layout: null }
      try {
        let layout: unknown = JSON.parse(row.layout_json)
        if (legacyProjectLayout) {
          const course = db.prepare('SELECT workspace_kind FROM courses WHERE id=?').get(id) as { workspace_kind: string } | undefined
          if (course?.workspace_kind !== 'study-space' || projectRootRelPath !== '') layout = selectLegacyProjectLayout(layout, id, projectRootRelPath!)
        }
        return { layout, ...(legacyProjectLayout ? { legacyProjectLayout: true } : {}) }
      } catch (error) { console.error(`[layout] corrupt layout for ${id}:`, error); throw new ValidationError('저장된 작업 공간을 읽지 못했습니다. 원본은 보존되어 있어요.') }
    },
    save(courseId, layout, projectRootRelPath) {
      writeMany([serialize({ courseId, layout, ...(projectRootRelPath === undefined ? {} : { projectRootRelPath }) })]); return { ok: true }
    },
    saveMany(layouts) {
      if (!Array.isArray(layouts) || layouts.length === 0) throw new ValidationError('layouts are required')
      const entries = layouts.map(serialize)
      if (new Set(entries.map(entry => key(entry.courseId, entry.projectRootRelPath))).size !== entries.length) throw new ValidationError('workspaces must be distinct')
      writeMany(entries); return { ok: true }
    }
  }
}
