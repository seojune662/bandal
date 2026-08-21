/**
 * Notes repository. Notes are plain .md files inside the course folder; the
 * DB is not involved. Every relPath goes through the path-traversal guard.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join } from 'node:path'
import { posix } from 'node:path'
import type {
  CreateNoteInput,
  NoteContent,
  NoteRef,
  WriteNoteInput
} from '../../../shared/types/note'
import { ConflictError, NotFoundError, ValidationError } from '../../db/errors'
import {
  assertRealInside,
  requireId,
  requireNonEmptyString,
  resolveInside,
  resolveInsideReal
} from '../../db/validate'

export interface NotesRepo {
  read(input: NoteRef): NoteContent
  write(input: WriteNoteInput): { mtime: number }
  create(input: CreateNoteInput): NoteRef
  /**
   * 제목과 파일명을 한 트랜잭션으로 맞춘다: 제목을 정리(sanitize)하고,
   * 충돌은 -2/-3 접미로 풀고, 파일명을 바꾼 뒤 문서의 첫 H1을 최종
   * 이름으로 원자적으로 고쳐 쓴다. H1 저장이 실패하면 파일명을 원래대로
   * 되돌린다.
   */
  rename(input: { courseId: string; relPath: string; newName: string }): {
    relPath: string
    mtime: number
  }
}

export interface NotesRepoDeps {
  /** Absolute course folder for a live course id (throws otherwise). */
  getCourseFolder: (courseId: string) => string
}

/** Strips path separators and other filesystem-hostile chars from a title. */
function sanitizeTitle(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim()
  if (cleaned.length === 0) {
    throw new ValidationError('title has no filesystem-safe characters')
  }
  return cleaned
}

function assertMarkdownPath(relPath: string): void {
  if (extname(relPath).toLowerCase() !== '.md') {
    throw new ValidationError(`notes must be .md files (got "${relPath}")`)
  }
}

/** Atomically replaces one note without ever truncating the live file. */
function writeAtomic(abs: string, content: string): void {
  const temporaryPath = `${abs}.${process.pid}.${randomUUID()}.tmp`
  const bytes = Buffer.from(content, 'utf8')
  let descriptor: number | undefined

  try {
    descriptor = openSync(temporaryPath, 'w', 0o644)
    let offset = 0
    if (bytes.length === 0) {
      writeSync(descriptor, bytes, 0, 0)
    }
    while (offset < bytes.length) {
      const written = writeSync(descriptor, bytes, offset, bytes.length - offset)
      if (written === 0) {
        throw new Error(`atomic write made no progress for "${abs}"`)
      }
      offset += written
    }
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporaryPath, abs)
  } catch (error) {
    const cleanupErrors: unknown[] = []
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch (closeError) {
        cleanupErrors.push(closeError)
      }
    }
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath)
      } catch (unlinkError) {
        cleanupErrors.push(unlinkError)
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        `atomic note write and cleanup failed for "${abs}"`
      )
    }
    throw error
  }
}

