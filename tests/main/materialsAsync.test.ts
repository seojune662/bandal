import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTestDb, type TestDb } from './helpers/testDb'
import { createCoursesRepo } from '../../src/main/features/courses/coursesRepo'
import { createMaterialsRepo } from '../../src/main/features/materials/materialsRepo'
import { scanMaterialTree, type MaterialWalk } from '../../src/main/features/materials/scanMaterialTree'
let ctx: TestDb
beforeEach(() => { ctx = createTestDb() })
afterEach(() => ctx.cleanup())
function setup(scan = scanMaterialTree) {
  const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'courses') })
  const course = courses.create({ name: '비동기 자료', color: 'blue' })
  const deps = { db: ctx.db, getCourseFolder: () => course.folderPath, revealItem: () => {}, trashItem: async () => {}, scan }
  return { course, deps, repo: createMaterialsRepo(deps) }
}
test('persisted snapshots are immediately available to a new repository without a scan', async () => {
  const { course, deps, repo } = setup()
  writeFileSync(join(course.folderPath, 'hello.md'), '# hello')
  expect(repo.snapshot(course.id)).toBeNull()
  const tree = await repo.tree(course.id)
  const reopened = createMaterialsRepo({ ...deps, scan: async () => { throw new Error('offline') } })
  expect(reopened.snapshot(course.id)).toEqual(tree)
  await expect(reopened.tree(course.id)).rejects.toThrow('offline')
  expect(reopened.snapshot(course.id)).toEqual(tree)
})
test('a superseded scan cannot publish its tree or remove newly written index rows', async () => {
  let finish!: (value: MaterialWalk) => void
  let calls = 0
  const { course, repo } = setup(async (folder, limits) => {
    if (++calls === 1) return new Promise(resolve => { finish = resolve })
    return scanMaterialTree(folder, limits)
  })
  const first = repo.tree(course.id)
  await new Promise(resolve => setTimeout(resolve, 10))
  writeFileSync(join(course.folderPath, 'new.md'), '# new')
  repo.invalidateTree(course.id)
  const second = repo.tree(course.id)
  finish({ nodes: [], files: [], truncation: new Set() })
  expect((await first).map(node => node.relPath)).toEqual(['new.md'])
  expect(await second).toEqual(repo.snapshot(course.id))
  expect(calls).toBe(2)
})
test('a missing child during traversal never publishes an empty course', async () => {
  const { course, deps, repo } = setup()
  writeFileSync(join(course.folderPath, 'keep.md'), '# keep')
  const tree = await repo.tree(course.id)
  const failing = createMaterialsRepo({ ...deps, scan: async () => { throw Object.assign(new Error('child removed'), { code: 'ENOENT' }) } })
  await expect(failing.tree(course.id)).rejects.toThrow('child removed')
  expect(failing.snapshot(course.id)).toEqual(tree)
})
test('snapshots from another folder are not restored after a relink', async () => {
  const { course, deps, repo } = setup()
  writeFileSync(join(course.folderPath, 'old.md'), '# old')
  await repo.tree(course.id)
  const replacement = join(ctx.dir, 'new-folder')
  mkdirSync(replacement)
  const linked = createMaterialsRepo({ ...deps, getCourseFolder: () => replacement })
  expect(linked.snapshot(course.id)).toBeNull()
  expect(await linked.tree(course.id)).toEqual([])
})

test('malformed disposable snapshots are ignored and rebuilt', async () => {
  const { course, repo } = setup()
  ctx.db.prepare('INSERT INTO material_tree_snapshots (course_id, folder, tree) VALUES (?, ?, ?)')
    .run(course.id, course.folderPath, JSON.stringify([{ name: 'broken', kind: 'dir', children: {} }]))
  expect(repo.snapshot(course.id)).toBeNull()
  writeFileSync(join(course.folderPath, 'valid.md'), '# valid')
  expect((await repo.tree(course.id)).map(node => node.relPath)).toEqual(['valid.md'])
})
