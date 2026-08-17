/**
 * Notes repository. Notes are plain .md files inside the course folder; the
 * DB is not involved. Every relPath goes through the path-traversal guard.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { posix } from 'node:path'
import type {
  CreateNoteInput,
  NoteContent,
  NoteRef,
  WriteNoteInput
} from '../../../shared/types/note'
import { ConflictError, NotFoundError, ValidationError } from '../../db/errors'
import { requireId, requireNonEmptyString, resolveInside } from '../../db/validate'

export interface NotesRepo {
  read(input: NoteRef): NoteContent
  write(input: WriteNoteInput): { mtime: number }
  create(input: CreateNoteInput): NoteRef
  /**
   * 제목과 파일명을 한 트랜잭션으로 맞춘다: 제목을 정리(sanitize)하고,
   * 충돌은 -2/-3 접미로 풀고, 문서의 첫 H1을 최종 이름으로 고쳐 쓴 뒤
   * 파일명을 바꾼다. 에디터 제목 수정과 사이드바 이름 변경이 모두 이
   * 하나를 통해 흐르므로 두 방향이 어긋날 수 없다.
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

  function resolveNote(courseId: string, relPath: string): string {
    const id = requireId(courseId, 'courseId')
    const folder = requireFolder(id)
    const rel = requireNonEmptyString(relPath, 'relPath')
    assertMarkdownPath(rel)
    return resolveInside(folder, rel)
  }

  return {
    read(input) {
      const abs = resolveNote(input.courseId, input.relPath)
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new NotFoundError('note', input.relPath)
      }
      const markdown = readFileSync(abs, 'utf8')
      const mtime = Math.round(statSync(abs).mtimeMs)
      return { courseId: input.courseId, relPath: input.relPath, markdown, mtime }
    },

    write(input) {
      const abs = resolveNote(input.courseId, input.relPath)
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
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, input.markdown, 'utf8')
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

      mkdirSync(dirAbs, { recursive: true })
      let fileName = `${title}.md`
      for (let n = 2; existsSync(join(dirAbs, fileName)); n += 1) {
        if (n > 1000) {
          throw new ValidationError(`could not find a free name for "${title}"`)
        }
        fileName = `${title}-${n}.md`
      }
      writeFileSync(join(dirAbs, fileName), `# ${title}\n`, 'utf8')

      const relPath =
        input.dirRelPath === '' ? fileName : posix.join(input.dirRelPath, fileName)
      return { courseId: id, relPath }
    },

    rename(input) {
      const abs = resolveNote(input.courseId, input.relPath)
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

      // 첫 H1 을 최종 이름으로 고쳐 쓴다. H1 이 없으면 맨 위에 만들어
      // 제목과 파일명이 항상 같은 곳을 가리키게 한다.
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
      if (updated !== original) {
        writeFileSync(abs, updated, 'utf8')
      }

      const nextAbs = join(dirAbs, fileName)
      if (nextAbs !== abs) {
        renameSync(abs, nextAbs)
      }
      const dirRel = posix.dirname(input.relPath)
      const relPath =
        dirRel === '.' ? fileName : posix.join(dirRel, fileName)
      return { relPath, mtime: Math.round(statSync(nextAbs).mtimeMs) }
    }
  }
}
