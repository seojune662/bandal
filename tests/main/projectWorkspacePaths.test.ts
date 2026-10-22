import { afterEach, expect, test } from 'vitest'
import { createTestDb, type TestDb } from './helpers/testDb'
import { createCoursesRepo } from '../../src/main/features/courses'
import { createLayoutRepo } from '../../src/main/db/layoutRepo'
import { copyProjectWorkspaces, repointProjectWorkspaces } from '../../src/main/db/projectWorkspacePaths'
import { workspaceKey } from '../../src/shared/types/workspace'

let ctx: TestDb | undefined
afterEach(() => ctx?.cleanup())
test('folder rename moves navigation, project layout and chat scope together while preserving source owners', () => {
  ctx = createTestDb()
  const courseId = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx!.dir }).create({ name: 'Owner', color: '#000' }).id
  const repo = createLayoutRepo(ctx.db)
  const descriptor = { kind: 'learning-resource', payload: { courseId, rootRelPath: 'old/project', resource: { kind: 'article', id: 'a' } } }
  const id = `learning-resource:${JSON.stringify([courseId, 'old/project', 'article', 'a'])}`
  const layout = { panels: { [id]: { id, contentComponent: 'learning-resource', params: { descriptor } } }, grid: { root: { type: 'leaf', data: { id: 'g', views: [id], activeView: id } } } }
  repo.save(courseId, layout, 'old/project')
  ctx.db.prepare('INSERT INTO project_navigation(course_id,root_rel_path,sort_order) VALUES(?,?,?)').run(courseId, 'old/project', 7)
  const now = new Date().toISOString()
  ctx.db.prepare('INSERT INTO agent_sessions(id,course_id,provider,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('session', courseId, 'codex', 'idle', now, now)
  ctx.db.prepare('INSERT INTO workspace_chat_sessions(session_id,workspace_key) VALUES(?,?)').run('session', workspaceKey({ kind: 'project', courseId, rootRelPath: 'old/project' }))
  ctx.db.transaction(() => repointProjectWorkspaces(ctx!.db, { courseId, fromRelPath: 'old', toRelPath: 'new', isDirectory: true }))()
  const result = repo.get(courseId, 'new/project').layout as typeof layout
  expect(Object.values(result.panels)[0]?.params.descriptor.payload).toMatchObject({ courseId, rootRelPath: 'new/project', resource: { kind: 'article', id: 'a' } })
  expect(result.grid.root.data.views).toEqual(Object.keys(result.panels))
  expect(ctx.db.prepare('SELECT root_rel_path,sort_order FROM project_navigation').get()).toEqual({ root_rel_path: 'new/project', sort_order: 7 })
  expect(ctx.db.prepare('SELECT workspace_key FROM workspace_chat_sessions').get()).toEqual({ workspace_key: workspaceKey({ kind: 'project', courseId, rootRelPath: 'new/project' }) })
})

test('folder copies inherit group and portable layouts with independent bindings and no copied AI sessions', () => {
  ctx = createTestDb()
  const courseId = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx!.dir }).create({ name: 'Owner', color: '#000' }).id
  ctx.db.prepare('INSERT INTO project_groups(id,name,sort_order) VALUES(?,?,?)').run('g', 'Study', 0)
  ctx.db.prepare('INSERT INTO project_navigation(course_id,root_rel_path,group_id,sort_order) VALUES(?,?,?,?)').run(courseId, 'Reading', 'g', 4)
  const resource = { kind: 'learning-resource', payload: { courseId, rootRelPath: 'Reading', projectId: 'shared-copy-hint', resource: { kind: 'vocabulary' } } }
  const resourceId = `learning-resource:${JSON.stringify([courseId, 'Reading', 'vocabulary', null])}`
  const layout = { panels: { [resourceId]: { id: resourceId, contentComponent: 'learning-resource', params: { descriptor: resource } }, browser: { id: 'browser', params: { descriptor: { kind: 'browser', payload: { tabId: 'live-original' } } } } }, grid: { root: { type: 'leaf', data: { id: 'g', views: [resourceId, 'browser'], activeView: resourceId } } } }
  const repo = createLayoutRepo(ctx.db)
  repo.save(courseId, layout, 'Reading')
  ctx.db.transaction(() => copyProjectWorkspaces(ctx!.db, { courseId, fromRelPath: 'Reading', toRelPath: 'Reading-2', isDirectory: true }))()
  const entries = ctx.db.prepare('SELECT root_rel_path,group_id,sort_order FROM project_navigation ORDER BY sort_order').all()
  expect(entries).toEqual([{ root_rel_path: 'Reading', group_id: 'g', sort_order: 4 }, { root_rel_path: 'Reading-2', group_id: 'g', sort_order: 5 }])
  const copy = repo.get(courseId, 'Reading-2').layout as typeof layout
  expect(Object.values(copy.panels)).toHaveLength(1)
  expect(Object.values(copy.panels)[0]).toMatchObject({ params: { descriptor: { payload: { courseId, rootRelPath: 'Reading-2', projectId: 'shared-copy-hint' } } } })
  expect(repo.get(courseId, 'Reading').layout).toEqual(layout)
  expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM workspace_chat_sessions').get()).toEqual({ n: 0 })
})
