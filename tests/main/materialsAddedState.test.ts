import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createCoursesRepo } from '../../src/main/features/courses/coursesRepo'
import { createMaterialsRepo } from '../../src/main/features/materials/materialsRepo'
import { createMaterialAddedState } from '../../src/main/features/materials/materialAddedState'
import { createNotesRepo } from '../../src/main/features/notes/notesRepo'
import { createCanvasRepo } from '../../src/main/features/canvas/canvasRepo'
import { createRecordingRepo } from '../../src/main/features/recordings/recordingRepo'
import { DEFAULT_SPEECH_MODEL } from '../../src/shared/recording'
import { createTestDb, type TestDb } from './helpers/testDb'

let ctx: TestDb
let now = Date.parse('2026-10-13T09:00:00Z')
beforeEach(() => {
  ctx = createTestDb()
  now = Date.parse('2026-10-13T09:00:00Z')
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})
afterEach(() => { vi.restoreAllMocks(); ctx.cleanup() })

function setup() {
  const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'courses') })
  const course = courses.create({ name: '자료 표시', color: 'blue' })
  let folder = course.folderPath
  const deps = { db: ctx.db, getCourseFolder: () => folder, revealItem: () => {}, trashItem: async (path: string) => { rmSync(path, { recursive: true }) } }
  return { course, deps, repo: createMaterialsRepo(deps), setFolder: (value: string) => { folder = value } }
}

test('first scan baselines old files; discovered additions keep their time across edits, restart, search and cache rebuild', async () => {
  const { course, deps, repo } = setup()
  writeFileSync(join(course.folderPath, 'old.md'), '# old')
  expect((await repo.tree(course.id))[0].addedAt).toBeUndefined()
  writeFileSync(join(course.folderPath, 'new.md'), '# new')
  repo.invalidateTree(course.id)
  expect((await repo.tree(course.id)).find(node => node.name === 'new.md')?.addedAt).toBe(now)
  const addedAt = now
  now += 25 * 60 * 60 * 1000
  writeFileSync(join(course.folderPath, 'new.md'), '# changed')
  repo.invalidateTree(course.id)
  await repo.tree(course.id)
  expect((await repo.search(course.id, 'new'))[0].addedAt).toBe(addedAt)
  const restarted = createMaterialsRepo(deps)
  expect(restarted.snapshot(course.id)?.find(node => node.name === 'new.md')?.addedAt).toBe(addedAt)
  ctx.db.prepare('DELETE FROM materials_index WHERE course_id = ?').run(course.id)
  ctx.db.prepare('DELETE FROM material_tree_snapshots WHERE course_id = ?').run(course.id)
  expect((await restarted.tree(course.id)).find(node => node.name === 'new.md')?.addedAt).toBe(addedAt)
})

test('explicit creation and importing an old file are new before the first baseline', async () => {
  const { course, repo } = setup()
  writeFileSync(join(course.folderPath, 'existing.md'), '# old')
  const source = join(ctx.dir, 'imported.md')
  writeFileSync(source, '# imported')
  repo.import(course.id, [source])
  repo.writeFile({ courseId: course.id, dirRelPath: '', fileName: 'created.md', encoding: 'utf8', data: '# created' })
  const tree = await repo.tree(course.id)
  expect(tree.find(node => node.name === 'existing.md')?.addedAt).toBeUndefined()
  expect(tree.find(node => node.name === 'created.md')?.addedAt).toBe(now)
  expect(tree.find(node => node.name === 'imported.md')?.addedAt).toBe(now)
})

