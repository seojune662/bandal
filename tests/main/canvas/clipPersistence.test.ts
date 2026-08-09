/**
 * A PDF clip put on a board has to survive reopening it.
 *
 * `clip` was added to `DrawingKind` but not to the repo's hand-copied list of
 * accepted kinds, so every save was rejected. The clip still appeared, because
 * the renderer adds it to local state first — it only disappeared once the
 * board was closed and reopened, which looks like data loss rather than a
 * validation error.
 *
 * The list is now derived from the shared union, so the two cannot drift.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, test } from 'vitest'
import { createCanvasRepo } from '../../../src/main/features/canvas/canvasRepo'
import { DRAWING_KINDS } from '../../../src/shared/types/drawing'
import { createTestDb, type TestDb } from '../helpers/testDb'

const CLIP = {
  kind: 'clip' as const,
  data: {
    box: { x: 0.3, y: 0.3, width: 0.3, height: 0.2 },
    clip: {
      relPath: '강의/1주차.pdf',
      page: 3,
      label: '1주차.pdf · 3쪽'
    }
  },
  style: { color: 'ink' as const, width: 0.004, opacity: 1 }
}

describe('personal board clips', () => {
  let ctx: TestDb
  let repo: ReturnType<typeof createCanvasRepo>
  let boardId: string

  beforeEach(() => {
    ctx = createTestDb()
    const now = new Date().toISOString()
    ctx.db
      .prepare(
        `INSERT INTO courses (id, name, slug, color, folder_path, archived,
                              sort_order, created_at, updated_at)
         VALUES ('c1', '과목', 'c', '#000', ?, 0, 0, ?, ?)`
      )
      .run(mkdtempSync(join(tmpdir(), 'clip-')), now, now)
    repo = createCanvasRepo(ctx.db)
    boardId = repo.createBoard({ courseId: 'c1' }).id
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('a clip is still on the board after reopening', () => {
    repo.putShape({ boardId, id: 'clip-1', shape: CLIP })

    const shapes = repo.open(boardId).shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0]?.kind).toBe('clip')
  })

  test('the reference survives intact — it is what re-renders the page', () => {
    repo.putShape({ boardId, id: 'clip-1', shape: CLIP })

    const clip = repo.open(boardId).shapes[0]?.data.clip
    expect(clip).toEqual(CLIP.data.clip)
  })

  test('a Korean file path is not mangled on the way through', () => {
    repo.putShape({
      boardId,
      id: 'clip-1',
      shape: {
        ...CLIP,
        data: {
          ...CLIP.data,
          clip: { ...CLIP.data.clip, relPath: '자료/운영체제 3주차.pdf' }
        }
      }
    })

    expect(repo.open(boardId).shapes[0]?.data.clip?.relPath).toBe(
      '자료/운영체제 3주차.pdf'
    )
  })

  test('every kind in the shared union is accepted', () => {
    // The regression was one kind missing from a copied list. Rather than
    // re-listing them here, walk the union itself.
    for (const kind of DRAWING_KINDS) {
      expect(() =>
        repo.putShape({
          boardId,
          id: `shape-${kind}`,
          shape: { ...CLIP, kind }
        })
      ).not.toThrow()
    }
    expect(repo.open(boardId).shapes).toHaveLength(DRAWING_KINDS.length)
  })

  test('an unknown kind is still refused', () => {
    expect(() =>
      repo.putShape({
        boardId,
        id: 'bogus',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        shape: { ...CLIP, kind: 'sticker' as any }
      })
    ).toThrow()
  })
})
