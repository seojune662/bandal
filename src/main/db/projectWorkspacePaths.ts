import type { Database } from 'better-sqlite3'
import type { LearningRepointInput } from '../features/learning/learningRepo'
import { workspaceFromKey, workspaceKey } from '../../shared/types/workspace'
import { rewriteWorkspaceLayoutPaths } from '../../shared/workspaceLayoutPaths'
import { isWorkspaceWindows, mapWorkspaceWindowLayouts } from '../../shared/workspaceWindows'
import { remapWorkspacePanelIds } from '../../shared/workspacePanelIds'
import { randomUUID } from 'node:crypto'

/** Runs with the durable learning-path outbox acknowledgement transaction. */
export function repointProjectWorkspaces(db: Database, input: LearningRepointInput): void {
  let navigationMoved = false
  const hasTable = (name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
  const nextPath = (path: string): string => path === input.fromRelPath || input.isDirectory && path.startsWith(`${input.fromRelPath}/`)
    ? `${input.toRelPath}${path.slice(input.fromRelPath.length)}` : path
  for (const table of ['project_navigation', 'project_tabs_layout'] as const) {
    if (!hasTable(table)) continue
    const rows = db.prepare(`SELECT root_rel_path FROM ${table} WHERE course_id=?`).all(input.courseId) as { root_rel_path: string }[]
    for (const row of rows) {
      const root = nextPath(row.root_rel_path)
      if (root === row.root_rel_path) continue
      db.prepare(`UPDATE ${table} SET root_rel_path=? WHERE course_id=? AND root_rel_path=?`).run(root, input.courseId, row.root_rel_path)
      if (table === 'project_navigation') navigationMoved = true
    }
  }
  if (navigationMoved && hasTable('app_workspace_metadata')) db.prepare("INSERT INTO app_workspace_metadata(key,value) VALUES('projects-navigation-revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)").run()
  if (hasTable('workspace_chat_sessions')) {
    const rows = db.prepare('SELECT DISTINCT workspace_key FROM workspace_chat_sessions').all() as { workspace_key: string }[]
    for (const row of rows) {
      const ref = workspaceFromKey(row.workspace_key)
      if (ref.kind !== 'project' || ref.courseId !== input.courseId) continue
      const rootRelPath = nextPath(ref.rootRelPath)
      if (rootRelPath !== ref.rootRelPath) db.prepare('UPDATE workspace_chat_sessions SET workspace_key=? WHERE workspace_key=?').run(workspaceKey({ ...ref, rootRelPath }), row.workspace_key)
    }
  }
  for (const table of ['tabs_layout', 'project_tabs_layout'] as const) {
    if (!hasTable(table)) continue
    const rows = db.prepare(`SELECT rowid AS rid,layout_json FROM ${table}`).all() as { rid: number; layout_json: string }[]
    for (const row of rows) {
      let raw: unknown
      try { raw = JSON.parse(row.layout_json) } catch { continue }
      const result = rewriteWorkspaceLayoutPaths(raw, input)
      if (result.changed) db.prepare(`UPDATE ${table} SET layout_json=? WHERE rowid=?`).run(JSON.stringify(result.layout), row.rid)
    }
  }
}

/** A copied folder is a new workspace; only portable document placements follow it. */
export function copyProjectWorkspaces(db: Database, input: LearningRepointInput): void {
  const hasTable = (name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
  if (!input.isDirectory || !hasTable('project_navigation') || !hasTable('project_tabs_layout')) return
  const nextPath = (path: string): string | null => path === input.fromRelPath || path.startsWith(`${input.fromRelPath}/`) ? `${input.toRelPath}${path.slice(input.fromRelPath.length)}` : null
  const navigation = db.prepare('SELECT root_rel_path,group_id FROM project_navigation WHERE course_id=? ORDER BY sort_order').all(input.courseId) as { root_rel_path: string; group_id: string | null }[]
  let moved = false
  for (const row of navigation) {
    const root = nextPath(row.root_rel_path)
    if (root === null) continue
    const order = (db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS value FROM project_navigation WHERE group_id IS ?').get(row.group_id) as { value: number }).value
    const result = db.prepare('INSERT OR IGNORE INTO project_navigation(course_id,root_rel_path,group_id,sort_order) VALUES(?,?,?,?)').run(input.courseId, root, row.group_id, order)
    moved ||= result.changes > 0
  }
  if (moved && hasTable('app_workspace_metadata')) db.prepare("INSERT INTO app_workspace_metadata(key,value) VALUES('projects-navigation-revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT)").run()
  const layouts = db.prepare('SELECT root_rel_path,layout_json FROM project_tabs_layout WHERE course_id=?').all(input.courseId) as { root_rel_path: string; layout_json: string }[]
  for (const row of layouts) {
    const root = nextPath(row.root_rel_path)
    if (root === null) continue
    let raw: any
    try { raw = JSON.parse(row.layout_json) } catch { continue }
    const rewritten = rewriteWorkspaceLayoutPaths(raw, input).layout
    if (!isWorkspaceWindows(rewritten) && (!rewritten || typeof rewritten !== 'object' || !('panels' in rewritten) || !('grid' in rewritten))) continue
    const layout = mapWorkspaceWindowLayouts(rewritten, value => {
      const layout = value as any
      if (!layout || typeof layout !== 'object' || !layout.panels || !layout.grid) return value
      for (const [id, panel] of Object.entries(layout.panels) as [string, any][]) {
        if (['browser', 'chat', 'plugin-panel'].includes(panel?.params?.descriptor?.kind)) delete layout.panels[id]
      }
      const visit = (node: any): void => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node.data)) { node.data.forEach(visit); return }
        if (!Array.isArray(node.data?.views)) return
        node.data.views = node.data.views.filter((id: string) => layout.panels[id])
        if (!node.data.views.includes(node.data.activeView)) {
          if (node.data.views.length) node.data.activeView = node.data.views[0]
          else delete node.data.activeView
        }
      }
      visit(layout.grid.root)
      return remapWorkspacePanelIds(layout, id => `${id.split('::duplicate::')[0]}::duplicate::${randomUUID()}`).layout
    })
    const now = new Date().toISOString()
    db.prepare('INSERT OR IGNORE INTO project_tabs_layout(course_id,root_rel_path,layout_json,created_at,updated_at) VALUES(?,?,?,?,?)').run(input.courseId, root, JSON.stringify(layout), now, now)
  }
}
