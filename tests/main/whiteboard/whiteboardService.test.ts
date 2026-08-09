import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WhiteboardShape } from '../../../src/shared/types/whiteboard'
import {
  BACKOFF_CAP_MS,
  backoffMs,
  createWhiteboardService,
  type SupabaseClientLike,
  type WhiteboardPushEvent,
  type WhiteboardService
} from '../../../src/main/features/whiteboard/whiteboardService'
import {
  createWhiteboardRepo,
  type WhiteboardRepo
} from '../../../src/main/features/whiteboard/whiteboardRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

interface Result {
  data: unknown
  error: unknown
  status?: number
}

type Filter = { column: string; value: unknown; kind: 'eq' | 'gt' }

class FakeQuery {
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: Record<string, unknown> | null = null
  private readonly filters: Filter[] = []
  private singleMode = false

  constructor(
    private readonly owner: FakeSupabase,
    private readonly table: string
  ) {}

  select(): this {
    return this
  }

  insert(payload: Record<string, unknown>): this {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: Record<string, unknown>): this {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value, kind: 'eq' })
    return this
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ column, value, kind: 'gt' })
    return this
  }

  order(): this {
    return this
  }

  single(): this {
    this.singleMode = true
    return this
  }

  maybeSingle(): this {
    this.singleMode = true
    return this
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every((filter) => {
      if (filter.kind === 'eq') return row[filter.column] === filter.value
      return String(row[filter.column] ?? '') > String(filter.value ?? '')
    })
  }

  private execute(): Result {
    if (this.owner.missingTables) {
      return {
        data: null,
        error: { code: '42P01', message: `relation ${this.table} does not exist` },
        status: 404
      }
    }

    if (this.table === 'whiteboards') {
      if (this.operation === 'insert') {
        const payload = this.payload ?? {}
        const groupId = String(payload['group_id'] ?? '')
        const existing = [...this.owner.boards.values()].find(
          (row) => row['group_id'] === groupId
        )
        if (existing !== undefined) {
          return { data: null, error: { code: '23505', message: 'duplicate' } }
        }
        const stamp = this.owner.iso()
        const row = {
          ...payload,
          created_at: stamp,
          updated_at: stamp
        }
        this.owner.boards.set(String(row['id']), row)
        return { data: row, error: null }
      }
      const rows = [...this.owner.boards.values()].filter((row) => this.matches(row))
      return {
        data: this.singleMode ? (rows[0] ?? null) : rows,
        error: null
      }
    }

    if (this.operation === 'insert') {
      this.owner.shapeInsertCalls += 1
      if (this.owner.failShapeInserts > 0) {
        this.owner.failShapeInserts -= 1
        return { data: null, error: new TypeError('fetch failed') }
      }
      const payload = this.payload ?? {}
      const id = String(payload['id'] ?? '')
      if (this.owner.shapes.has(id)) {
        return { data: null, error: { code: '23505', message: 'duplicate' } }
      }
      this.owner.shapes.set(id, {
        ...payload,
        author_id: 'user-1',
        created_at: this.owner.iso(),
        updated_at: this.owner.iso(),
        deleted_at: null
      })
      if (this.owner.loseNextShapeAck) {
        this.owner.loseNextShapeAck = false
        return { data: null, error: new TypeError('socket closed after commit') }
      }
      return { data: null, error: null }
    }

    if (this.operation === 'update') {
      for (const [id, row] of this.owner.shapes) {
        if (this.matches(row)) {
          this.owner.shapes.set(id, {
            ...row,
            ...this.payload,
            updated_at: this.owner.iso()
          })
        }
      }
      return { data: null, error: null }
    }

    const rows = (this.owner.hideShapesFromSelect
      ? []
      : [...this.owner.shapes.values()])
      .filter((row) => row['deleted_at'] == null)
      .filter((row) => this.matches(row))
      .sort((a, b) => String(a['created_at']).localeCompare(String(b['created_at'])))
    return { data: rows, error: null }
  }
}

class FakeChannel {
  private readonly handlers = new Map<string, (input: { payload: unknown }) => void>()
  private statusHandler: ((status: string) => void) | null = null
  unsubscribed = false

  on(
    _type: string,
    filter: { event: string },
    handler: (input: { payload: unknown }) => void
  ): this {
    this.handlers.set(filter.event, handler)
    return this
  }

