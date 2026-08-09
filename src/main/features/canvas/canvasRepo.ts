import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import type {
  DrawingData,
  DrawingKind,
  DrawingShape,
  DrawingStyle
} from '../../../shared/types/drawing'
import { DRAWING_KINDS } from '../../../shared/types/drawing'
import type {
  BoardBackground,
  BoardSurface,
  CreatePersonalBoardInput,
  OpenPersonalBoardResult,
  PersonalBoard,
  PutPersonalShapeInput,
  RemovePersonalShapesInput,
  RenamePersonalBoardInput,
  SetBoardBackgroundInput
} from '../../../shared/types/whiteboard'
import {
  BOARD_BACKGROUNDS,
  BOARD_SURFACES
} from '../../../shared/types/whiteboard'
import { NotFoundError, ValidationError } from '../../db/errors'
import { nowIso, requireId, requireNonEmptyString } from '../../db/validate'

interface BoardRow {
  id: string
  course_id: string
  title: string
  background: string
  surface: string
  sort_order: number
  created_at: string
  updated_at: string
}

interface ShapeRow {
  id: string
  board_id: string
  kind: string
  data_json: string
  style_json: string
  created_at: string
  updated_at: string
}

export interface CanvasRepo {
  listBoards(courseId: string): PersonalBoard[]
  createBoard(input: CreatePersonalBoardInput): PersonalBoard
  renameBoard(input: RenamePersonalBoardInput): PersonalBoard
  setBackground(input: SetBoardBackgroundInput): PersonalBoard
  removeBoard(id: string): void
  open(boardId: string): OpenPersonalBoardResult
  putShape(input: PutPersonalShapeInput): DrawingShape
  removeShapes(input: RemovePersonalShapesInput): void
}


function boardBackground(value: unknown): BoardBackground {
  const background = BOARD_BACKGROUNDS.find((candidate) => candidate === value)
  if (background === undefined) {
    throw new ValidationError(
      `background must be one of ${BOARD_BACKGROUNDS.join(', ')}`
    )
  }
  return background
}

function boardSurface(value: unknown): BoardSurface {
  const surface = BOARD_SURFACES.find((candidate) => candidate === value)
  if (surface === undefined) {
    throw new ValidationError(`surface must be one of ${BOARD_SURFACES.join(', ')}`)
  }
  return surface
}

