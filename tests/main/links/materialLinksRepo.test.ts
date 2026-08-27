import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { TabDescriptor } from '../../../src/shared/tabs'
import {
  createMaterialLinksRepo,
  type MaterialLinksRepo
} from '../../../src/main/features/links/materialLinksRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE_ID = 'course-links'

function insertCourse(ctx: TestDb, id = COURSE_ID): void {
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO courses
       (id, name, slug, color, folder_path, archived, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(id, '링크 테스트', id, 'blue', `/tmp/${id}`, now, now)
}

function descriptor(
  kind: 'pdf' | 'note' | 'image' | 'file',
  relPath: string,
  courseId = COURSE_ID
): TabDescriptor {
  return { kind, payload: { courseId, relPath } } as TabDescriptor
}

describe('createMaterialLinksRepo', () => {
  let ctx: TestDb
  let repo: MaterialLinksRepo

  beforeEach(() => {
    ctx = createTestDb()
    insertCourse(ctx)
    repo = createMaterialLinksRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('serializes descriptors and returns the existing row for a duplicate pair', () => {
    const source = descriptor('pdf', 'slides/week-1.pdf')
    const target = descriptor('note', 'notes/week-1.md')

    const first = repo.create({
      courseId: COURSE_ID,
      source,
      target,
      label: '복습'
    })
    const duplicate = repo.create({
      courseId: COURSE_ID,
      source,
      target,
      label: '바뀐 이름'
    })

    expect(duplicate).toEqual(first)
    expect(repo.listFor(COURSE_ID, 'slides/week-1.pdf').outgoing).toEqual([
      first
    ])
    expect(
      ctx.db.prepare('SELECT COUNT(*) AS count FROM material_links').get()
    ).toEqual({ count: 1 })
  })

  test('rejects a self-link without inserting a row', () => {
    const source = descriptor('pdf', 'same.pdf')

    expect(() =>
      repo.create({
        courseId: COURSE_ID,
        source,
        target: source,
        label: ''
      })
    ).toThrow(/\[validation\].*source and target must be different/)
    expect(repo.listFor(COURSE_ID, 'same.pdf')).toEqual({
      outgoing: [],
      incoming: []
    })
  })

  test('matches outgoing and incoming paths by NFC and lowercase keys', () => {
    const sourcePath = '자료/강의.PDF'.normalize('NFD')
    const targetPath = '필기/요약.MD'.normalize('NFD')
    const created = repo.create({
      courseId: COURSE_ID,
      source: descriptor('pdf', sourcePath),
      target: descriptor('note', targetPath),
      label: '핵심'
    })

    expect(repo.listFor(COURSE_ID, '자료/강의.pdf').outgoing).toEqual([
      created
    ])
    expect(repo.listFor(COURSE_ID, '필기/요약.md').incoming).toEqual([
      created
    ])
    expect(repo.listFor(COURSE_ID, '없는.pdf')).toEqual({
      outgoing: [],
      incoming: []
    })
  })

  test('removes only the requested course link', () => {
    const created = repo.create({
      courseId: COURSE_ID,
      source: descriptor('image', 'diagram.png'),
      target: descriptor('note', 'notes.md'),
      label: ''
    })

    expect(repo.remove(COURSE_ID, created.id)).toEqual({ ok: true })
    expect(repo.listFor(COURSE_ID, 'diagram.png').outgoing).toEqual([])
    expect(() => repo.remove(COURSE_ID, created.id)).toThrow(/\[not-found\]/)
  })
})
