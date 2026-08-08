import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createLinkService,
  defaultStudyNoteTitle,
  hasAnnotationLink,
  highlightMarkdown
} from '../../../src/main/features/link'
import { createNotesRepo, type NotesRepo } from '../../../src/main/features/notes'
import { createTestDb, type TestDb } from '../helpers/testDb'
import type { SendHighlightToNoteInput } from '../../../src/shared/types/link'

const COURSE_ID = 'course-link-test'

function highlight(
  overrides: Partial<SendHighlightToNoteInput> = {}
): SendHighlightToNoteInput {
  return {
    courseId: COURSE_ID,
    relPath: '강의 자료/Chap #1 & 예제.pdf',
    page: 3,
    quote: '해시 충돌은 체이닝으로 해결할 수 있다.',
    comment: '시험 전에 다시 보기',
    annotationId: 'annotation-1',
    ...overrides
  }
}

describe('linkService', () => {
  let ctx: TestDb
  let courseFolder: string
  let notes: NotesRepo

  beforeEach(() => {
    ctx = createTestDb()
    courseFolder = join(ctx.dir, '자료구조 & 알고리즘')
    mkdirSync(courseFolder, { recursive: true })
    notes = createNotesRepo({ getCourseFolder: () => courseFolder })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('creates the course default note and appends quote, comment, and source', () => {
    const service = createLinkService({
      notes,
      getCourseFolder: () => courseFolder
    })

    const result = service.sendHighlightToNote(highlight())
    const markdown = readFileSync(join(courseFolder, result.relPath), 'utf8')

    expect(result).toEqual({
      relPath: '자료구조 & 알고리즘 학습노트.md',
      created: true
    })
    expect(markdown).toContain('# 자료구조 & 알고리즘 학습노트')
    expect(markdown).toContain('> 해시 충돌은 체이닝으로 해결할 수 있다.')
    expect(markdown).toContain('시험 전에 다시 보기')
    expect(markdown).toContain(
      '[3쪽 "해시 충돌은 체이닝으로 해결할 수 있다."](bandal://material?'
    )
    expect(markdown).toContain('path=%EA%B0%95%EC%9D%98%20%EC%9E%90%EB%A3%8C')
    expect(hasAnnotationLink(markdown, 'annotation-1')).toBe(true)
  })

  test('does not append the same annotation twice', () => {
    const service = createLinkService({
      notes,
      getCourseFolder: () => courseFolder
    })

    const first = service.sendHighlightToNote(highlight())
    const afterFirst = readFileSync(join(courseFolder, first.relPath), 'utf8')
    const second = service.sendHighlightToNote(
      highlight({ comment: '나중에 바꾼 메모' })
    )

    expect(second).toEqual({ relPath: first.relPath, created: false })
    expect(readFileSync(join(courseFolder, first.relPath), 'utf8')).toBe(afterFirst)
  })

  test('preserves an explicitly selected note and appends at its end', () => {
    const relPath = '내 필기/중간고사.md'
    const original = '# 중간고사\n\n기존 내용은 그대로 남는다.\n'
    mkdirSync(join(courseFolder, '내 필기'))
    writeFileSync(join(courseFolder, relPath), original, 'utf8')
    const writeSpy = vi.spyOn(notes, 'write')
    const service = createLinkService({
      notes,
      getCourseFolder: () => courseFolder
    })

    const result = service.sendHighlightToNote(highlight({ noteRelPath: relPath }))
    const saved = readFileSync(join(courseFolder, relPath), 'utf8')

    expect(result).toEqual({ relPath, created: false })
    expect(saved.startsWith(original)).toBe(true)
    expect(saved).toContain('> 해시 충돌은 체이닝으로 해결할 수 있다.')
    expect(writeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ relPath, expectedMtime: expect.any(Number) })
    )
  })

  test('omits a blank comment from the markdown block', () => {
    const markdown = highlightMarkdown(highlight({ comment: '   ' }))
    expect(markdown).toBe(
      '> 해시 충돌은 체이닝으로 해결할 수 있다.\n\n' +
        '[3쪽 "해시 충돌은 체이닝으로 해결할 수 있다."]' +
        '(bandal://material?path=%EA%B0%95%EC%9D%98%20%EC%9E%90%EB%A3%8C%2FChap%20%231%20%26%20%EC%98%88%EC%A0%9C.pdf&page=3&annotationId=annotation-1)'
    )
  })

  test('derives a filesystem-safe default title from the course folder', () => {
    expect(defaultStudyNoteTitle('/courses/자료:구조?')).toBe('자료구조 학습노트')
  })
})

