/** Durable local mirror and outbox for group whiteboard shapes. */

import type { Database } from 'better-sqlite3'
import type {
  DrawingData,
  DrawingKind,
  DrawingStyle
} from '../../../shared/types/drawing'
import type {
  AddWhiteboardShapeInput,
  UpdateWhiteboardShapeInput,
  Whiteboard,
  WhiteboardShape
} from '../../../shared/types/whiteboard'
import { nowIso, requireId } from '../../db/validate'

export const MAX_WHITEBOARD_UPLOAD_ATTEMPTS = 6

interface BoardRow {
  id: string
  group_id: string
  title: string
  synced_at: string | null
  created_at: string
  updated_at: string
}

interface ShapeRow {
  id: string
  board_id: string
  group_id: string
  author_id: string
  kind: string
  data_json: string
  style_json: string
  pending: number
  attempts: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface PendingWhiteboardRemoval {
  id: string
  boardId: string
  groupId: string
  attempts: number
  deletedAt: string
}

export interface WhiteboardRepo {
  upsertBoard(board: Whiteboard): void
  getBoardByGroup(groupId: string): Whiteboard | null
  getBoardById(boardId: string): Whiteboard | null
  listShapes(boardId: string): WhiteboardShape[]
  insertLocal(
    input: AddWhiteboardShapeInput,
    authorId: string,
    groupId: string
  ): WhiteboardShape
  updateShape(input: UpdateWhiteboardShapeInput): WhiteboardShape | null
  markSynced(id: string): void
  markShapeSynced(shape: WhiteboardShape): void
  markAttempt(id: string): void
  park(id: string): void
  pending(limit: number): WhiteboardShape[]
  softDelete(ids: string[]): void
  applyRemote(shapes: readonly WhiteboardShape[]): void

  /** Extra mirror metadata used by reconnect/catch-up. */
  getBoardSyncedAt(boardId: string): string | null
  markBoardSynced(boardId: string, syncedAt: string): void
  replaceBoard(localBoardId: string, remoteBoard: Whiteboard): void
  attempts(id: string): number
  isDeleted(id: string): boolean
  confirmedShapeIds(boardId: string): string[]
  pendingRemovals(limit: number): PendingWhiteboardRemoval[]
  applyRemoteRemovals(ids: readonly string[]): void
  clearAll(): void
}

function parseJsonObject<T extends object>(json: string): T {
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as T
    }
  } catch {
    // A corrupt cache row should not make the rest of an offline board vanish.
  }
  return {} as T
}