  subscribe(handler: (status: string) => void): this {
    this.statusHandler = handler
    return this
  }

  unsubscribe(): Promise<'ok'> {
    this.unsubscribed = true
    return Promise.resolve('ok')
  }

  broadcast(event: string, payload: unknown): void {
    this.handlers.get(event)?.({ payload })
  }

  status(status: string): void {
    this.statusHandler?.(status)
  }
}

class FakeSupabase {
  readonly boards = new Map<string, Record<string, unknown>>()
  readonly shapes = new Map<string, Record<string, unknown>>()
  readonly channels = new Map<string, FakeChannel>()
  missingTables = false
  failShapeInserts = 0
  loseNextShapeAck = false
  hideShapesFromSelect = false
  shapeInsertCalls = 0
  removeChannelCalls = 0

  constructor(private readonly clock: () => number) {}

  iso(): string {
    return new Date(this.clock()).toISOString()
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table)
  }

  channel(topic: string): FakeChannel {
    const channel = new FakeChannel()
    this.channels.set(topic, channel)
    return channel
  }

  removeChannel(): Promise<'ok'> {
    this.removeChannelCalls += 1
    return Promise.resolve('ok')
  }

  asClient(): SupabaseClientLike {
    return this as unknown as SupabaseClientLike
  }
}

let testDb: TestDb
let repo: WhiteboardRepo
let service: WhiteboardService | null
let nowMs: number

beforeEach(() => {
  testDb = createTestDb()
  repo = createWhiteboardRepo(testDb.db)
  service = null
  nowMs = Date.parse('2026-08-07T00:00:00.000Z')
}, 30_000)

afterEach(() => {
  service?.dispose()
  testDb.cleanup()
})

function shapeInput(boardId: string, id = 'shape-1') {
  return {
    boardId,
    id,
    shape: {
      kind: 'ink' as const,
      data: { points: [{ x: 0.1, y: 0.2, p: 0.5 }] },
      style: { color: 'blue' as const, width: 0.01, opacity: 1 }
    }
  }
}

function makeService(
  getClient: () => SupabaseClientLike | null,
  events: { groupId: string; event: WhiteboardPushEvent }[] = []
): WhiteboardService {
  const created = createWhiteboardService({
    repo,
    getClient,
    getUserId: () => 'user-1',
    emit: (groupId, event) => events.push({ groupId, event }),
    now: () => nowMs,
    schedule: () => ({ unref: () => undefined }) as unknown as NodeJS.Timeout
  })
  service = created
  return created
}

