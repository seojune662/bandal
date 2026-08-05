/**
 * Courses repository. A course is a DB row plus a folder on disk that holds
 * all of its materials and notes. The folder is either created by Bandal
 * under `<dataRoot>/<slug>` (`source: 'managed'`) or an existing folder the
 * user pointed at (`source: 'linked'`) — from here down, `folder_path` is a
 * first-class arbitrary absolute path and nothing assumes the data root.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  AddCourseFromFolderInput,
  Course,
  CourseFolderResult,
  CourseSource,
  CreateCourseInput,
  RelinkCourseInput,
  RenameCourseInput
} from '../../../shared/types/course'
import { NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireNonEmptyString } from '../../db/validate'
import { folderDisplayName, folderState, normalizeFolderPath } from './courseFolder'

export interface CoursesRepo {
  list(input?: { includeArchived?: boolean }): Course[]
  create(input: CreateCourseInput): Course
  /** Registers an existing folder on disk; creates/moves nothing. */
  addFromFolder(input: AddCourseFromFolderInput): CourseFolderResult
  /** Repoints a course at another folder (연결 끊김 복구). */
  relink(input: RelinkCourseInput): CourseFolderResult
  rename(input: RenameCourseInput): Course
  archive(input: { courseId: string; archived: boolean }): Course
  /** Soft delete: the folder on disk is left untouched. */
  softDelete(input: { courseId: string }): { ok: true }
  /** Live (non-deleted) course by id; throws NotFoundError otherwise. */
  getById(courseId: string): Course
  /** Absolute course folder path; throws NotFoundError for unknown ids. */
  getFolder(courseId: string): string
}

export interface CoursesRepoDeps {
  db: Database
  /** Returns the current dataRoot (settings-backed in the app). */
  getDataRoot: () => string
}

interface CourseRow {
  id: string
  name: string
  slug: string
  color: string
  folder_path: string
  source: string
  archived: number
  sort_order: number
  created_at: string
  updated_at: string
}

function toSource(value: string): CourseSource {
  return value === 'linked' ? 'linked' : 'managed'
}