function rowToShape(row: ShapeRow): WhiteboardShape {
  return {
    id: row.id,
    boardId: row.board_id,
    authorId: row.author_id,
    kind: row.kind as DrawingKind,
    data: parseJsonObject<DrawingData>(row.data_json),
    style: parseJsonObject<DrawingStyle>(row.style_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function nextShapeUpdatedAt(row: ShapeRow): string {
  const current = Date.now()
  const previous = Math.max(
    Date.parse(row.created_at),
    Date.parse(row.updated_at)
  )
  return new Date(Math.max(current, previous + 1)).toISOString()
}

export function createWhiteboardRepo(db: Database): WhiteboardRepo {
  // created_by is deliberately absent from migration 10. Keep it while this
  // repo instance is alive and use an empty value after a cold cache restore.
  const boardAuthors = new Map<string, string>()

  function rowToBoard(row: BoardRow): Whiteboard {
    return {
      id: row.id,
      groupId: row.group_id,
      title: row.title,
      createdBy: boardAuthors.get(row.id) ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  function writeBoard(board: Whiteboard): void {
    boardAuthors.set(board.id, board.createdBy)
    db.prepare(
      `INSERT INTO whiteboard_boards_cache
         (id, group_id, title, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)
       ON CONFLICT(group_id) DO UPDATE SET
         id = excluded.id,
         title = excluded.title,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      board.id,
      board.groupId,
      board.title,
      board.createdAt,
      board.updatedAt
    )
  }

  const applyRemoteBatch = db.transaction(
    (shapes: readonly WhiteboardShape[]) => {
      const statement = db.prepare(
        `INSERT INTO whiteboard_shapes_cache
           (id, board_id, group_id, author_id, kind, data_json, style_json,
            pending, attempts, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           board_id = CASE WHEN whiteboard_shapes_cache.pending = 1
             THEN whiteboard_shapes_cache.board_id ELSE excluded.board_id END,
           group_id = CASE WHEN whiteboard_shapes_cache.pending = 1
             THEN whiteboard_shapes_cache.group_id ELSE excluded.group_id END,
           author_id = CASE WHEN whiteboard_shapes_cache.pending = 1
             THEN whiteboard_shapes_cache.author_id ELSE excluded.author_id END,
           kind = CASE WHEN whiteboard_shapes_cache.pending = 1
             THEN whiteboard_shapes_cache.kind ELSE excluded.kind END,
           data_json = CASE WHEN whiteboard_shapes_cache.pending = 1
             THEN whiteboard_shapes_cache.data_json ELSE excluded.data_json END,
           style_json = CASE WHEN whiteboard_shapes_cache.pending = 1
             THEN whiteboard_shapes_cache.style_json ELSE excluded.style_json END,
           created_at = CASE WHEN whiteboard_shapes_cache.pending = 1
             THEN whiteboard_shapes_cache.created_at ELSE excluded.created_at END,
           updated_at = CASE WHEN whiteboard_shapes_cache.pending = 1
             THEN whiteboard_shapes_cache.updated_at ELSE excluded.updated_at END,
           -- A local tombstone ALWAYS wins, pending or not.
           --
           -- This used to clear deleted_at once the removal was marked synced,
           -- which meant any server row that still existed revived the shape
           -- on the next sync. Combined with an upload that could report
           -- success without touching a row, erasing on the shared board
           -- looked fine and then undid itself after switching away.
           --
           -- Only an explicit restore un-deletes, exactly like the personal
           -- canvas. Genuine server-side deletions arrive via
           -- applyRemoteRemovals, not through this path.
           deleted_at = CASE
             WHEN whiteboard_shapes_cache.deleted_at IS NOT NULL
               THEN whiteboard_shapes_cache.deleted_at
             ELSE NULL END,
           pending = CASE
             WHEN whiteboard_shapes_cache.pending = 1
              AND whiteboard_shapes_cache.deleted_at IS NOT NULL THEN 1
             WHEN whiteboard_shapes_cache.pending = 1
              AND whiteboard_shapes_cache.kind = excluded.kind
              AND whiteboard_shapes_cache.data_json = excluded.data_json
              AND whiteboard_shapes_cache.style_json = excluded.style_json THEN 0
             WHEN whiteboard_shapes_cache.pending = 1 THEN 1
             ELSE 0 END,
           attempts = CASE
             WHEN whiteboard_shapes_cache.pending = 1
              AND whiteboard_shapes_cache.deleted_at IS NOT NULL
               THEN whiteboard_shapes_cache.attempts
             WHEN whiteboard_shapes_cache.pending = 1
              AND (
                whiteboard_shapes_cache.kind != excluded.kind
                OR whiteboard_shapes_cache.data_json != excluded.data_json
                OR whiteboard_shapes_cache.style_json != excluded.style_json
              ) THEN whiteboard_shapes_cache.attempts
             ELSE 0 END`
      )
      for (const shape of shapes) {
        const board = db
          .prepare('SELECT group_id FROM whiteboard_boards_cache WHERE id = ?')
          .get(shape.boardId) as { group_id: string } | undefined
        // Realtime payloads need not repeat groupId; the board cache owns it.
        const groupId = board?.group_id ?? ''
        statement.run(
          shape.id,
          shape.boardId,
          groupId,
          shape.authorId,
          shape.kind,
          JSON.stringify(shape.data),
          JSON.stringify(shape.style),
          shape.createdAt,
          shape.updatedAt
        )
      }
    }
  )

  return {
    upsertBoard(board) {
      writeBoard(board)
    },

    getBoardByGroup(groupId) {
      const row = db
        .prepare('SELECT * FROM whiteboard_boards_cache WHERE group_id = ?')
        .get(requireId(groupId, 'groupId')) as BoardRow | undefined
      return row === undefined ? null : rowToBoard(row)
    },

    getBoardById(boardId) {
      const row = db
        .prepare('SELECT * FROM whiteboard_boards_cache WHERE id = ?')
        .get(requireId(boardId, 'boardId')) as BoardRow | undefined
      return row === undefined ? null : rowToBoard(row)
    },

    listShapes(boardId) {
      const rows = db
        .prepare(
          `SELECT * FROM whiteboard_shapes_cache
            WHERE board_id = ? AND deleted_at IS NULL
            ORDER BY created_at ASC`
        )
        .all(requireId(boardId, 'boardId')) as ShapeRow[]
      return rows.map(rowToShape)
    },

    insertLocal(input, authorIdInput, groupIdInput) {
      const id = requireId(input.id, 'id')
      const boardId = requireId(input.boardId, 'boardId')
      const authorId = requireId(authorIdInput, 'authorId')
      const groupId = requireId(groupIdInput, 'groupId')
      const existing = db
        .prepare('SELECT * FROM whiteboard_shapes_cache WHERE id = ?')
        .get(id) as ShapeRow | undefined
      if (existing !== undefined) return rowToShape(existing)

      const now = nowIso()
      db.prepare(
        `INSERT INTO whiteboard_shapes_cache
           (id, board_id, group_id, author_id, kind, data_json, style_json,
            pending, attempts, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, NULL)`
      ).run(
        id,
        boardId,
        groupId,
        authorId,
        input.shape.kind,
        JSON.stringify(input.shape.data),
        JSON.stringify(input.shape.style),
        now,
        now
      )
      return {
        id,
        boardId,
        authorId,
        ...input.shape,
        createdAt: now,
        updatedAt: now
      }
    },

    updateShape(input) {
      const id = requireId(input.id, 'id')
      const boardId = requireId(input.boardId, 'boardId')
      const existing = db
        .prepare(
          `SELECT * FROM whiteboard_shapes_cache
            WHERE id = ? AND board_id = ? AND deleted_at IS NULL`
        )
        .get(id, boardId) as ShapeRow | undefined
      if (existing === undefined || input.shape.kind !== existing.kind) return null

      // A shape edited before its first upload must remain an INSERT in the
      // durable outbox. Once confirmed, updated_at diverges from created_at
      // and makes the same row a durable UPDATE across app restarts.
      const updatedAt = existing.pending === 1 &&
        existing.updated_at === existing.created_at
        ? existing.created_at
        : nextShapeUpdatedAt(existing)
      db.prepare(
        `UPDATE whiteboard_shapes_cache
            SET data_json = ?, style_json = ?, updated_at = ?,
                pending = 1, attempts = 0
          WHERE id = ? AND board_id = ? AND deleted_at IS NULL`
      ).run(
        JSON.stringify(input.shape.data),
        JSON.stringify(input.shape.style),
        updatedAt,
        id,
        boardId
      )
      return rowToShape({
        ...existing,
        data_json: JSON.stringify(input.shape.data),
        style_json: JSON.stringify(input.shape.style),
        updated_at: updatedAt,
        pending: 1,
        attempts: 0
      })
    },

    markSynced(id) {
      db.prepare(
        'UPDATE whiteboard_shapes_cache SET pending = 0 WHERE id = ?'
      ).run(requireId(id, 'id'))
    },

    markShapeSynced(shape) {
      db.prepare(
        `UPDATE whiteboard_shapes_cache
            SET pending = 0, attempts = 0
          WHERE id = ? AND board_id = ? AND kind = ?
            AND data_json = ? AND style_json = ?
            AND updated_at = ? AND deleted_at IS NULL`
      ).run(
        requireId(shape.id, 'id'),
        requireId(shape.boardId, 'boardId'),
        shape.kind,
        JSON.stringify(shape.data),
        JSON.stringify(shape.style),
        shape.updatedAt
      )
    },

    markAttempt(id) {
      db.prepare(
        'UPDATE whiteboard_shapes_cache SET attempts = attempts + 1 WHERE id = ?'
      ).run(requireId(id, 'id'))
    },

    park(id) {
      db.prepare(
        'UPDATE whiteboard_shapes_cache SET attempts = ? WHERE id = ?'
      ).run(MAX_WHITEBOARD_UPLOAD_ATTEMPTS, requireId(id, 'id'))
    },

    pending(limit) {
      const rows = db
        .prepare(
          `SELECT * FROM whiteboard_shapes_cache
            WHERE pending = 1 AND deleted_at IS NULL
              AND attempts < ?
            ORDER BY created_at ASC
            LIMIT ?`
        )
        .all(
          MAX_WHITEBOARD_UPLOAD_ATTEMPTS,
          Math.max(1, Math.trunc(limit))
        ) as ShapeRow[]
      return rows.map(rowToShape)
    },

    softDelete(idsInput) {
      const ids = [...new Set(idsInput.map((id) => requireId(id, 'id')))]
      if (ids.length === 0) return
      const remove = db.transaction((shapeIds: readonly string[]) => {
        const statement = db.prepare(
          `UPDATE whiteboard_shapes_cache
              SET deleted_at = ?, updated_at = ?, pending = 1, attempts = 0
            WHERE id = ?`
        )
        const now = nowIso()
        for (const id of shapeIds) statement.run(now, now, id)
      })
      remove(ids)
    },

    applyRemote(shapes) {
      if (shapes.length > 0) applyRemoteBatch(shapes)
    },

    getBoardSyncedAt(boardId) {
      const row = db
        .prepare('SELECT synced_at FROM whiteboard_boards_cache WHERE id = ?')
        .get(requireId(boardId, 'boardId')) as
        | { synced_at: string | null }
        | undefined
      return row?.synced_at ?? null
    },

    markBoardSynced(boardId, syncedAt) {
      db.prepare(
        'UPDATE whiteboard_boards_cache SET synced_at = ? WHERE id = ?'
      ).run(syncedAt, requireId(boardId, 'boardId'))
    },

    replaceBoard(localBoardId, remoteBoard) {
      const replace = db.transaction(() => {
        db.prepare(
          'UPDATE whiteboard_shapes_cache SET board_id = ? WHERE board_id = ?'
        ).run(remoteBoard.id, localBoardId)
        db.prepare(
          'DELETE FROM whiteboard_boards_cache WHERE id = ? OR group_id = ?'
        ).run(localBoardId, remoteBoard.groupId)
        writeBoard(remoteBoard)
      })
      replace()
    },

    attempts(id) {
      const row = db
        .prepare('SELECT attempts FROM whiteboard_shapes_cache WHERE id = ?')
        .get(requireId(id, 'id')) as { attempts: number } | undefined
      return row?.attempts ?? 0
    },

    isDeleted(id) {
      const row = db
        .prepare('SELECT deleted_at FROM whiteboard_shapes_cache WHERE id = ?')
        .get(requireId(id, 'id')) as { deleted_at: string | null } | undefined
      return row?.deleted_at != null
    },

    confirmedShapeIds(boardId) {
      const rows = db
        .prepare(
          `SELECT id FROM whiteboard_shapes_cache
            WHERE board_id = ? AND pending = 0 AND deleted_at IS NULL`
        )
        .all(requireId(boardId, 'boardId')) as { id: string }[]
      return rows.map((row) => row.id)
    },

    pendingRemovals(limit) {
      const rows = db
        .prepare(
          `SELECT id, board_id, group_id, attempts, deleted_at
             FROM whiteboard_shapes_cache
            WHERE pending = 1 AND deleted_at IS NOT NULL
              AND attempts < ?
            ORDER BY updated_at ASC
            LIMIT ?`
        )
        .all(
          MAX_WHITEBOARD_UPLOAD_ATTEMPTS,
          Math.max(1, Math.trunc(limit))
        ) as Pick<
        ShapeRow,
        | 'id'
        | 'board_id'
        | 'group_id'
        | 'attempts'
        | 'deleted_at'
      >[]
      return rows.map((row) => ({
        id: row.id,
        boardId: row.board_id,
        groupId: row.group_id,
        attempts: row.attempts,
        deletedAt: row.deleted_at ?? nowIso()
      }))
    },

    applyRemoteRemovals(idsInput) {
      const ids = [...new Set(idsInput.map((id) => requireId(id, 'id')))]
      if (ids.length === 0) return
      const apply = db.transaction((shapeIds: readonly string[]) => {
        const statement = db.prepare(
          `UPDATE whiteboard_shapes_cache
              SET deleted_at = COALESCE(deleted_at, ?), pending = 0
            WHERE id = ?`
        )
        const now = nowIso()
        for (const id of shapeIds) statement.run(now, id)
      })
      apply(ids)
    },

    clearAll() {
      const run = db.transaction(() => {
        db.prepare('DELETE FROM whiteboard_shapes_cache').run()
        db.prepare('DELETE FROM whiteboard_boards_cache').run()
      })
      run()
      boardAuthors.clear()
    }
  }
}
