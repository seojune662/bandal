import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ActivityKind } from '../../../src/shared/types/study'
import { createInsights } from '../../../src/main/features/insights'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE_ID = 'course-insights'
const NOW = new Date('2026-08-08T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

describe('createInsights', () => {
  let ctx: TestDb
  let insights: ReturnType<typeof createInsights>
  let sequence: number

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    ctx = createTestDb()
    sequence = 0
    const createdAt = isoDaysFromNow(-1)
    ctx.db
      .prepare(
        `INSERT INTO courses
           (id, name, slug, color, folder_path, archived, sort_order,
            created_at, updated_at)
         VALUES (?, '운영체제', 'os-insights', '#000', ?, 0, 0, ?, ?)`
      )
      .run(COURSE_ID, ctx.dir, createdAt, createdAt)
    insights = createInsights({
      db: ctx.db,
      getCourseFolder: () => ctx.dir
    })
  })

  afterEach(() => {
    ctx.cleanup()
    vi.useRealTimers()
  })

  function isoDaysFromNow(days: number): string {
    return new Date(NOW.getTime() + days * DAY_MS).toISOString()
  }

  function addMaterial(
    relPath: string,
    ageDays: number,
    kind: 'pdf' | 'note' | 'image' | 'other' = 'pdf'
  ): void {
    sequence += 1
    ctx.db
      .prepare(
        `INSERT INTO materials_index
           (id, course_id, rel_path, kind, size, mtime, created_at, updated_at)
         VALUES (?, ?, ?, ?, 10, ?, ?, ?)`
      )
      .run(
        `material-${sequence}`,
        COURSE_ID,
        relPath,
        kind,
        NOW.getTime() - ageDays * DAY_MS,
        NOW.toISOString(),
        NOW.toISOString()
      )
  }

  function addActivity(
    kind: ActivityKind,
    relPath: string | null,
    ageDays = 0
  ): void {
    sequence += 1
    ctx.db
      .prepare(
        `INSERT INTO activity_events
           (id, course_id, kind, rel_path, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        `activity-${sequence}`,
        COURSE_ID,
        kind,
        relPath,
        `${kind} 기록`,
        isoDaysFromNow(-ageDays)
      )
  }

  function addHighlight(relPath: string, comment: string | null): void {
    sequence += 1
    ctx.db
      .prepare(
        `INSERT INTO annotations
           (id, course_id, rel_path, page, color, rects_json, anchor_json,
            comment, created_at, updated_at)
         VALUES (?, ?, ?, 1, 'yellow', '[]', '{}', ?, ?, ?)`
      )
      .run(
        `annotation-${sequence}`,
        COURSE_ID,
        relPath,
        comment,
        NOW.toISOString(),
        NOW.toISOString()
      )
  }

  function addDeadline(title: string, daysLeft: number): void {
    sequence += 1
    ctx.db
      .prepare(
        `INSERT INTO board_tasks
           (id, course_id, title, notes, status, due_at, sort_order,
            created_at, updated_at)
         VALUES (?, ?, ?, '', 'todo', ?, ?, ?, ?)`
      )
      .run(
        `deadline-${sequence}`,
        COURSE_ID,
        title,
        isoDaysFromNow(daysLeft),
        sequence,
        NOW.toISOString(),
        NOW.toISOString()
      )
  }

  test('does not flag material added within three days as never opened', () => {
    addMaterial('이번주-강의.pdf', 2)
    addMaterial('지난주-강의.pdf', 4)

    const gaps = insights
      .gaps(COURSE_ID)
      .filter((gap) => gap.kind === 'never-opened')

    expect(gaps.map((gap) => gap.relPath)).toEqual(['지난주-강의.pdf'])
  })

  test('finds a highlighted file without a comment or related note', () => {
    addMaterial('강의/Chap1.pdf', 20)
    addActivity('material-opened', '강의/Chap1.pdf')
    addHighlight('강의/Chap1.pdf', null)

    const gap = insights
      .gaps(COURSE_ID)
      .find((candidate) => candidate.kind === 'no-notes')

    expect(gap?.relPath).toBe('강의/Chap1.pdf')
    expect(gap?.message).toContain('짧은 메모')
  })

  test('removes a no-notes gap as soon as a note cites the material', () => {
    const citations = new Set<string>()
    insights = createInsights({
      db: ctx.db,
      getCourseFolder: () => ctx.dir,
      getMaterialCitations: () => citations
    })
    addMaterial('강의/Chap2.pdf', 20)
    addHighlight('강의/Chap2.pdf', null)

    expect(
      insights
        .gaps(COURSE_ID)
        .some((gap) => gap.kind === 'no-notes' && gap.relPath === '강의/Chap2.pdf')
    ).toBe(true)

    citations.add('강의/Chap2.pdf')
    expect(
      insights
        .gaps(COURSE_ID)
        .some((gap) => gap.kind === 'no-notes' && gap.relPath === '강의/Chap2.pdf')
    ).toBe(false)
  })

  test('keeps filename-stem matching when the citation callback is omitted', () => {
    addMaterial('강의/Chap3.pdf', 20)
    addMaterial('필기/Chap3.md', 0, 'note')
    addHighlight('강의/Chap3.pdf', null)

    expect(
      insights
        .gaps(COURSE_ID)
        .some((gap) => gap.kind === 'no-notes' && gap.relPath === '강의/Chap3.pdf')
    ).toBe(false)
  })

  test('links a close deadline only when the title has a unique material match', () => {
    addMaterial('과제/7장-그래프.pdf', 20)
    addMaterial('강의/8장-정렬.pdf', 20)
    addDeadline('7장 과제 제출', 3)
    addDeadline('팀 발표 제출', 5)

    const gaps = insights
      .gaps(COURSE_ID)
      .filter((gap) => gap.kind === 'deadline-untouched')

    expect(gaps).toHaveLength(2)
    expect(gaps.find((gap) => gap.message.includes('7장'))?.relPath).toBe(
      '과제/7장-그래프.pdf'
    )
    expect(gaps.find((gap) => gap.message.includes('팀 발표'))?.relPath).toBeNull()
  })

  test('reports a stale course after ten days without activity', () => {
    ctx.db
      .prepare('UPDATE courses SET created_at = ? WHERE id = ?')
      .run(isoDaysFromNow(-12), COURSE_ID)

    const gap = insights
      .gaps(COURSE_ID)
      .find((candidate) => candidate.kind === 'stale-course')

    expect(gap).toMatchObject({ relPath: null, kind: 'stale-course' })
    expect(gap?.message).not.toMatch(/방치|안 했|늦었/)
  })

  test('returns an empty array when material, notes, deadline, and course activity are sufficient', () => {
    addMaterial('Chap1.pdf', 20)
    addActivity('material-opened', 'Chap1.pdf')
    addActivity('highlight-created', 'Chap1.pdf')
    addHighlight('Chap1.pdf', '시험 전 다시 볼 정의')
    addDeadline('Chap1 과제 제출', 2)

    expect(insights.gaps(COURSE_ID)).toEqual([])
  })

  test('caps the list so a large untouched folder stays scannable', () => {
    for (let index = 0; index < 12; index += 1) {
      addMaterial(`오래된자료-${index}.pdf`, 20 + index)
    }

    const gaps = insights.gaps(COURSE_ID)

    expect(gaps.length).toBeLessThanOrEqual(5)
    expect(gaps.filter((gap) => gap.kind === 'never-opened')).toHaveLength(3)
  })
})