function rowToCourse(row: CourseRow): Course {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    folderPath: row.folder_path,
    source: toSource(row.source),
    missing: folderState(row.folder_path) !== 'ok',
    archived: row.archived === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const FALLBACK_SLUG = 'course'

/**
 * Derives a filesystem-safe slug. Unicode letters (e.g. Hangul) are kept so
 * course folders stay recognizable; path separators and shell-hostile
 * characters are stripped.
 */
export function slugify(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/[/:*?"<>|.#%&{}$!'@+`=~^;,[\]()]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 64) : FALLBACK_SLUG
}

export function createCoursesRepo(deps: CoursesRepoDeps): CoursesRepo {
  const { db, getDataRoot } = deps

  function selectLive(courseId: string): CourseRow | undefined {
    return db
      .prepare('SELECT * FROM courses WHERE id = ? AND deleted_at IS NULL')
      .get(courseId) as CourseRow | undefined
  }

  /** The live course that already owns `folderPath`, if any. */
  function selectLiveByFolder(folderPath: string): CourseRow | undefined {
    return db
      .prepare('SELECT * FROM courses WHERE folder_path = ? AND deleted_at IS NULL')
      .get(folderPath) as CourseRow | undefined
  }

  function getRowOrThrow(courseId: string): CourseRow {
    const id = requireId(courseId, 'courseId')
    const row = selectLive(id)
    if (row === undefined) {
      throw new NotFoundError('course', id)
    }
    return row
  }

  /**
   * Picks a slug that is unique in the DB. For managed courses the slug also
   * names a directory, so `avoidDir` additionally keeps it free on disk.
   */
  function uniqueSlug(base: string, options: { avoidDir?: string } = {}): string {
    const taken = new Set(
      (db.prepare('SELECT slug FROM courses').all() as { slug: string }[]).map(
        (row) => row.slug
      )
    )
    for (let n = 1; n < 1000; n += 1) {
      const candidate = n === 1 ? base : `${base}-${n}`
      if (taken.has(candidate)) continue
      if (options.avoidDir !== undefined && existsSync(join(options.avoidDir, candidate))) {
        continue
      }
      return candidate
    }
    throw new ValidationError(`could not find a free slug for "${base}"`)
  }

  function nextSortOrder(): number {
    const maxRow = db
      .prepare('SELECT MAX(sort_order) AS max FROM courses WHERE deleted_at IS NULL')
      .get() as { max: number | null }
    return (maxRow.max ?? -1) + 1
  }

  function insertCourse(course: Course): Course {
    db.prepare(
      `INSERT INTO courses
         (id, name, slug, color, folder_path, source, archived, sort_order,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(
      course.id,
      course.name,
      course.slug,
      course.color,
      course.folderPath,
      course.source,
      course.sortOrder,
      course.createdAt,
      course.updatedAt
    )
    return course
  }

  /** Un-archives a row so a re-registered folder is reachable again. */
  function reviveArchived(row: CourseRow): CourseRow {
    if (row.archived !== 1) return row
    const now = nowIso()
    db.prepare('UPDATE courses SET archived = 0, updated_at = ? WHERE id = ?').run(
      now,
      row.id
    )
    return { ...row, archived: 0, updated_at: now }
  }

  return {
    list(input = {}) {
      const includeArchived = input.includeArchived === true
      const rows = db
        .prepare(
          `SELECT * FROM courses
           WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived = 0'}
           ORDER BY sort_order ASC, created_at ASC`
        )
        .all() as CourseRow[]
      return rows.map(rowToCourse)
    },

    create(input) {
      const name = requireNonEmptyString(input.name, 'name').trim()
      const color = requireNonEmptyString(input.color, 'color').trim()
      const dataRoot = getDataRoot()
      if (dataRoot === '') {
        throw new ValidationError('dataRoot is not configured')
      }

      const slug = uniqueSlug(slugify(name), { avoidDir: dataRoot })
      const folderPath = join(dataRoot, slug)
      mkdirSync(folderPath, { recursive: true })

      const now = nowIso()
      return insertCourse({
        id: randomUUID(),
        name,
        slug,
        color,
        folderPath,
        source: 'managed',
        missing: false,
        archived: false,
        sortOrder: nextSortOrder(),
        createdAt: now,
        updatedAt: now
      })
    },

    addFromFolder(input) {
      const color = requireNonEmptyString(input.color, 'color').trim()
      const folderPath = normalizeFolderPath(input.folderPath)

      const state = folderState(folderPath)
      if (state !== 'ok') {
        return { status: 'failed', reason: state }
      }

      const existing = selectLiveByFolder(folderPath)
      if (existing !== undefined) {
        // Not an error: hand back the course that already owns the folder so
        // the caller can focus it. An archived one is revived first.
        return { status: 'duplicate', course: rowToCourse(reviveArchived(existing)) }
      }

      const requested = typeof input.name === 'string' ? input.name.trim() : ''
      const name = requested.length > 0 ? requested : folderDisplayName(folderPath)
      const now = nowIso()
      const course = insertCourse({
        id: randomUUID(),
        name,
        // Linked folders keep their own path; the slug is an identity string
        // only, so it needs no room on disk.
        slug: uniqueSlug(slugify(name)),
        color,
        folderPath,
        source: 'linked',
        missing: false,
        archived: false,
        sortOrder: nextSortOrder(),
        createdAt: now,
        updatedAt: now
      })
      return { status: 'ok', course }
    },

    relink(input) {
      const row = getRowOrThrow(input.courseId)
      const folderPath = normalizeFolderPath(input.folderPath)

      const state = folderState(folderPath)
      if (state !== 'ok') {
        return { status: 'failed', reason: state }
      }

      const owner = selectLiveByFolder(folderPath)
      if (owner !== undefined && owner.id !== row.id) {
        return { status: 'duplicate', course: rowToCourse(reviveArchived(owner)) }
      }
      if (owner !== undefined) {
        return { status: 'ok', course: rowToCourse(row) }
      }

      const now = nowIso()
      db.prepare(
        "UPDATE courses SET folder_path = ?, source = 'linked', updated_at = ? WHERE id = ?"
      ).run(folderPath, now, row.id)
      return {
        status: 'ok',
        course: rowToCourse({
          ...row,
          folder_path: folderPath,
          source: 'linked',
          updated_at: now
        })
      }
    },

    rename(input) {
      const row = getRowOrThrow(input.courseId)
      const name = requireNonEmptyString(input.name, 'name').trim()
      const now = nowIso()
      // Slug and folder are intentionally stable across renames so existing
      // relPaths / annotations stay valid.
      db.prepare('UPDATE courses SET name = ?, updated_at = ? WHERE id = ?').run(
        name,
        now,
        row.id
      )
      return rowToCourse({ ...row, name, updated_at: now })
    },

    archive(input) {
      const row = getRowOrThrow(input.courseId)
      if (typeof input.archived !== 'boolean') {
        throw new ValidationError('archived must be a boolean')
      }
      const now = nowIso()
      db.prepare('UPDATE courses SET archived = ?, updated_at = ? WHERE id = ?').run(
        input.archived ? 1 : 0,
        now,
        row.id
      )
      return rowToCourse({ ...row, archived: input.archived ? 1 : 0, updated_at: now })
    },

    softDelete(input) {
      const row = getRowOrThrow(input.courseId)
      const now = nowIso()
      db.prepare('UPDATE courses SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
        now,
        now,
        row.id
      )
      return { ok: true }
    },

    getById(courseId) {
      return rowToCourse(getRowOrThrow(courseId))
    },

    getFolder(courseId) {
      return getRowOrThrow(courseId).folder_path
    }
  }
}
