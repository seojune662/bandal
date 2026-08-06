/** SQLite repository for non-destructive, free-form PDF drawings. */

import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  CreateDrawingInput,
  Drawing,
  DrawingBox,
  DrawingColor,
  DrawingData,
  DrawingKind,
  DrawingPoint,
  DrawingStyle,
  UpdateDrawingInput
} from '../../../shared/types/drawing'
import { NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireInt, requireNonEmptyString } from '../../db/validate'

export interface DrawingsRepo {
  listForFile(courseId: string, relPath: string): Drawing[]
  create(input: CreateDrawingInput): Drawing
  update(input: UpdateDrawingInput): Drawing
  softDelete(ids: string[]): void
}

interface DrawingRow {
  id: string
  course_id: string
  rel_path: string
  page: number
  kind: string
  data_json: string
  style_json: string
  created_at: string
  updated_at: string
}

const DRAWING_KINDS: readonly DrawingKind[] = [
  'ink',
  'highlighter',
  'rect',
  'ellipse',
  'arrow',
  'line',
  'textbox'
]
const DRAWING_COLORS: readonly DrawingColor[] = [
  'ink',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet'
]

function assertUnit(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new ValidationError(`${field} must be a finite number between 0 and 1`)
  }
  return value
}

function assertPositive(value: unknown, field: string, max = 1): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > max
  ) {
    throw new ValidationError(`${field} must be a finite number greater than 0 and at most ${max}`)
  }
  return value
}

function assertPoint(value: unknown, field: string): DrawingPoint {
  if (value === null || typeof value !== 'object') {
    throw new ValidationError(`${field} must be a drawing point`)
  }
  const point = value as Partial<DrawingPoint>
  return {
    x: assertUnit(point.x, `${field}.x`),
    y: assertUnit(point.y, `${field}.y`),
    p: assertUnit(point.p, `${field}.p`)
  }
}

function assertBox(value: unknown, field: string): DrawingBox {
  if (value === null || typeof value !== 'object') {
    throw new ValidationError(`${field} must be a drawing box`)
  }
  const box = value as Partial<DrawingBox>
  const result = {
    x: assertUnit(box.x, `${field}.x`),
    y: assertUnit(box.y, `${field}.y`),
    width: assertUnit(box.width, `${field}.width`),
    height: assertUnit(box.height, `${field}.height`)
  }
  if (result.x + result.width > 1 || result.y + result.height > 1) {
    throw new ValidationError(`${field} must stay inside the normalized page`)
  }
  return result
}

function assertKind(value: unknown): DrawingKind {
  if (!DRAWING_KINDS.includes(value as DrawingKind)) {
    throw new ValidationError(`kind must be one of ${DRAWING_KINDS.join(', ')}`)
  }
  return value as DrawingKind
}

function assertData(value: unknown, kind: DrawingKind): DrawingData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('data must be an object')
  }
  const candidate = value as DrawingData
  const points = candidate.points?.map((point, index) =>
    assertPoint(point, `data.points[${index}]`)
  )
  const box = candidate.box === undefined ? undefined : assertBox(candidate.box, 'data.box')
  const text = candidate.text
  if (text !== undefined && typeof text !== 'string') {
    throw new ValidationError('data.text must be a string')
  }

  if ((kind === 'ink' || kind === 'highlighter') && (points?.length ?? 0) === 0) {
    throw new ValidationError(`${kind} data needs at least one point`)
  }
  if ((kind === 'rect' || kind === 'ellipse' || kind === 'textbox') && box === undefined) {
    throw new ValidationError(`${kind} data needs a box`)
  }
  if ((kind === 'line' || kind === 'arrow') && box === undefined && (points?.length ?? 0) < 2) {
    throw new ValidationError(`${kind} data needs a box or two points`)
  }
  if (kind === 'textbox' && text === undefined) {
    throw new ValidationError('textbox data needs text')
  }

  const result: DrawingData = {}
  if (points !== undefined) result.points = points
  if (box !== undefined) result.box = box
  if (text !== undefined) result.text = text
  return result
}