test('file and containing-folder rename or move preserve added time while copies receive a new time', async () => {
  const { course, repo } = setup()
  mkdirSync(join(course.folderPath, 'folder'))
  const created = repo.writeFile({ courseId: course.id, dirRelPath: 'folder', fileName: 'original.md', encoding: 'utf8', data: 'hello' })
  await repo.tree(course.id)
  const addedAt = now
  now += 5000
  await repo.rename({ courseId: course.id, relPath: created.relPath, newName: 'renamed.md' })
  await repo.rename({ courseId: course.id, relPath: 'folder', newName: 'renamed-folder' })
  const copy = repo.duplicate({ courseId: course.id, relPath: 'renamed-folder' })
  let tree = await repo.tree(course.id)
  expect(tree.find(node => node.name === 'renamed-folder')?.children?.[0].addedAt).toBe(addedAt)
  expect(tree.find(node => node.relPath === copy.relPath)?.children?.[0].addedAt).toBe(now)
  await repo.move({ courseId: course.id, fromRelPath: 'renamed-folder/renamed.md', toDirRelPath: '' })
  tree = await repo.tree(course.id)
  expect(tree.find(node => node.name === 'renamed.md')?.addedAt).toBe(addedAt)
})

test('first truncated scan remains a baseline and never prunes unseen durable state', async () => {
  const { course, deps } = setup()
  const state = createMaterialAddedState(ctx.db, deps.getCourseFolder)
  state.recordAdded(course.id, 'explicit.md')
  await state.reconcile(course.id, [{ relPath: 'old.md', name: 'old.md', kind: 'note' }], false, () => true)
  expect(state.timestamps(course.id).get('explicit.md')).toBe(now)
  await state.reconcile(course.id, [
    { relPath: 'old.md', name: 'old.md', kind: 'note' },
    { relPath: 'unseen-old.md', name: 'unseen-old.md', kind: 'note' },
    { relPath: 'explicit.md', name: 'explicit.md', kind: 'note' }
  ], true, () => true)
  expect(state.timestamps(course.id).has('unseen-old.md')).toBe(false)
  expect(state.timestamps(course.id).get('explicit.md')).toBe(now)
})

test('duplicating a folder into a recently deleted copy path renews every copied file', async () => {
  const { course, repo } = setup()
  mkdirSync(join(course.folderPath, 'source'))
  writeFileSync(join(course.folderPath, 'source', 'file.md'), 'old')
  await repo.tree(course.id)
  const first = repo.duplicate({ courseId: course.id, relPath: 'source' })
  await repo.tree(course.id)
  rmSync(join(course.folderPath, first.relPath), { recursive: true })
  now += 5000
  const second = repo.duplicate({ courseId: course.id, relPath: 'source' })
  expect(second.relPath).toBe(first.relPath)
  expect((await repo.tree(course.id)).find(node => node.relPath === second.relPath)?.children?.[0].addedAt).toBe(now)
})

test('a completed folder copy stops lending its timestamp to later external additions', async () => {
  const { course, repo } = setup()
  mkdirSync(join(course.folderPath, 'source'))
  writeFileSync(join(course.folderPath, 'source', 'copied.md'), 'copied')
  await repo.tree(course.id)
  const copy = repo.duplicate({ courseId: course.id, relPath: 'source' })
  const copiedAt = now
  expect((await repo.tree(course.id)).find(node => node.relPath === copy.relPath)?.children?.[0].addedAt).toBe(copiedAt)
  expect(ctx.db.prepare('SELECT pending_children FROM material_added_state WHERE course_id = ? AND rel_path = ?')
    .get(course.id, copy.relPath)).toBeUndefined()
  now += 25 * 60 * 60 * 1000
  writeFileSync(join(course.folderPath, copy.relPath, 'later.md'), 'later')
  repo.invalidateTree(course.id)
  const copiedChildren = (await repo.tree(course.id)).find(node => node.relPath === copy.relPath)?.children
  expect(copiedChildren?.find(node => node.name === 'copied.md')?.addedAt).toBe(copiedAt)
  expect(copiedChildren?.find(node => node.name === 'later.md')?.addedAt).toBe(now)
})

