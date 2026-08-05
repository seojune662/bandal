/**
 * Notes repository. Notes are plain .md files inside the course folder; the
 * DB is not involved. Every relPath goes through the path-traversal guard.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
    }
  }
}
