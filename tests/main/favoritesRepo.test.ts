import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createFavoritesRepo,
  type FavoritesRepo
} from '../../src/main/features/favorites/favoritesRepo'
import type { TabDescriptor } from '../../src/shared/tabs'
import { createTestDb, type TestDb } from './helpers/testDb'

function insertCourse(ctx: TestDb, id: string): void {
  const now = new Date().toISOString()
  ctx.db
    .prepare(
      `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                            sort_order, created_at, updated_at)
       VALUES (?, ?, ?, '#000', ?, 0, 0, ?, ?)`
    )
    .run(id, `과목 ${id}`, id, `/tmp/${id}`, now, now)
}

const pdfDescriptor: TabDescriptor = {
  kind: 'pdf',
  payload: { courseId: 'c1', relPath: 'slides/week-1.pdf' }
}

const boardDescriptor: TabDescriptor = { kind: 'board', payload: {} }

describe('favoritesRepo', () => {
  let ctx: TestDb
  let repo: FavoritesRepo

  beforeEach(() => {
    ctx = createTestDb()
    insertCourse(ctx, 'c1')
    insertCourse(ctx, 'c2')
    repo = createFavoritesRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('stores validated descriptors and assigns increasing per-course order', () => {
    const first = repo.add({
      courseId: 'c1',
      label: '  1주차 슬라이드  ',
      descriptor: pdfDescriptor
    })
    const second = repo.add({
      courseId: 'c1',
      label: '보드',
      descriptor: boardDescriptor
    })
    const otherCourse = repo.add({
      courseId: 'c2',
      label: '다른 과목',
      descriptor: boardDescriptor
    })

    expect(first.label).toBe('1주차 슬라이드')
    expect([first.sortOrder, second.sortOrder, otherCourse.sortOrder]).toEqual([
      0, 1, 0
    ])
    expect(repo.list('c1').map((favorite) => favorite.descriptor)).toEqual([
      pdfDescriptor,
      boardDescriptor
    ])
  })

  test('supports app-global favorites independently from course favorites', () => {
    repo.add({ courseId: 'c1', label: '과목 보드', descriptor: boardDescriptor })
    const global = repo.add({
      courseId: null,
      label: '전역 보드',
      descriptor: boardDescriptor
    })

    expect(repo.list(null)).toEqual([global])
    expect(repo.list('c1')).toHaveLength(1)
  })

  test('rejects malformed and non-serializable descriptors before insert', () => {
    expect(() =>
      repo.add({
        courseId: 'c1',
        label: '잘못된 PDF',
        descriptor: {
          kind: 'pdf',
          payload: { courseId: 'c1' }
        } as never
      })
    ).toThrow(/\[validation\].*TabDescriptor/)

    const cyclicPayload: Record<string, unknown> = {}
    cyclicPayload['self'] = cyclicPayload
    expect(() =>
      repo.add({
        courseId: 'c1',
        label: '순환 보드',
        descriptor: { kind: 'board', payload: cyclicPayload } as TabDescriptor
      })
    ).toThrow(/\[validation\].*JSON-serializable/)
    expect(repo.list('c1')).toEqual([])
  })

  test('skips rows with broken JSON or invalid descriptors while listing', () => {
    const healthy = repo.add({
      courseId: 'c1',
      label: '정상',
      descriptor: pdfDescriptor
    })
    const now = new Date().toISOString()
    const insert = ctx.db.prepare(
      `INSERT INTO favorites
         (id, course_id, label, descriptor_json, sort_order, created_at, updated_at)
       VALUES (?, 'c1', ?, ?, ?, ?, ?)`
    )
    insert.run('broken-json', '손상', '{nope', 1, now, now)
    insert.run(
      'wrong-shape',
      'descriptor 아님',
      JSON.stringify({ kind: 'pdf', payload: { relPath: 'x.pdf' } }),
      2,
      now,
      now
    )

    expect(repo.list('c1')).toEqual([healthy])
  })

  test('renames and soft-deletes an active favorite', () => {
    const created = repo.add({
      courseId: 'c1',
      label: '이전 이름',
      descriptor: pdfDescriptor
    })

    const renamed = repo.rename({ id: created.id, label: '새 이름' })
    repo.softDelete(created.id)

    expect(renamed.label).toBe('새 이름')
    expect(renamed.descriptor).toEqual(pdfDescriptor)
    expect(repo.list('c1')).toEqual([])
    expect(() => repo.softDelete(created.id)).toThrow(/\[not-found\]/)
  })

  test('reorders the complete course list and rejects cross-course ids', () => {
    const first = repo.add({
      courseId: 'c1',
      label: 'A',
      descriptor: pdfDescriptor
    })
    const second = repo.add({
      courseId: 'c1',
      label: 'B',
      descriptor: boardDescriptor
    })
    const foreign = repo.add({
      courseId: 'c2',
      label: 'C',
      descriptor: boardDescriptor
    })

    repo.reorder({ courseId: 'c1', ids: [second.id, first.id] })
    expect(repo.list('c1').map((favorite) => favorite.label)).toEqual(['B', 'A'])
    expect(repo.list('c1').map((favorite) => favorite.sortOrder)).toEqual([0, 1])
    expect(() =>
      repo.reorder({ courseId: 'c1', ids: [first.id, foreign.id] })
    ).toThrow(/\[validation\]/)
    expect(repo.list('c1').map((favorite) => favorite.label)).toEqual(['B', 'A'])
  })

  test('rolls every sort update back when one statement in reorder fails', () => {
    const first = repo.add({
      courseId: 'c1',
      label: 'A',
      descriptor: pdfDescriptor
    })
    const second = repo.add({
      courseId: 'c1',
      label: 'B',
      descriptor: boardDescriptor
    })
    ctx.db.exec(
      `CREATE TRIGGER reject_second_favorite_move
       BEFORE UPDATE OF sort_order ON favorites
       WHEN NEW.id = '${first.id}' AND NEW.sort_order = 1
       BEGIN
         SELECT RAISE(ABORT, 'forced reorder failure');
       END`
    )

    expect(() =>
      repo.reorder({ courseId: 'c1', ids: [second.id, first.id] })
    ).toThrow(/forced reorder failure/)

    expect(repo.list('c1').map((favorite) => [favorite.label, favorite.sortOrder]))
      .toEqual([
        ['A', 0],
        ['B', 1]
      ])
  })
})