test('finishing a scan preserves a newer pending directory copy recorded while its batch yielded', async () => {
  const { course, deps } = setup()
  const state = createMaterialAddedState(ctx.db, deps.getCourseFolder)
  await state.reconcile(course.id, [], true, () => true)
  state.recordAdded(course.id, 'copy', true)
  const file = { relPath: 'copy/file.md', name: 'file.md', kind: 'note' as const }
  const pending = state.reconcile(course.id, [file], true, () => true)
  // reconcile has written its first batch and yielded before pruning markers.
  now += 5000
  state.recordAdded(course.id, 'copy', true)
  await pending
  expect(ctx.db.prepare('SELECT added_at, pending_children FROM material_added_state WHERE course_id = ? AND rel_path = ?')
    .get(course.id, 'copy')).toEqual({ added_at: now, pending_children: 1 })
  await state.reconcile(course.id, [file], true, () => true)
  expect(state.timestamps(course.id).get(file.relPath)).toBe(now)
  expect(state.timestamps(course.id).has('copy')).toBe(false)
})

test('relinking to a different folder baselines its files and removes stale snapshot timestamps', async () => {
  const { course, repo, setFolder } = setup()
  repo.writeFile({ courseId: course.id, dirRelPath: '', fileName: 'same.md', encoding: 'utf8', data: 'new here' })
  await repo.tree(course.id)
  const replacement = join(ctx.dir, 'replacement')
  mkdirSync(replacement)
  writeFileSync(join(replacement, 'same.md'), 'existing elsewhere')
  setFolder(replacement)
  expect(repo.snapshot(course.id)).toBeNull()
  expect((await repo.tree(course.id))[0].addedAt).toBeUndefined()
})

test('a confirmed deletion followed by an external re-addition starts a new time', async () => {
  const { course, repo } = setup()
  const created = repo.writeFile({ courseId: course.id, dirRelPath: '', fileName: 'again.md', encoding: 'utf8', data: 'first' })
  await repo.tree(course.id)
  await repo.softDelete({ courseId: course.id, relPath: created.relPath })
  await repo.tree(course.id)
  now += 5000
  writeFileSync(join(course.folderPath, created.relPath), 'second')
  repo.invalidateTree(course.id)
  expect((await repo.tree(course.id))[0].addedAt).toBe(now)
})

test('note creation hooks include write-to-missing, but editing and renaming do not renew timestamps', async () => {
  const { course, deps, repo } = setup()
  const notes = createNotesRepo({ getCourseFolder: deps.getCourseFolder,
    onCreated: note => repo.recordAdded(note.courseId, note.relPath),
    onPathChanged: change => repo.repointAddedState(change.courseId, change.fromRelPath, change.toRelPath, false) })
  const note = notes.create({ courseId: course.id, dirRelPath: '', title: 'first' })
  const addedAt = now
  now += 5000
  notes.write({ ...note, markdown: '# edited' })
  await notes.rename({ ...note, newName: 'renamed' })
  notes.write({ courseId: course.id, relPath: 'written.md', markdown: '# new write' })
  const tree = await repo.tree(course.id)
  expect(tree.find(node => node.name === 'renamed.md')?.addedAt).toBe(addedAt)
  expect(tree.find(node => node.name === 'written.md')?.addedAt).toBe(now)
})

test('new recording audio is marked before baseline while existing whiteboards remain unmarked', async () => {
  const { course, deps, repo } = setup()
  const recording = createRecordingRepo(ctx.db, deps.getCourseFolder,
    session => repo.recordAdded(session.courseId, session.audioRelPath)).create(course.id, '수업', DEFAULT_SPEECH_MODEL)
  expect((await repo.search(course.id, 'audio.wav'))[0]).toMatchObject({ relPath: recording.audioRelPath, addedAt: now })
  const canvas = createCanvasRepo(ctx.db)
  const board = canvas.createBoard({ courseId: course.id })
  expect(board.addedAt).toEqual(Date.parse(board.createdAt))
  expect(canvas.renameBoard({ id: board.id, title: 'renamed' }).addedAt).toBe(board.addedAt)
  ctx.db.prepare('UPDATE whiteboards SET added_at = NULL WHERE id = ?').run(board.id)
  expect(canvas.listBoards(course.id)[0].addedAt).toBeUndefined()
})
