/**
 * Shared whiteboard for a 함께하기 group.
 *
 * Scope decision: "같이 보고 각자 그리기" — a completed stroke is persisted and
 * shows up for everyone within a second or two. There is no per-point op
 * stream and no shared cursor, which is what keeps this buildable:
 *
 *  - The `messages` table cannot carry ink. Its token bucket is capacity 20 /
 *    refill 2 per second (0006_messages.sql), which a single pen stroke would
 *    blow through.
 *  - One row per FINISHED shape instead. A minute of drawing is tens of rows,
 *    not thousands of ops, so it fits comfortably in a normal insert budget
 *    and needs no CRDT.
 *  - Conflict resolution is therefore trivial: shapes are immutable once
 *    written and only ever soft-deleted, so two people drawing at once cannot
 *    produce a conflict — only a union.
 *
 * Ids are generated CLIENT-side (same trick as `messages`): a retry after a
 * dropped response collides on the primary key, which makes the write
 * idempotent without a dedupe table.
 */

import type { DrawingShape } from './drawing'

export interface Whiteboard {
  id: string
  groupId: string
  title: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface WhiteboardShape extends DrawingShape {
  boardId: string
  /** Remote user id of whoever drew it. */
  authorId: string
}

export interface CreateWhiteboardInput {
  groupId: string
  title?: string
}

export interface AddWhiteboardShapeInput {
  boardId: string
  /** Client-generated uuid — retrying with the same id is a no-op, not a duplicate. */
  id: string
  shape: Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'>
}

/**
 * Edit a shape in place.
 *
 * Without this the UI faked an edit as delete + insert under a NEW id, which
 * broke three things at once: undo entries pointed at ids that no longer
 * existed (and undo then jammed permanently), `createdAt` was re-stamped so an
 * edited shape jumped to the front of the z-order, and one drag cost two
 * round-trips that could half-fail.
 *
 * Immutability is kept where it actually earned its keep: RLS lets you edit
 * only shapes YOU drew, so two people can never contend for the same row and
 * the "union, no CRDT" property still holds for everyone else's work.
 */
export interface UpdateWhiteboardShapeInput {
  boardId: string
  id: string
  shape: Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'>
}

export interface RemoveWhiteboardShapesInput {
  boardId: string
  ids: string[]
}

/**
 * Why the board can be unusable even when the group is fine: the remote
 * schema for whiteboards ships as its own migration, so a project that has
 * not applied it yet must degrade to a clear message instead of a crash.
 */
export type WhiteboardAvailability =
  | { state: 'ready' }
  | { state: 'signed-out' }
  | { state: 'unconfigured' }
  /** Tables missing — the 0010 migration has not been applied to the project. */
  | { state: 'not-provisioned' }

export interface OpenWhiteboardResult {
  availability: WhiteboardAvailability
  board: Whiteboard | null
  shapes: WhiteboardShape[]
}

// -- personal whiteboards -----------------------------------------------------

/**
 * A board that never leaves the machine. No account, no sync, works offline —
 * the student's own space for organising or sketching a mind map.
 */
export interface PersonalBoard {
  id: string
  courseId: string
  title: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreatePersonalBoardInput {
  courseId: string
  title?: string
}

export interface RenamePersonalBoardInput {
  id: string
  title: string
}

export interface PutPersonalShapeInput {
  boardId: string
  /** Client-generated; re-putting the same id updates in place. */
  id: string
  shape: Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'>
  /**
   * Explicitly bring a soft-deleted shape back. Only undo sets this.
   *
   * Without the flag a plain put silently cleared `deleted_at`, so anything
   * that re-sent a shape after the eraser ran — a late in-flight save, a
   * pending move — quietly resurrected it. The student erased something,
   * reopened the board, and it was back. Deletion is a tombstone now, and
   * un-deleting has to say so.
   */
  restore?: boolean
}

export interface RemovePersonalShapesInput {
  boardId: string
  ids: string[]
}

export interface OpenPersonalBoardResult {
  board: PersonalBoard
  shapes: DrawingShape[]
}
