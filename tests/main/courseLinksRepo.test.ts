import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createCourseLinksRepo } from '../../src/main/features/courses/courseLinksRepo'
import type { CourseLinksRepo } from '../../src/main/features/courses/courseLinksRepo'
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

describe('courseLinksRepo', () => {
  let ctx: TestDb
  let repo: CourseLinksRepo

  beforeEach(() => {
    ctx = createTestDb()
    repo = createCourseLinksRepo(ctx.db)
    insertCourse(ctx, 'c1')
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('stores a normalised LMS course link and keeps the raw URL', () => {
    // Arrange / Act
    const link = repo.create({
      courseId: 'c1',
      label: '강의실',
      rawUrl: 'https://myetl.snu.ac.kr/courses/12345/assignments',
      url: 'https://myetl.snu.ac.kr/courses/12345',
      kind: 'lms-course',
      lmsCourseId: '12345'
    })

    // Assert
    expect(link.url).toBe('https://myetl.snu.ac.kr/courses/12345')
    expect(link.rawUrl).toBe('https://myetl.snu.ac.kr/courses/12345/assignments')
    expect(link.lmsCourseId).toBe('12345')
    expect(link.sortOrder).toBe(0)
  })

  test('falls back to the raw URL when no normalised URL is given', () => {
    const link = repo.create({
      courseId: 'c1',
      label: '학과 공지',
      rawUrl: 'cs.snu.ac.kr/notice',
      kind: 'other'
    })

    expect(link.url).toBe('https://cs.snu.ac.kr/notice')
    expect(link.lmsCourseId).toBeNull()
  })

  test('assigns increasing sort order and lists in that order', () => {
    repo.create({ courseId: 'c1', label: 'A', rawUrl: 'https://a.ac.kr/', kind: 'other' })
    repo.create({ courseId: 'c1', label: 'B', rawUrl: 'https://b.ac.kr/', kind: 'other' })

    const links = repo.list({ courseId: 'c1' })

    expect(links.map((link) => link.label)).toEqual(['A', 'B'])
    expect(links.map((link) => link.sortOrder)).toEqual([0, 1])
  })

  test('rejects a non-http(s) URL', () => {
    expect(() =>
      repo.create({
        courseId: 'c1',
        label: 'bad',
        rawUrl: 'javascript:alert(1)',
        kind: 'other'
      })
    ).toThrow(/\[validation\]/)
  })

  test('rejects an unknown kind and a blank label', () => {
    expect(() =>
      repo.create({
        courseId: 'c1',
        label: '  ',
        rawUrl: 'https://a.ac.kr/',
        kind: 'other'
      })
    ).toThrow(/\[validation\]/)
    expect(() =>
      repo.create({
        courseId: 'c1',
        label: 'x',
        rawUrl: 'https://a.ac.kr/',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        kind: 'nonsense' as never
      })
    ).toThrow(/\[validation\]/)
  })

  test('rejects a link for a course that does not exist', () => {
    expect(() =>
      repo.create({
        courseId: 'ghost',
        label: 'x',
        rawUrl: 'https://a.ac.kr/',
        kind: 'other'
      })
    ).toThrow(/\[not-found\]/)
  })

  test('renames a link without touching its URL', () => {
    const created = repo.create({
      courseId: 'c1',
      label: '강의실',
      rawUrl: 'https://myetl.snu.ac.kr/courses/1',
      kind: 'lms-course',
      lmsCourseId: '1'
    })

    const updated = repo.update({ id: created.id, label: '자료구조 강의실' })

    expect(updated.label).toBe('자료구조 강의실')
    expect(updated.url).toBe(created.url)
  })

  test('deletes a link and reports not-found afterwards', () => {
    const created = repo.create({
      courseId: 'c1',
      label: 'x',
      rawUrl: 'https://a.ac.kr/',
      kind: 'other'
    })

    expect(repo.delete({ id: created.id })).toEqual({ ok: true })
    expect(repo.list({ courseId: 'c1' })).toEqual([])
    expect(() => repo.delete({ id: created.id })).toThrow(/\[not-found\]/)
  })

  test('links are scoped per course', () => {
    insertCourse(ctx, 'c2')
    repo.create({ courseId: 'c1', label: 'A', rawUrl: 'https://a.ac.kr/', kind: 'other' })
    repo.create({ courseId: 'c2', label: 'B', rawUrl: 'https://b.ac.kr/', kind: 'other' })

    expect(repo.list({ courseId: 'c1' }).map((l) => l.label)).toEqual(['A'])
    expect(repo.list({ courseId: 'c2' }).map((l) => l.label)).toEqual(['B'])
  })
})