describe('whiteboard upload outbox', () => {
  test('keeps offline ink pending, then uploads it after recovery', async () => {
    let currentClient: SupabaseClientLike | null = null
    const fake = new FakeSupabase(() => nowMs)
    const whiteboard = makeService(() => currentClient)

    const openedOffline = await whiteboard.open('group-1')
    expect(openedOffline.availability).toEqual({ state: 'unconfigured' })
    const board = openedOffline.board
    expect(board).not.toBeNull()
    if (board === null) return

    const local = await whiteboard.addShape(shapeInput(board.id))
    expect(repo.pending(10).map((shape) => shape.id)).toEqual([local.id])

    currentClient = fake.asClient()
    await whiteboard.open('group-1')
    await whiteboard.sync(board.id, null)

    expect(fake.shapes.size).toBe(1)
    expect(repo.pending(10)).toEqual([])
    expect(repo.listShapes(board.id).map((shape) => shape.id)).toEqual([local.id])
  })

  test('treats retrying a committed id as idempotent success', async () => {
    const fake = new FakeSupabase(() => nowMs)
    const whiteboard = makeService(() => fake.asClient())
    const opened = await whiteboard.open('group-1')
    if (opened.board === null) return
    await whiteboard.sync(opened.board.id, null)

    fake.loseNextShapeAck = true
    fake.hideShapesFromSelect = true
    const local = await whiteboard.addShape(shapeInput(opened.board.id))
    await vi.waitFor(() => expect(repo.attempts(local.id)).toBe(1))

    expect(fake.shapes.size).toBe(1)
    expect(fake.shapeInsertCalls).toBe(1)
    await whiteboard.sync(opened.board.id, null)
    expect(fake.shapeInsertCalls).toBe(1)

    nowMs += 1_000
    await whiteboard.sync(opened.board.id, null)
    expect(fake.shapeInsertCalls).toBe(2)
    expect(fake.shapes.size).toBe(1)
    expect(repo.pending(10)).toEqual([])
  })

  test('a failed upload never rejects the drawing action', async () => {
    const fake = new FakeSupabase(() => nowMs)
    fake.failShapeInserts = 1
    const whiteboard = makeService(() => fake.asClient())
    const opened = await whiteboard.open('group-1')
    if (opened.board === null) return

    await expect(
      whiteboard.addShape(shapeInput(opened.board.id))
    ).resolves.toMatchObject({ id: 'shape-1' })
    await vi.waitFor(() => expect(repo.attempts('shape-1')).toBe(1))
    expect(repo.listShapes(opened.board.id)).toHaveLength(1)
  })

  test('recovers a missed removal by diffing the remote live snapshot', async () => {
    const fake = new FakeSupabase(() => nowMs)
    const whiteboard = makeService(() => fake.asClient())
    const opened = await whiteboard.open('group-1')
    if (opened.board === null) return
    const local = await whiteboard.addShape(shapeInput(opened.board.id))
    await whiteboard.sync(opened.board.id, null)
    const remote = fake.shapes.get(local.id)
    expect(remote).toBeDefined()
    if (remote === undefined) return
    fake.shapes.set(local.id, {
      ...remote,
      deleted_at: '2026-08-07T00:02:00.000Z'
    })

    const result = await whiteboard.sync(
      opened.board.id,
      '2026-08-07T00:01:00.000Z'
    )
    expect(result.removedIds).toEqual([local.id])
    expect(repo.listShapes(opened.board.id)).toEqual([])
  })

  test('uploads repeated edits as one stable remote row', async () => {
    const fake = new FakeSupabase(() => nowMs)
    const whiteboard = makeService(() => fake.asClient())
    const opened = await whiteboard.open('group-1')
    if (opened.board === null) return
    const inserted = await whiteboard.addShape(shapeInput(opened.board.id))
    await whiteboard.sync(opened.board.id, null)
    const canonical = repo.listShapes(opened.board.id)[0]
    expect(canonical).toBeDefined()
    if (canonical === undefined) return

    nowMs += 1_000
    const first = await whiteboard.updateShape({
      ...shapeInput(opened.board.id, inserted.id),
      shape: {
        ...shapeInput(opened.board.id, inserted.id).shape,
        style: { color: 'red', width: 0.02, opacity: 0.8 }
      }
    })
    await whiteboard.sync(opened.board.id, null)
    nowMs += 1_000
    const second = await whiteboard.updateShape({
      ...shapeInput(opened.board.id, inserted.id),
      shape: {
        ...shapeInput(opened.board.id, inserted.id).shape,
        style: { color: 'green', width: 0.03, opacity: 0.7 }
      }
    })
    await whiteboard.sync(opened.board.id, null)

    expect(first.id).toBe(inserted.id)
    expect(second).toMatchObject({
      id: inserted.id,
      createdAt: canonical.createdAt,
      style: { color: 'green' }
    })
    expect(fake.shapes.size).toBe(1)
    expect(fake.shapes.get(inserted.id)?.['style_json']).toMatchObject({
      color: 'green'
    })
    expect(repo.pending(10)).toEqual([])
  })
})

