/**
 * Courses repository. A course is a DB row plus a folder on disk that holds
 * all of its materials and notes. The folder is either created by Bandal
 * under `<dataRoot>/<slug>` (`source: 'managed'`) or an existing folder the
 * user pointed at (`source: 'linked'`) — from here down, `folder_path` is a
 * first-class arbitrary absolute path and nothing assumes the data root.
 */

import { existsSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs'
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
  /**
   * 한 번의 드래그 = 한 번의 원자적 호출. `groupId`(null = 그룹 해제)로
   * 소속을 바꾸고 `beforeCourseId` 앞에(null = 대상 그룹 블록의 끝에)
   * 배치한 뒤, 전체 live 과목의 sort_order를 0..n으로 다시 매긴다.
   * 갱신된 목록(list())을 돌려준다.
   */
  organize(input: {
    courseId: string
    groupId: string | null
    beforeCourseId: string | null
  }): Course[]
  /** Soft delete: the folder on disk is left untouched. */
  softDelete(input: { courseId: string }): { ok: true }
  /**
   * Hard-deletes an already soft-deleted MANAGED course row and returns its
   * folder path so the caller can trash it. Double-guarded — tutorial
   * temp-course cleanup only; a live or linked course is rejected with
   * ValidationError. ([R3] dataRoot 가 바뀔 수 있게 되면서 "현재 dataRoot
   * 안" 검사는 제거 — managed 는 반달이 만든 폴더라는 뜻이고, 삭제는
   * trashItem 이라 복구 가능하다.)
   */
  purge(input: { courseId: string }): { ok: true; folderPath: string }
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
  group_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
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
    groupId: row.group_id ?? null,
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

  function listCourses(input: { includeArchived?: boolean } = {}): Course[] {
    const includeArchived = input.includeArchived === true
    const rows = db
      .prepare(
        `SELECT * FROM courses
         WHERE deleted_at IS NULL ${includeArchived ? '' : 'AND archived = 0'}
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all() as CourseRow[]
    return rows.map(rowToCourse)
  }

  return {
    list(input = {}) {
      return listCourses(input)
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
      const createdFolder = !existsSync(folderPath)
      mkdirSync(folderPath, { recursive: true })

      const now = nowIso()
      try {
        return insertCourse({
          id: randomUUID(),
          name,
          slug,
          color,
          folderPath,
          source: 'managed',
          missing: false,
          archived: false,
          // 새 과목은 그룹 없이 시작한다 (INSERT의 group_id 기본값 NULL과 일치).
          groupId: null,
          sortOrder: nextSortOrder(),
          createdAt: now,
          updatedAt: now
        })
      } catch (error) {
        if (createdFolder) {
          try {
            if (existsSync(folderPath) && readdirSync(folderPath).length === 0) {
              rmdirSync(folderPath)
            }
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              `failed to insert course and clean up "${folderPath}"`
            )
          }
        }
        throw error
      }
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
        groupId: null,
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

    purge(input) {
      const id = requireId(input.courseId, 'courseId')
      const row = db
        .prepare('SELECT * FROM courses WHERE id = ?')
        .get(id) as CourseRow | undefined
      if (row === undefined) {
        throw new ValidationError(`unknown course ${id}`)
      }
      if (row.deleted_at === null) {
        throw new ValidationError('purge requires a soft-deleted course')
      }
      if (toSource(row.source) !== 'managed') {
        throw new ValidationError('only managed courses can be purged')
      }
      // [R3] 예전에는 "현재 dataRoot 안의 폴더"인지도 검사했지만, 설정에서
      // dataRoot 를 바꿀 수 있게 되면서 그 검사가 정당한 purge 를 막는다
      // (옛 dataRoot 아래에 만들어진 managed 과목이 영원히 못 지워짐).
      // source:'managed' 는 폴더를 반달이 당시의 dataRoot 아래에 직접
      // 만들었다는 뜻이므로 managed + soft-deleted 두 겹이면 충분하고,
      // 호출자(courses:purge)는 unlink 가 아니라 trashItem 으로 보내므로
      // 실수해도 복구할 수 있다. containment 는 심층 방어였을 뿐이다.
      const folderPath = normalizeFolderPath(row.folder_path)
      // foreign_keys=ON: the row cannot go while children reference it. Chain
      // order matters — grandchildren first (no course_id of their own), then
      // messages before agent_sessions (messages FK it), then every table
      // with a direct courses(id) FK, discovered dynamically so new tables
      // keep purging without edits here.
      const purgeTx = db.transaction((courseId: string) => {
        db.prepare(
          `DELETE FROM message_blocks WHERE message_id IN
             (SELECT id FROM messages WHERE course_id = ?)`
        ).run(courseId)
        db.prepare(
          `DELETE FROM whiteboard_local_shapes WHERE board_id IN
             (SELECT id FROM whiteboards WHERE course_id = ?)`
        ).run(courseId)
        db.prepare('DELETE FROM messages WHERE course_id = ?').run(courseId)
        const tables = db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT IN ('courses', 'messages')
               AND name NOT LIKE 'sqlite_%'`
          )
          .all() as { name: string }[]
        for (const { name } of tables) {
          const fks = db.pragma(`foreign_key_list("${name}")`) as {
            table: string
            from: string
          }[]
          for (const fk of fks) {
            if (fk.table === 'courses') {
              db.prepare(`DELETE FROM "${name}" WHERE "${fk.from}" = ?`).run(
                courseId
              )
            }
          }
        }
        db.prepare('DELETE FROM courses WHERE id = ?').run(courseId)
      })
      purgeTx(id)
      return { ok: true, folderPath }
    },

    organize(input) {
      const targetGroupId =
        input.groupId === null ? null : requireId(input.groupId, 'groupId')
      const beforeCourseId =
        input.beforeCourseId === null
          ? null
          : requireId(input.beforeCourseId, 'beforeCourseId')

      const apply = db.transaction(() => {
        const dragged = getRowOrThrow(input.courseId)
        if (beforeCourseId === dragged.id) {
          throw new ValidationError('beforeCourseId must not be the dragged course')
        }
        if (targetGroupId !== null) {
          const group = db
            .prepare(
              'SELECT id FROM course_groups WHERE id = ? AND deleted_at IS NULL'
            )
            .get(targetGroupId)
          if (group === undefined) {
            throw new NotFoundError('course group', targetGroupId)
          }
        }

        // 전체 live 목록(아카이브 포함)을 현재 순서대로 만든다 — 상대 순서를
        // 보존한 채 다시 매기기 위해 숨겨진 행까지 모두 포함해야 한다.
        const rows = db
          .prepare(
            `SELECT id, group_id FROM courses
             WHERE deleted_at IS NULL
             ORDER BY sort_order ASC, created_at ASC`
          )
          .all() as { id: string; group_id: string | null }[]

        const remaining = rows.filter((row) => row.id !== dragged.id)
        let insertAt: number
        if (beforeCourseId !== null) {
          const before = remaining.find((row) => row.id === beforeCourseId)
          if (before === undefined) {
            throw new NotFoundError('course', beforeCourseId)
          }
          // 드롭 지점은 대상 그룹 블록 안이어야 한다. 다른 그룹의 행 앞에
          // 끼워 넣으면 그룹 경계와 정렬이 서로 모순이 된다.
          if ((before.group_id ?? null) !== targetGroupId) {
            throw new ValidationError(
              'beforeCourseId must belong to the target group'
            )
          }
          insertAt = remaining.indexOf(before)
        } else {
          // null = 대상 그룹 블록의 끝. 그룹에 아무도 없으면 목록 맨 끝.
          let lastMember = -1
          remaining.forEach((row, index) => {
            if ((row.group_id ?? null) === targetGroupId) lastMember = index
          })
          insertAt = lastMember === -1 ? remaining.length : lastMember + 1
        }

        const ordered = [...remaining]
        ordered.splice(insertAt, 0, { id: dragged.id, group_id: targetGroupId })

        const now = nowIso()
        db.prepare(
          'UPDATE courses SET group_id = ?, updated_at = ? WHERE id = ?'
        ).run(targetGroupId, now, dragged.id)
        const renumber = db.prepare(
          'UPDATE courses SET sort_order = ?, updated_at = ? WHERE id = ?'
        )
        ordered.forEach((row, index) => {
          renumber.run(index, now, row.id)
        })
      })
      apply()
      return listCourses()
    },

    getById(courseId) {
      return rowToCourse(getRowOrThrow(courseId))
    },

    getFolder(courseId) {
      return getRowOrThrow(courseId).folder_path
    }
  }
}
