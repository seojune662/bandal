import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createActivityRepo, createContextWriter } from '../../../src/main/features/context'
import { createTestDb } from '../helpers/testDb'

/** Renders a realistic dossier and asserts the parts that matter. */
describe('COURSE.md dossier', () => {
  test('renders a course the student has actually used', () => {
    const ctx = createTestDb()
    const folder = mkdtempSync(join(tmpdir(), 'bandal-dossier-'))
    const now = new Date().toISOString()

    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c1', '자료구조', 'ds', '#000', ?, 0, 0, ?, ?)`
      )
      .run(folder, now, now)

    ctx.db
      .prepare(
        `INSERT INTO annotations (id, course_id, rel_path, page, color,
                                  rects_json, anchor_json, comment, created_at, updated_at)
         VALUES ('a1', 'c1', 'Chap1.pdf', 3, 'yellow', '[]', ?, '시험 나올듯', ?, ?)`
      )
      .run(
        JSON.stringify({ quote: '해시 충돌은 체이닝으로 해결한다', prefix: '', suffix: '' }),
        now,
        now
      )

    ctx.db
      .prepare(
        `INSERT INTO board_tasks (id, course_id, title, notes, status, due_at,
                                  sort_order, created_at, updated_at)
         VALUES ('t1', 'c1', '3장 과제 제출', '', 'todo', ?, 0, ?, ?)`
      )
      .run('2026-08-20T00:00:00.000Z', now, now)

    const activity = createActivityRepo(ctx.db)
    activity.record({
      courseId: 'c1',
      kind: 'highlight-created',
      relPath: 'Chap1.pdf',
      summary: 'Chap1.pdf 3쪽을 강조했습니다: "해시 충돌은 체이닝으로 해결한다"'
    })

    const writer = createContextWriter({
      getCourseFolder: () => folder,
      getCourse: () => ({ name: '자료구조' }),
      activity,
      db: ctx.db
    })

    const { relPath } = writer.rebuild('c1')
    const text = readFileSync(join(folder, relPath), 'utf8')

    // The three things the agent could never see before.
    expect(text).toContain('해시 충돌은 체이닝으로 해결한다') // highlight
    expect(text).toContain('3장 과제 제출') // board task
    expect(text).toContain('강조했습니다') // activity

    // Quoted third-party material must be framed as data, not instructions —
    // the agent reads lecture PDFs it did not author.
    expect(text).toMatch(/데이터|지시가 아니|instruction/i)

    // Lives under a dotdir so the materials tree and watcher skip it.
    expect(relPath.startsWith('.bandal/')).toBe(true)

    ctx.cleanup()
  })

  test('a course with nothing in it still produces a readable file', () => {
    const ctx = createTestDb()
    const folder = mkdtempSync(join(tmpdir(), 'bandal-dossier-empty-'))
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c2', '빈 과목', 'empty', '#000', ?, 0, 0, ?, ?)`
      )
      .run(folder, now, now)

    const writer = createContextWriter({
      getCourseFolder: () => folder,
      getCourse: () => ({ name: '빈 과목' }),
      activity: createActivityRepo(ctx.db),
      db: ctx.db
    })

    expect(() => writer.rebuild('c2')).not.toThrow()
    ctx.cleanup()
  })
})