export function createNotesRepo(deps: NotesRepoDeps): NotesRepo {
  const { getCourseFolder } = deps

  /**
   * The course folder is an arbitrary path that may be gone (moved, deleted,
   * unmounted). Refuse rather than silently re-creating it under a stale
   * path — the UI offers 다시 연결 for that case.
   */
  function requireFolder(courseId: string): string {
    const folder = getCourseFolder(courseId)
    if (!existsSync(folder)) {
      throw new NotFoundError('course folder', folder)
    }
    return folder
  }

  function resolveNote(
    courseId: string,
    relPath: string
  ): { abs: string; folder: string } {
    const id = requireId(courseId, 'courseId')
    const folder = requireFolder(id)
    const rel = requireNonEmptyString(relPath, 'relPath')
    assertMarkdownPath(rel)
    return { abs: resolveInsideReal(folder, rel), folder }
  }

  return {
    read(input) {
      const { abs } = resolveNote(input.courseId, input.relPath)
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new NotFoundError('note', input.relPath)
      }
      const markdown = readFileSync(abs, 'utf8')
      const mtime = Math.round(statSync(abs).mtimeMs)
      return { courseId: input.courseId, relPath: input.relPath, markdown, mtime }
    },

    write(input) {
      const { abs, folder } = resolveNote(input.courseId, input.relPath)
      if (typeof input.markdown !== 'string') {
        throw new ValidationError('markdown must be a string')
      }
      if (input.expectedMtime !== undefined && existsSync(abs)) {
        const currentMtime = Math.round(statSync(abs).mtimeMs)
        if (currentMtime !== input.expectedMtime) {
          throw new ConflictError(
            `"${input.relPath}" changed on disk (expected mtime ${input.expectedMtime}, found ${currentMtime})`
          )
        }
      }
      const parent = dirname(abs)
      assertRealInside(folder, parent)
      mkdirSync(parent, { recursive: true })
      assertRealInside(folder, abs)
      writeAtomic(abs, input.markdown)
      return { mtime: Math.round(statSync(abs).mtimeMs) }
    },

    create(input) {
      const id = requireId(input.courseId, 'courseId')
      const folder = requireFolder(id)
      if (typeof input.dirRelPath !== 'string') {
        throw new ValidationError('dirRelPath must be a string')
      }
      const dirAbs = resolveInside(folder, input.dirRelPath, { allowRoot: true })
      const title = sanitizeTitle(requireNonEmptyString(input.title, 'title'))

      assertRealInside(folder, dirAbs)
      mkdirSync(dirAbs, { recursive: true })
      let fileName = `${title}.md`
      for (let n = 2; existsSync(join(dirAbs, fileName)); n += 1) {
        if (n > 1000) {
          throw new ValidationError(`could not find a free name for "${title}"`)
        }
        fileName = `${title}-${n}.md`
      }
      const abs = join(dirAbs, fileName)
      assertRealInside(folder, abs)
      writeAtomic(abs, `# ${title}\n`)

      const relPath =
        input.dirRelPath === '' ? fileName : posix.join(input.dirRelPath, fileName)
      return { courseId: id, relPath }
    },

    rename(input) {
      const { abs, folder } = resolveNote(input.courseId, input.relPath)
      if (!existsSync(abs)) {
        throw new NotFoundError('note', input.relPath)
      }
      // 호출자가 .md 를 붙여 보내도 관대하게 받아 준다(사이드바 인라인
      // 편집기는 확장자까지 통째로 편집한다).
      const requested = requireNonEmptyString(input.newName, 'newName')
      const stem = sanitizeTitle(requested.replace(/\.md$/iu, ''))

      const dirAbs = dirname(abs)
      let fileName = `${stem}.md`
      for (
        let n = 2;
        existsSync(join(dirAbs, fileName)) && join(dirAbs, fileName) !== abs;
        n += 1
      ) {
        if (n > 1000) {
          throw new ValidationError(`could not find a free name for "${stem}"`)
        }
        fileName = `${stem}-${n}.md`
      }
      const finalStem = fileName.replace(/\.md$/u, '')

      // 새 파일명에 맞출 H1 내용을 먼저 계산하되, 파일명 변경 전에는
      // 원본을 건드리지 않는다.
      const original = readFileSync(abs, 'utf8')
      const lines = original.split('\n')
      const headingIndex = lines.findIndex((line) => /^#\s/u.test(line))
      let updated: string
      if (headingIndex >= 0) {
        lines[headingIndex] = `# ${finalStem}`
        updated = lines.join('\n')
      } else {
        updated = `# ${finalStem}\n\n${original}`
      }
      const nextAbs = join(dirAbs, fileName)
      let renamed = false
      if (nextAbs !== abs) {
        assertRealInside(folder, abs)
        assertRealInside(folder, nextAbs)
        renameSync(abs, nextAbs)
        renamed = true
      }

      try {
        if (updated !== original) {
          assertRealInside(folder, nextAbs)
          writeAtomic(nextAbs, updated)
        }
      } catch (error) {
        if (renamed) {
          try {
            assertRealInside(folder, nextAbs)
            assertRealInside(folder, abs)
            renameSync(nextAbs, abs)
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              `failed to update the note heading and restore "${input.relPath}"`
            )
          }
        }
        throw error
      }
      const dirRel = posix.dirname(input.relPath)
      const relPath =
        dirRel === '.' ? fileName : posix.join(dirRel, fileName)
      return { relPath, mtime: Math.round(statSync(nextAbs).mtimeMs) }
    }
  }
}