describe('remote availability and realtime', () => {
  test('maps 42P01/404 to not-provisioned and still permits local drawing', async () => {
    const fake = new FakeSupabase(() => nowMs)
    fake.missingTables = true
    const whiteboard = makeService(() => fake.asClient())

    const opened = await whiteboard.open('group-1')
    expect(opened.availability).toEqual({ state: 'not-provisioned' })
    expect(opened.board).not.toBeNull()
    if (opened.board === null) return

    await expect(
      whiteboard.addShape(shapeInput(opened.board.id))
    ).resolves.toMatchObject({ id: 'shape-1' })
    expect(repo.pending(10)).toHaveLength(1)
    expect(repo.attempts('shape-1')).toBe(0)
  })

  test('ingests wb_shape and wb_remove from a dedicated group channel', async () => {
    const fake = new FakeSupabase(() => nowMs)
    const events: { groupId: string; event: WhiteboardPushEvent }[] = []
    const whiteboard = makeService(() => fake.asClient(), events)
    const opened = await whiteboard.open('group-1')
    if (opened.board === null) return
    const channel = fake.channels.get('group:group-1')
    expect(channel).toBeDefined()
    if (channel === undefined) return

    const remote: WhiteboardShape = {
      id: 'remote-shape',
      boardId: opened.board.id,
      authorId: 'user-2',
      kind: 'rect',
      data: { box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
      style: { color: 'red', width: 0.01, opacity: 1 },
      createdAt: '2026-08-07T00:01:00.000Z',
      updatedAt: '2026-08-07T00:01:00.000Z'
    }
    channel.broadcast('wb_shape', {
      id: remote.id,
      boardId: remote.boardId,
      groupId: 'group-1',
      authorId: remote.authorId,
      kind: remote.kind,
      dataJson: remote.data,
      styleJson: remote.style,
      createdAt: remote.createdAt,
      deletedAt: null
    })
    expect(repo.listShapes(opened.board.id).map((shape) => shape.id)).toEqual([
      remote.id
    ])

    channel.broadcast('wb_remove', {
      boardId: opened.board.id,
      ids: [remote.id]
    })
    expect(repo.listShapes(opened.board.id)).toEqual([])
    expect(events.map(({ event }) => event.type)).toEqual(['shape', 'remove'])
  })

  test('close tears down only the requested group channel', async () => {
    const fake = new FakeSupabase(() => nowMs)
    const whiteboard = makeService(() => fake.asClient())
    await whiteboard.open('group-1')
    const channel = fake.channels.get('group:group-1')
    expect(channel).toBeDefined()

    expect(whiteboard.close('group-1')).toEqual({ ok: true })
    expect(channel?.unsubscribed).toBe(true)
    expect(fake.removeChannelCalls).toBe(1)
    expect(whiteboard.close('group-1')).toEqual({ ok: true })
    expect(fake.removeChannelCalls).toBe(1)
  })
})

describe('backoffMs', () => {
  test('doubles by attempt and caps at sixty seconds', () => {
    expect(backoffMs(0)).toBe(1_000)
    expect(backoffMs(1)).toBe(2_000)
    expect(backoffMs(5)).toBe(32_000)
    expect(backoffMs(20)).toBe(BACKOFF_CAP_MS)
    expect(backoffMs(-1)).toBe(1_000)
  })
})

/**
 * Reported three times: erase something on the shared board, go elsewhere,
 * come back, and it is there again.
 *
 * The repo-level fixes were right but incomplete. `sync` answered with the
 * snapshot it had just fetched from the server rather than with the reconciled
 * local state. The server still lists a shape whose removal it has not
 * accepted, so the shape came back down the wire; the renderer merges
 * additively and its "removed" set is per-mount, so reopening the board
 * resurrected everything the student had erased.
 */
describe('erasing on the shared board survives a reopen', () => {
  test('sync does not hand back a shape that is locally erased', async () => {
    const fake = new FakeSupabase(() => nowMs)
    const whiteboard = makeService(() => fake.asClient())

    const opened = await whiteboard.open('group-1')
    const board = opened.board
    expect(board).not.toBeNull()
    if (board === null) return

    await whiteboard.addShape(shapeInput(board.id, 'shape-1'))
    await whiteboard.addShape(shapeInput(board.id, 'shape-2'))
    await whiteboard.sync(board.id, null)

    await whiteboard.removeShapes({ boardId: board.id, ids: ['shape-1'] })

    // The server still reports it as live — exactly what happens when the
    // delete matched no rows there (RLS, or it never arrived).
    fake.shapes.set('shape-1', {
      ...(fake.shapes.get('shape-1') ?? {}),
      deleted_at: null
    })

    // A fresh mount syncs from scratch.
    const result = await whiteboard.sync(board.id, null)

    expect(result.shapes.map((shape) => shape.id)).toEqual(['shape-2'])
    // And the renderer is told explicitly, so a merge cannot re-add it.
    expect(result.removedIds).toContain('shape-1')
  })

  test('a shape nobody erased still arrives', async () => {
    const fake = new FakeSupabase(() => nowMs)
    const whiteboard = makeService(() => fake.asClient())

    const opened = await whiteboard.open('group-1')
    const board = opened.board
    if (board === null) throw new Error('board')

    await whiteboard.addShape(shapeInput(board.id, 'keeper'))

    const result = await whiteboard.sync(board.id, null)

    expect(result.shapes.map((shape) => shape.id)).toContain('keeper')
    expect(result.removedIds).not.toContain('keeper')
  })
})