function assertStyle(value: unknown): DrawingStyle {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('style must be an object')
  }
  const style = value as Partial<DrawingStyle>
  if (!DRAWING_COLORS.includes(style.color as DrawingColor)) {
    throw new ValidationError(`style.color must be one of ${DRAWING_COLORS.join(', ')}`)
  }
  const result: DrawingStyle = {
    color: style.color as DrawingColor,
    width: assertPositive(style.width, 'style.width'),
    opacity: assertUnit(style.opacity, 'style.opacity')
  }
  if (style.fontScale !== undefined) {
    result.fontScale = assertPositive(style.fontScale, 'style.fontScale', 10)
  }
  return result
}

function rowToDrawing(row: DrawingRow): Drawing {
  return {
    id: row.id,
    courseId: row.course_id,
    relPath: row.rel_path,
    page: row.page,
    kind: row.kind as DrawingKind,
    data: JSON.parse(row.data_json) as DrawingData,
    style: JSON.parse(row.style_json) as DrawingStyle,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function createDrawingsRepo(db: Database): DrawingsRepo {
  function assertCourseExists(courseId: string): void {
    const row = db
      .prepare('SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL')
      .get(courseId)
    if (row === undefined) throw new NotFoundError('course', courseId)
  }

  function getRowOrThrow(id: string): DrawingRow {
    const row = db
      .prepare('SELECT * FROM pdf_drawings WHERE id = ? AND deleted_at IS NULL')
      .get(id) as DrawingRow | undefined
    if (row === undefined) throw new NotFoundError('drawing', id)
    return row
  }

  return {
    listForFile(courseIdInput, relPathInput) {
      const courseId = requireId(courseIdInput, 'courseId')
      const relPath = requireNonEmptyString(relPathInput, 'relPath')
      const rows = db
        .prepare(
          `SELECT * FROM pdf_drawings
           WHERE course_id = ? AND rel_path = ? AND deleted_at IS NULL
           ORDER BY page ASC, created_at ASC`
        )
        .all(courseId, relPath) as DrawingRow[]
      return rows.map(rowToDrawing)
    },

    create(input) {
      const courseId = requireId(input.courseId, 'courseId')
      assertCourseExists(courseId)
      const relPath = requireNonEmptyString(input.relPath, 'relPath')
      const page = requireInt(input.page, 'page', 1)
      const kind = assertKind(input.kind)
      const data = assertData(input.data, kind)
      const style = assertStyle(input.style)
      const now = nowIso()
      const drawing: Drawing = {
        id: randomUUID(),
        courseId,
        relPath,
        page,
        kind,
        data,
        style,
        createdAt: now,
        updatedAt: now
      }
      db.prepare(
        `INSERT INTO pdf_drawings
           (id, course_id, rel_path, page, kind, data_json, style_json,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        drawing.id,
        courseId,
        relPath,
        page,
        kind,
        JSON.stringify(data),
        JSON.stringify(style),
        now,
        now
      )
      return drawing
    },

    update(input) {
      const row = getRowOrThrow(requireId(input.id, 'id'))
      const kind = row.kind as DrawingKind
      const data = input.data === undefined ? JSON.parse(row.data_json) as DrawingData : assertData(input.data, kind)
      const style = input.style === undefined ? JSON.parse(row.style_json) as DrawingStyle : assertStyle(input.style)
      const now = nowIso()
      db.prepare(
        'UPDATE pdf_drawings SET data_json = ?, style_json = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(data), JSON.stringify(style), now, row.id)
      return rowToDrawing({
        ...row,
        data_json: JSON.stringify(data),
        style_json: JSON.stringify(style),
        updated_at: now
      })
    },

    softDelete(idsInput) {
      if (!Array.isArray(idsInput)) throw new ValidationError('ids must be an array')
      const ids = [...new Set(idsInput.map((id) => requireId(id, 'id')))]
      if (ids.length === 0) return
      const now = nowIso()
      const remove = db.transaction(() => {
        const statement = db.prepare(
          'UPDATE pdf_drawings SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
        )
        for (const id of ids) {
          if (statement.run(now, now, id).changes === 0) {
            throw new NotFoundError('drawing', id)
          }
        }
      })
      remove()
    }
  }
}
