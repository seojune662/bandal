import {
  mkdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join, posix } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createMaterialLink } from '../../../src/main/features/link/materialLink'
import {
  createLinkIndex,
  type LinkIndex
} from '../../../src/main/features/links/linkIndex'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE_ID = 'course-1'

function insertCourse(ctx: TestDb, folder: string): void {
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO courses
       (id, name, slug, color, folder_path, archived, sort_order,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(COURSE_ID, '운영체제', COURSE_ID, 'gold', folder, now, now)
}

function insertBoard(
  ctx: TestDb,
  input: { id: string; title: string; deleted?: boolean }
): void {
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO whiteboards
       (id, course_id, title, sort_order, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`
  ).run(
    input.id,
    COURSE_ID,
    input.title,
    now,
    now,
    input.deleted === true ? now : null
  )
}

function insertShape(
  ctx: TestDb,
  input: {
    id: string
    boardId: string
    dataJson: string
    kind?: string
    deleted?: boolean
  }
): void {
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO whiteboard_local_shapes
       (id, board_id, kind, data_json, style_json,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?, ?)`
  ).run(
    input.id,
    input.boardId,
    input.kind ?? 'clip',
    input.dataJson,
    now,
    now,
    input.deleted === true ? now : null
  )
}

function clipJson(relPath: string, page: number, label: string): string {
  return JSON.stringify({
    clip: {
      relPath,
      page,
      crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      label
    }
  })
}

describe('linkIndex', () => {
  let ctx: TestDb
  let courseFolder: string
  let index: LinkIndex

  beforeEach(() => {
    ctx = createTestDb()
    courseFolder = join(ctx.dir, 'course')
    mkdirSync(courseFolder)
    insertCourse(ctx, courseFolder)
    index = createLinkIndex({
      db: ctx.db,
      getCourseFolder: (courseId) => {
        if (courseId !== COURSE_ID) throw new Error('unknown course')
        return courseFolder
      }
    })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('turns a markdown material URL into a note backlink', () => {
    writeFileSync(join(courseFolder, 'Chap1.pdf'), 'pdf')
    writeFileSync(
      join(courseFolder, '시험 정리.md'),
      '[3쪽 "인용"](bandal://material?path=Chap1.pdf&page=3&annotationId=ann-1)'
    )

    expect(index.forMaterial(COURSE_ID, 'Chap1.pdf')).toEqual({
      notes: [{ ref: '시험 정리.md', label: '시험 정리.md', page: 3 }],
      boards: []
    })
    expect(
      ctx.db
        .prepare('SELECT detail FROM content_links WHERE course_id = ?')
        .get(COURSE_ID)
    ).toEqual({ detail: 'ann-1' })
  })

  test('round-trips a percent-encoded Korean path through an NFC match key', () => {
    const nfcDir = '자료'.normalize('NFC')
    const nfcName = '운영체제 3주차.pdf'.normalize('NFC')
    const actualDir = nfcDir.normalize('NFD')
    const actualName = nfcName.normalize('NFD')
    const requestedPath = posix.join(nfcDir, nfcName)
    const actualPath = posix.join(actualDir, actualName)
    mkdirSync(join(courseFolder, actualDir))
    writeFileSync(join(courseFolder, actualDir, actualName), 'pdf')
    const href = createMaterialLink({
      relPath: requestedPath,
      page: 7,
      annotationId: '한글-주석'
    })
    expect(href).toContain('%EC%9E%90%EB%A3%8C')
    writeFileSync(join(courseFolder, '3주차.md'), `[출처](${href})`)

    expect(index.forMaterial(COURSE_ID, requestedPath).notes).toEqual([
      { ref: '3주차.md', label: '3주차.md', page: 7 }
    ])
    expect(index.allForCourse(COURSE_ID)).toEqual([
      {
        relPath: actualPath,
        notes: [
          {
            ref: '3주차.md',
            label: '3주차.md',
            page: 7,
            detail: '한글-주석'
          }
        ],
        boards: []
      }
    ])
  })

  test('turns a personal-board clip into a board backlink', () => {
    writeFileSync(join(courseFolder, 'lecture.pdf'), 'pdf')
    insertBoard(ctx, { id: 'board-1', title: '개념 지도' })
    insertShape(ctx, {
      id: 'clip-1',
      boardId: 'board-1',
      dataJson: clipJson('lecture.pdf', 5, '교착상태 표')
    })

    expect(index.forMaterial(COURSE_ID, 'lecture.pdf')).toEqual({
      notes: [],
      boards: [{ ref: 'board-1', label: '개념 지도', page: 5 }]
    })
    expect(index.allForCourse(COURSE_ID)[0]?.boards[0]?.detail).toBe(
      '교착상태 표'
    )
  })

  test('removes ghost edges when a note disappears before the next scan', () => {
    const notePath = join(courseFolder, 'temporary.md')
    writeFileSync(join(courseFolder, 'target.pdf'), 'pdf')
    writeFileSync(
      notePath,
      '[출처](bandal://material?path=target.pdf&page=1)'
    )
    expect(index.forMaterial(COURSE_ID, 'target.pdf').notes).toHaveLength(1)

    unlinkSync(notePath)

    expect(index.forMaterial(COURSE_ID, 'target.pdf')).toEqual({
      notes: [],
      boards: []
    })
    expect(
      ctx.db
        .prepare('SELECT count(*) AS count FROM content_links WHERE course_id = ?')
        .get(COURSE_ID)
    ).toEqual({ count: 0 })
  })

  test('skips malformed clip JSON and invalid material URLs without throwing', () => {
    writeFileSync(join(courseFolder, 'target.pdf'), 'pdf')
    writeFileSync(
      join(courseFolder, 'broken.md'),
      '[잘못된 링크](bandal://material?path=target.pdf&page=zero)'
    )
    insertBoard(ctx, { id: 'board-broken', title: '깨진 보드' })
    insertShape(ctx, {
      id: 'clip-broken',
      boardId: 'board-broken',
      dataJson: '{not-json'
    })

    expect(() => index.allForCourse(COURSE_ID)).not.toThrow()
    expect(index.allForCourse(COURSE_ID)).toEqual([])
  })

  test('a [[wikilink]] yields a backlink to the note it resolves to', () => {
    writeFileSync(join(courseFolder, 'Chap1.md'), '# Chap1\n')
    writeFileSync(join(courseFolder, 'Chap1.pdf'), 'pdf')
    writeFileSync(
      join(courseFolder, '정리.md'),
      '[[Chap1]] 과 [[chap1|별칭]] 그리고 [[Chap1.pdf#3장]]\n'
    )

    expect(index.forMaterial(COURSE_ID, 'Chap1.md')).toEqual({
      notes: [
        { ref: '정리.md', label: '정리.md', page: null },
        { ref: '정리.md', label: '정리.md', page: null }
      ],
      boards: []
    })
    expect(index.forMaterial(COURSE_ID, 'Chap1.pdf').notes).toEqual([
      { ref: '정리.md', label: '정리.md', page: null }
    ])
    const groups = index.allForCourse(COURSE_ID)
    expect(groups.find((group) => group.relPath === 'Chap1.md')?.notes).toEqual([
      { ref: '정리.md', label: '정리.md', page: null, detail: '', linkKind: 'wikilink' },
      { ref: '정리.md', label: '정리.md', page: null, detail: '', linkKind: 'wikilink' }
    ])
    expect(
      ctx.db
        .prepare(
          `SELECT link_kind FROM content_links WHERE course_id = ? ORDER BY link_kind`
        )
        .all(COURSE_ID)
    ).toEqual([
      { link_kind: 'wikilink' },
      { link_kind: 'wikilink' },
      { link_kind: 'wikilink' }
    ])
  })

  test('a [[wikilink]] falls back to a .pdf and matches NFD spellings', () => {
    const nfdName = '강의 1.pdf'.normalize('NFD')
    writeFileSync(join(courseFolder, nfdName), 'pdf')
    writeFileSync(
      join(courseFolder, 'note.md'),
      `[[${'강의 1'.normalize('NFC')}]]\n`
    )

    expect(index.forMaterial(COURSE_ID, nfdName).notes).toEqual([
      { ref: 'note.md', label: 'note.md', page: null }
    ])
  })

  test('an unresolved [[wikilink]] is skipped like a stale bandal link', () => {
    writeFileSync(join(courseFolder, 'note.md'), '[[없는 노트]]\n')

    expect(index.allForCourse(COURSE_ID)).toEqual([])
  })

  test('bandal:// backlinks keep their shape (no linkKind) next to wikilinks', () => {
    writeFileSync(join(courseFolder, 'target.pdf'), 'pdf')
    writeFileSync(
      join(courseFolder, 'note.md'),
      '[출처](bandal://material?path=target.pdf&page=2) [[target.pdf]]\n'
    )

    expect(index.allForCourse(COURSE_ID)[0]?.notes).toEqual([
      { ref: 'note.md', label: 'note.md', page: null, detail: '', linkKind: 'wikilink' },
      { ref: 'note.md', label: 'note.md', page: 2, detail: '' }
    ])
  })

  test('an existing content_links table without link_kind is recreated', () => {
    ctx.db.exec('DROP TABLE content_links')
    ctx.db.exec(
      `CREATE TABLE content_links (
         course_id TEXT NOT NULL, source_kind TEXT NOT NULL,
         source_ref TEXT NOT NULL, source_label TEXT NOT NULL,
         target_path TEXT NOT NULL, target_page INTEGER, detail TEXT
       )`
    )
    ctx.db.prepare(
      `INSERT INTO content_links VALUES (?, 'note', 'ghost.md', 'ghost.md', 'x.pdf', NULL, '')`
    ).run(COURSE_ID)

    const rebuilt = createLinkIndex({ db: ctx.db, getCourseFolder: () => courseFolder })

    const columns = (ctx.db.pragma('table_info(content_links)') as { name: string }[])
      .map((column) => column.name)
    expect(columns).toContain('link_kind')
    expect(
      ctx.db.prepare('SELECT count(*) AS count FROM content_links').get()
    ).toEqual({ count: 0 })
    expect(rebuilt.allForCourse(COURSE_ID)).toEqual([])
  })

  test('does not scan generated markdown inside .bandal', () => {
    writeFileSync(join(courseFolder, 'target.pdf'), 'pdf')
    mkdirSync(join(courseFolder, '.bandal'))
    writeFileSync(
      join(courseFolder, '.bandal', 'COURSE.md'),
      '[생성 문맥](bandal://material?path=target.pdf&page=2)'
    )

    expect(index.forMaterial(COURSE_ID, 'target.pdf')).toEqual({
      notes: [],
      boards: []
    })
  })

  test('excludes deleted boards and deleted local shapes', () => {
    writeFileSync(join(courseFolder, 'target.pdf'), 'pdf')
    insertBoard(ctx, { id: 'deleted-board', title: '삭제 보드', deleted: true })
    insertShape(ctx, {
      id: 'live-shape-on-deleted-board',
      boardId: 'deleted-board',
      dataJson: clipJson('target.pdf', 2, '보이면 안 됨')
    })
    insertBoard(ctx, { id: 'live-board', title: '살아있는 보드' })
    insertShape(ctx, {
      id: 'deleted-shape',
      boardId: 'live-board',
      dataJson: clipJson('target.pdf', 4, '이것도 보이면 안 됨'),
      deleted: true
    })

    expect(index.forMaterial(COURSE_ID, 'target.pdf')).toEqual({
      notes: [],
      boards: []
    })
  })
})
