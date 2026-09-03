import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type { TabDescriptor } from '../../../shared/tabs'
import type { MaterialLinkRecord } from '../../../shared/types/link'
import { NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireNonEmptyString } from '../../db/validate'
import {
  parseDescriptor,
  serializeDescriptor
} from '../favorites/descriptorJson'

export interface CreateMaterialLinkInput {
  courseId: string
  source: TabDescriptor
  target: TabDescriptor
  label: string
}

export interface MaterialLinksForPath {
  outgoing: MaterialLinkRecord[]
  incoming: MaterialLinkRecord[]
}

export interface MaterialLinksRepo {
  create(input: CreateMaterialLinkInput): MaterialLinkRecord
  remove(courseId: string, id: string): { ok: true }
  listFor(courseId: string, relPath: string): MaterialLinksForPath
  listForDescriptor(
    courseId: string,
    descriptor: TabDescriptor
  ): MaterialLinksForPath
  /** 과목의 수동 링크 전체 — 그래프 뷰용. */
  listAll(courseId: string): MaterialLinkRecord[]
}

interface MaterialLinkRow {
  id: string
  course_id: string
  source_json: string
  target_json: string
  label: string
  created_at: string
}

function rowToRecord(row: MaterialLinkRow): MaterialLinkRecord {
  return {
    id: row.id,
    courseId: row.course_id,
    source: parseDescriptor(row.source_json),
    target: parseDescriptor(row.target_json),
    label: row.label,
    createdAt: row.created_at
  }
}

function descriptorRelPath(descriptor: TabDescriptor): string | null {
  switch (descriptor.kind) {
    case 'pdf':
    case 'note':
    case 'image':
    case 'file':
      return descriptor.payload.relPath
    case 'browser':
    case 'chat':
    case 'board':
    case 'group-chat':
    case 'whiteboard':
    case 'plugin-panel':
      return null
  }
}

/**
 * Comparison-only key copied from `links/linkIndex.ts:pathKey`.
 * Keep filesystem spelling intact; NFC only reconciles macOS NFD paths with
 * composed input, and lowercase makes material lookups case-insensitive.
 */
function pathKey(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

function requireLabel(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('label must be a string')
  }
  return value
}

export function createMaterialLinksRepo(db: Database): MaterialLinksRepo {
  const selectCourse = db.prepare(
    'SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL'
  )
  // Same pair may carry different labels (a plain link and a 'next' sequence
  // link coexist), so a duplicate is only a duplicate within the same label.
  const selectDuplicate = db.prepare(
    `SELECT * FROM material_links
      WHERE course_id = ? AND source_json = ? AND target_json = ? AND label = ?
      ORDER BY created_at ASC, rowid ASC
      LIMIT 1`
  )
  const selectForCourse = db.prepare(
    `SELECT * FROM material_links
      WHERE course_id = ?
      ORDER BY created_at ASC, rowid ASC`
  )
  const insert = db.prepare(
    `INSERT INTO material_links
       (id, course_id, source_json, target_json, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const remove = db.prepare(
    'DELETE FROM material_links WHERE course_id = ? AND id = ?'
  )

  function assertCourseExists(courseId: string): void {
    if (selectCourse.get(courseId) === undefined) {
      throw new NotFoundError('course', courseId)
    }
  }

  function listFor(rawCourseId: string, rawRelPath: string): MaterialLinksForPath {
    const courseId = requireId(rawCourseId, 'courseId')
    const relPath = requireNonEmptyString(rawRelPath, 'relPath')
    const requestedKey = pathKey(relPath)
    const rows = selectForCourse.all(courseId) as MaterialLinkRow[]
    const records = rows.map(rowToRecord)

    return {
      outgoing: records.filter((record) => {
        const sourcePath = descriptorRelPath(record.source)
        return sourcePath !== null && pathKey(sourcePath) === requestedKey
      }),
      incoming: records.filter((record) => {
        const targetPath = descriptorRelPath(record.target)
        return targetPath !== null && pathKey(targetPath) === requestedKey
      })
    }
  }

  return {
    create(input) {
      const courseId = requireId(input.courseId, 'courseId')
      assertCourseExists(courseId)
      const source = serializeDescriptor(input.source)
      const target = serializeDescriptor(input.target)
      const label = requireLabel(input.label)

      if (source.json === target.json) {
        throw new ValidationError('source and target must be different')
      }

      const duplicate = selectDuplicate.get(
        courseId,
        source.json,
        target.json,
        label
      ) as MaterialLinkRow | undefined
      if (duplicate !== undefined) return rowToRecord(duplicate)

      const record: MaterialLinkRecord = {
        id: randomUUID(),
        courseId,
        source: source.descriptor,
        target: target.descriptor,
        label,
        createdAt: nowIso()
      }
      insert.run(
        record.id,
        record.courseId,
        source.json,
        target.json,
        record.label,
        record.createdAt
      )
      return record
    },

    remove(rawCourseId, rawId) {
      const courseId = requireId(rawCourseId, 'courseId')
      const id = requireId(rawId, 'id')
      const result = remove.run(courseId, id)
      if (result.changes !== 1) throw new NotFoundError('materialLink', id)
      return { ok: true }
    },

    listForDescriptor(rawCourseId, descriptor) {
      // Path-backed kinds match by relPath (tolerant of NFC/case drift);
      // pathless kinds (browser tabs, …) match by canonical descriptor JSON.
      const relPath = descriptorRelPath(descriptor)
      if (relPath !== null) return listFor(rawCourseId, relPath)

      const courseId = requireId(rawCourseId, 'courseId')
      const { json } = serializeDescriptor(descriptor)
      const rows = selectForCourse.all(courseId) as MaterialLinkRow[]
      return {
        outgoing: rows
          .filter((row) => row.source_json === json)
          .map(rowToRecord),
        incoming: rows
          .filter((row) => row.target_json === json)
          .map(rowToRecord)
      }
    },

    listFor,

    listAll(rawCourseId) {
      const courseId = requireId(rawCourseId, 'courseId')
      const rows = selectForCourse.all(courseId) as MaterialLinkRow[]
      return rows.map(rowToRecord)
    }
  }
}
