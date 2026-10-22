import { afterEach, beforeEach, expect, test } from 'vitest'
import { createProjectNavigationRepo } from '../../src/main/db/projectNavigationRepo'
import { createCoursesRepo } from '../../src/main/features/courses'
import { createTestDb, type TestDb } from './helpers/testDb'
let ctx: TestDb
beforeEach(() => { ctx = createTestDb() })
afterEach(() => ctx.cleanup())
test('persists groups separately for two projects under one course and keeps them after cache changes', () => {
  const courseId = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir }).create({ name: 'Course', color: '#000' }).id
  const repo = createProjectNavigationRepo(ctx.db)
  expect(repo.get().initialized).toBe(false)
  const state = repo.save({ revision: repo.get().revision, groups: [{ id: 'one', name: '시험', sortOrder: 0 }], entries: [{ courseId, rootRelPath: 'A', groupId: 'one', sortOrder: 0 }, { courseId, rootRelPath: 'B', groupId: null, sortOrder: 1 }] })
  expect(createProjectNavigationRepo(ctx.db).get()).toEqual(state)
  expect(state.initialized).toBe(true)
  const next = repo.save({ revision: repo.get().revision, groups: [], entries: state.entries.map(entry => ({ ...entry, groupId: null })) })
  expect(next.entries).toHaveLength(2)
  expect(next.entries.every(entry => entry.groupId === null)).toBe(true)
})
test('invalid membership or path cannot partially overwrite navigation', () => {
  const courseId = createCoursesRepo({ db: ctx.db, getDataRoot: () => ctx.dir }).create({ name: 'Course', color: '#000' }).id
  const repo = createProjectNavigationRepo(ctx.db)
  const initial = repo.save({ revision: repo.get().revision, groups: [], entries: [{ courseId, rootRelPath: '', groupId: null, sortOrder: 0 }] })
  expect(() => repo.save({ revision: repo.get().revision, groups: [], entries: [{ courseId, rootRelPath: '../escape', groupId: null, sortOrder: 0 }] })).toThrow()
  expect(() => repo.save({ revision: repo.get().revision, groups: [], entries: [{ courseId, rootRelPath: 'safe', groupId: 'missing', sortOrder: 0 }] })).toThrow()
  expect(repo.get()).toEqual(initial)
})


test('a stale window cannot overwrite a moved project or a newer group order', () => {
  const repo = createProjectNavigationRepo(ctx.db)
  const before = repo.get()
  repo.save({ ...before, groups: [{ id: 'one', name: '새 그룹', sortOrder: 0 }] })
  expect(() => repo.save(before)).toThrow('다른 작업에서 변경')
  expect(repo.get().groups[0]?.name).toBe('새 그룹')
})
