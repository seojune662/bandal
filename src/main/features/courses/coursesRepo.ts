/**
 * Courses repository. A course is a DB row plus a folder on disk at
 * `<dataRoot>/<slug>` that holds all of its materials and notes.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { Course, CreateCourseInput, RenameCourseInput } from '../../../shared/types/course'
import { NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireNonEmptyString } from '../../db/validate'

export interface CoursesRepo {
  list(input?: { includeArchived?: boolean }): Course[]
  create(input: CreateCourseInput): Course
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
  archived: number
  sort_order: number
  created_at: string
  updated_at: string
}

function rowToCourse(row: CourseRow): Course {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    folderPath: row.folder_path,
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

  function getRowOrThrow(courseId: string): CourseRow {
    const id = requireId(courseId, 'courseId')
    const row = selectLive(id)
    if (row === undefined) {
      throw new NotFoundError('course', id)
    }
    return row
  }

  /** Picks a slug that is unique in the DB AND free on disk. */
  function uniqueSlug(base: string, dataRoot: string): string {
    const taken = new Set(
      (db.prepare('SELECT slug FROM courses').all() as { slug: string }[]).map(
        (row) => row.slug
      )
    )
    for (let n = 1; n < 1000; n += 1) {
      const candidate = n === 1 ? base : `${base}-${n}`
      if (!taken.has(candidate) && !existsSync(join(dataRoot, candidate))) {
        return candidate
      }
    }
    throw new ValidationError(`could not find a free slug for "${base}"`)
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

      const slug = uniqueSlug(slugify(name), dataRoot)
      const folderPath = join(dataRoot, slug)
      mkdirSync(folderPath, { recursive: true })

      const maxRow = db
        .prepare('SELECT MAX(sort_order) AS max FROM courses WHERE deleted_at IS NULL')
        .get() as { max: number | null }
      const now = nowIso()
      const course: Course = {
        id: randomUUID(),
        name,
        slug,
        color,
        folderPath,
        archived: false,
        sortOrder: (maxRow.max ?? -1) + 1,
        createdAt: now,
        updatedAt: now
      }
      db.prepare(
        `INSERT INTO courses
           (id, name, slug, color, folder_path, archived, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(
        course.id,
        course.name,
        course.slug,
        course.color,
        course.folderPath,
        course.sortOrder,
        course.createdAt,
        course.updatedAt
      )
      return course
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