function rowToBoard(row: BoardRow): PersonalBoard {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    background: boardBackground(row.background),
    surface: boardSurface(row.surface),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function rowToShape(row: ShapeRow): DrawingShape {
  return {
    id: row.id,
    kind: row.kind as DrawingKind,
    data: JSON.parse(row.data_json) as DrawingData,
    style: JSON.parse(row.style_json) as DrawingStyle,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function cleanTitle(value: unknown): string {
  return requireNonEmptyString(value, 'title').trim()
}

function assertShapeInput(
  input: PutPersonalShapeInput['shape']
): PutPersonalShapeInput['shape'] {
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError('shape must be an object')
  }
  if (!DRAWING_KINDS.includes(input.kind)) {
    throw new ValidationError(`shape.kind must be one of ${DRAWING_KINDS.join(', ')}`)
  }
  if (typeof input.data !== 'object' || input.data === null || Array.isArray(input.data)) {
    throw new ValidationError('shape.data must be an object')
  }
  if (typeof input.style !== 'object' || input.style === null || Array.isArray(input.style)) {
    throw new ValidationError('shape.style must be an object')
  }
  return input
}

export function createCanvasRepo(db: Database): CanvasRepo {
  function assertCourseExists(courseId: string): void {
    const row = db
      .prepare('SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL')
      .get(courseId)
    if (row === undefined) throw new NotFoundError('course', courseId)
  }

  function boardRowOrThrow(boardId: string): BoardRow {
    const row = db
      .prepare('SELECT * FROM whiteboards WHERE id = ? AND deleted_at IS NULL')
      .get(boardId) as BoardRow | undefined
    if (row === undefined) throw new NotFoundError('whiteboard', boardId)
    assertCourseExists(row.course_id)
    return row
  }

  const createBoardTransaction = db.transaction(
    (courseId: string, requestedTitle: string | undefined): PersonalBoard => {
      assertCourseExists(courseId)
      const orderRow = db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), -1) AS max_order
             FROM whiteboards
            WHERE course_id = ? AND deleted_at IS NULL`
        )
        .get(courseId) as { max_order: number }
      const sortOrder = orderRow.max_order + 1
      const title = requestedTitle === undefined
        ? `화이트보드 ${sortOrder + 1}`
        : cleanTitle(requestedTitle)
      const now = nowIso()
      const board: PersonalBoard = {
        id: randomUUID(),
        courseId,
        title,
        background: 'grid',
        surface: 'dark',
        sortOrder,
        createdAt: now,
        updatedAt: now
      }
      db.prepare(
        `INSERT INTO whiteboards
           (id, course_id, title, sort_order, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        board.id,
        board.courseId,
        board.title,
        board.sortOrder,
        board.createdAt,
        board.updatedAt
      )
      return board
    }
  )

  const removeBoardTransaction = db.transaction((boardId: string): void => {
    boardRowOrThrow(boardId)
    const now = nowIso()
    db.prepare(
      `UPDATE whiteboards
          SET deleted_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(now, now, boardId)
    db.prepare(
      `UPDATE whiteboard_local_shapes
          SET deleted_at = ?, updated_at = ?
        WHERE board_id = ? AND deleted_at IS NULL`
    ).run(now, now, boardId)
  })

  return {
    listBoards(courseIdInput) {
      const courseId = requireId(courseIdInput, 'courseId')
      assertCourseExists(courseId)
      const rows = db
        .prepare(
          `SELECT * FROM whiteboards
            WHERE course_id = ? AND deleted_at IS NULL
            ORDER BY sort_order ASC, created_at ASC`
        )
        .all(courseId) as BoardRow[]
      return rows.map(rowToBoard)
    },

    createBoard(input) {
      const courseId = requireId(input.courseId, 'courseId')
      return createBoardTransaction(courseId, input.title)
    },

    renameBoard(input) {
      const id = requireId(input.id, 'id')
      const row = boardRowOrThrow(id)
      const title = cleanTitle(input.title)
      const updatedAt = nowIso()
      db.prepare(
        'UPDATE whiteboards SET title = ?, updated_at = ? WHERE id = ?'
      ).run(title, updatedAt, id)
      return rowToBoard({
        ...row,
        title,
        updated_at: updatedAt
      })
    },

    setBackground(input) {
      const boardId = requireId(input.boardId, 'boardId')
      const row = boardRowOrThrow(boardId)
      const background = input.background === undefined
        ? boardBackground(row.background)
        : boardBackground(input.background)
      const surface = input.surface === undefined
        ? boardSurface(row.surface)
        : boardSurface(input.surface)
      if (background === row.background && surface === row.surface) {
        return rowToBoard(row)
      }
      const updatedAt = nowIso()
      db.prepare(
        `UPDATE whiteboards
            SET background = ?, surface = ?, updated_at = ?
          WHERE id = ?`
      ).run(background, surface, updatedAt, boardId)
      return rowToBoard({
        ...row,
        background,
        surface,
        updated_at: updatedAt
      })
    },

    removeBoard(idInput) {
      removeBoardTransaction(requireId(idInput, 'id'))
    },

    open(boardIdInput) {
      const boardId = requireId(boardIdInput, 'boardId')
      const board = rowToBoard(boardRowOrThrow(boardId))
      const rows = db
        .prepare(
          `SELECT * FROM whiteboard_local_shapes
            WHERE board_id = ? AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC`
        )
        .all(boardId) as ShapeRow[]
      return { board, shapes: rows.map(rowToShape) }
    },

    putShape(input) {
      const boardId = requireId(input.boardId, 'boardId')
      boardRowOrThrow(boardId)
      const id = requireId(input.id, 'id')
      const shape = assertShapeInput(input.shape)
      const existing = db
        .prepare('SELECT * FROM whiteboard_local_shapes WHERE id = ?')
        .get(id) as ShapeRow | undefined
      if (existing !== undefined && existing.board_id !== boardId) {
        throw new NotFoundError('whiteboard shape', id)
      }

      const now = nowIso()
      const createdAt = existing?.created_at ?? now
      db.prepare(
        `INSERT INTO whiteboard_local_shapes
           (id, board_id, kind, data_json, style_json, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           data_json = excluded.data_json,
           style_json = excluded.style_json,
           updated_at = excluded.updated_at,
           -- A tombstone outranks a plain put. Only an explicit restore
           -- (undo) revives a shape the eraser removed; a stale in-flight
           -- save must never bring it back.
           deleted_at = CASE WHEN ? THEN NULL ELSE whiteboard_local_shapes.deleted_at END`
      ).run(
        id,
        boardId,
        shape.kind,
        JSON.stringify(shape.data),
        JSON.stringify(shape.style),
        createdAt,
        now,
        input.restore === true ? 1 : 0
      )
      return {
        id,
        ...shape,
        createdAt,
        updatedAt: now
      }
    },

    removeShapes(input) {
      const boardId = requireId(input.boardId, 'boardId')
      boardRowOrThrow(boardId)
      if (!Array.isArray(input.ids)) {
        throw new ValidationError('ids must be an array')
      }
      const ids = [...new Set(input.ids.map((id) => requireId(id, 'id')))]
      if (ids.length === 0) return
      const now = nowIso()
      const remove = db.transaction((shapeIds: readonly string[]): void => {
        const statement = db.prepare(
          `UPDATE whiteboard_local_shapes
              SET deleted_at = ?, updated_at = ?
            WHERE board_id = ? AND id = ? AND deleted_at IS NULL`
        )
        for (const id of shapeIds) statement.run(now, now, boardId, id)
      })
      remove(ids)
    }
  }
}
