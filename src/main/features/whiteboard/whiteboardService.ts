import { randomUUID } from 'node:crypto'
import type {
  RealtimeChannel,
  SupabaseClient
} from '@supabase/supabase-js'
import type { DrawingData, DrawingKind, DrawingStyle } from '../../../shared/types/drawing'
import type {
  AddWhiteboardShapeInput,
  OpenWhiteboardResult,
  RemoveWhiteboardShapesInput,
  UpdateWhiteboardShapeInput,
  Whiteboard,
  WhiteboardShape
} from '../../../shared/types/whiteboard'
import { NotFoundError } from '../../db/errors'
import {
  MAX_WHITEBOARD_UPLOAD_ATTEMPTS,
  type PendingWhiteboardRemoval,
  type WhiteboardRepo
} from './whiteboardRepo'

export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_CAP_MS = 60_000
const OUTBOX_BATCH_SIZE = 100
const DEFAULT_BOARD_TITLE = '화이트보드'
export type SupabaseClientLike = Pick<
  SupabaseClient,
  'from' | 'channel' | 'removeChannel'
>

export type WhiteboardPushEvent =
  | { type: 'shape'; shape: WhiteboardShape }
  | { type: 'remove'; boardId: string; ids: string[] }
  | {
      type: 'sync'
      boardId: string
      shapes: WhiteboardShape[]
      removedIds: string[]
      syncedAt: string
    }

export interface WhiteboardSyncResult {
  shapes: WhiteboardShape[]
  removedIds: string[]
  syncedAt: string
}

export interface WhiteboardServiceDeps {
  repo: WhiteboardRepo
  /** null means that Supabase is not configured in this build. */
  getClient: () => SupabaseClientLike | null
  getUserId: () => string | null
  emit: (groupId: string, event: WhiteboardPushEvent) => void
  now?: () => number
  schedule?: (fn: () => void, ms: number) => NodeJS.Timeout
}

export interface WhiteboardService {
  open(groupId: string): Promise<OpenWhiteboardResult>
  addShape(input: AddWhiteboardShapeInput): Promise<WhiteboardShape>
  updateShape(input: UpdateWhiteboardShapeInput): Promise<WhiteboardShape>
  removeShapes(input: RemoveWhiteboardShapesInput): Promise<{ ok: true }>
  sync(boardId: string, since: string | null): Promise<WhiteboardSyncResult>
  close(groupId: string): { ok: true }
  dispose(): void
}

interface QueryResponse {
  data: unknown
  error: unknown
  status?: number
}

interface RealtimeEntry {
  groupId: string
  boardId: string
  client: SupabaseClientLike
  channel: RealtimeChannel
}

class NotProvisionedError extends Error {
  override readonly name = 'NotProvisionedError'
}

export function backoffMs(attempts: number, base = BACKOFF_BASE_MS): number {
  return Math.min(BACKOFF_CAP_MS, base * 2 ** Math.max(0, attempts))
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(record: Record<string, unknown>, snake: string, camel: string): string {
  const value = record[snake] ?? record[camel]
  return typeof value === 'string' ? value : ''
}

function objectValue<T extends object>(
  record: Record<string, unknown>,
  ...keys: string[]
): T {
  const value = keys.map((key) => record[key]).find((candidate) => candidate != null)
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as T
      }
    } catch {
      return {} as T
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as T)
    : ({} as T)
}

function asRemoteBoard(value: unknown): Whiteboard | null {
  const row = asRecord(value)
  const id = str(row, 'id', 'id')
  const groupId = str(row, 'group_id', 'groupId')
  if (id === '' || groupId === '') return null
  const now = new Date().toISOString()
  return {
    id,
    groupId,
    title: str(row, 'title', 'title') || DEFAULT_BOARD_TITLE,
    createdBy: str(row, 'created_by', 'createdBy'),
    createdAt: str(row, 'created_at', 'createdAt') || now,
    updatedAt: str(row, 'updated_at', 'updatedAt') || now
  }
}

function asRemoteShape(value: unknown): WhiteboardShape | null {
  const row = asRecord(value)
  const id = str(row, 'id', 'id')
  const boardId = str(row, 'board_id', 'boardId')
  if (id === '' || boardId === '') return null
  const now = new Date().toISOString()
  return {
    id,
    boardId,
    authorId: str(row, 'author_id', 'authorId'),
    kind: str(row, 'kind', 'kind') as DrawingKind,
    data: objectValue<DrawingData>(row, 'data_json', 'dataJson', 'data'),
    style: objectValue<DrawingStyle>(row, 'style_json', 'styleJson', 'style'),
    createdAt: str(row, 'created_at', 'createdAt') || now,
    updatedAt:
      str(row, 'updated_at', 'updatedAt') ||
      str(row, 'created_at', 'createdAt') ||
      now
  }
}

function deletedAt(value: unknown): string | null {
  const row = asRecord(value)
  const deleted = row['deleted_at'] ?? row['deletedAt']
  return typeof deleted === 'string' ? deleted : null
}

function removalPayload(value: unknown): { boardId: string; ids: string[] } | null {
  const row = asRecord(value)
  const boardId = str(row, 'board_id', 'boardId')
  const rawIds = row['ids']
  const ids = Array.isArray(rawIds)
    ? rawIds.filter((id): id is string => typeof id === 'string')
    : [row['id'] ?? row['shape_id'] ?? row['shapeId']].filter(
        (id): id is string => typeof id === 'string'
      )
  if (boardId === '' || ids.length === 0) return null
  return { boardId, ids }
}

function errorRecord(error: unknown): Record<string, unknown> {
  return asRecord(error)
}

export function isWhiteboardNotProvisioned(
  error: unknown,
  status?: number
): boolean {
  const record = errorRecord(error)
  const code = record['code']
  const errorStatus = record['status'] ?? record['statusCode']
  return (
    code === '42P01' ||
    status === 404 ||
    errorStatus === 404 ||
    errorStatus === '404'
  )
}

function responseOrThrow(response: QueryResponse): unknown {
  if (response.error == null) return response.data
  if (isWhiteboardNotProvisioned(response.error, response.status)) {
    throw new NotProvisionedError('whiteboard tables are not provisioned')
  }
  throw response.error
}

function isDuplicate(error: unknown): boolean {
  return errorRecord(error)['code'] === '23505'
}

function isPermanentUploadError(error: unknown): boolean {
  const record = errorRecord(error)
  return (
    record['code'] === '42501' ||
    record['code'] === '23514' ||
    record['message'] === 'not_a_member' ||
    record['message'] === 'whiteboard_not_found'
  )
}

function uploadRetryMs(error: unknown, attempts: number): number {
  const record = errorRecord(error)
  const hint = Number(record['hint'] ?? '')
  const rateLimitMs =
    record['code'] === 'P0001' && record['message'] === 'rate_limited'
      ? (Number.isFinite(hint) && hint > 0 ? Math.ceil(hint) : 1) * 1_000
      : 0
  return Math.max(backoffMs(attempts), rateLimitMs)
}

function localBoard(groupId: string, createdBy: string): Whiteboard {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    groupId,
    title: DEFAULT_BOARD_TITLE,
    createdBy,
    createdAt: now,
    updatedAt: now
  }
}

export function createWhiteboardService(
  deps: WhiteboardServiceDeps
): WhiteboardService {
  const now = deps.now ?? (() => Date.now())
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms)
      timer.unref?.()
      return timer
    })

  const realtime = new Map<string, RealtimeEntry>()
  const provision = new Map<string, 'ready' | 'not-provisioned'>()
  const nextTryAt = new Map<string, number>()
  let draining: Promise<void> | null = null
  let drainRequested = false
  let wakeTimer: NodeJS.Timeout | null = null
  let disposed = false

  function cacheBoard(groupId: string): Whiteboard {
    const cached = deps.repo.getBoardByGroup(groupId)
    if (cached !== null) return cached
    const board = localBoard(groupId, deps.getUserId() ?? '')
    deps.repo.upsertBoard(board)
    return board
  }

  async function selectBoard(
    client: SupabaseClientLike,
    groupId: string
  ): Promise<Whiteboard | null> {
    const response = (await client
      .from('whiteboards')
      .select('id, group_id, title, created_by, created_at, updated_at')
      .eq('group_id', groupId)
      .maybeSingle()) as QueryResponse
    const data = responseOrThrow(response)
    return data == null ? null : asRemoteBoard(data)
  }

  async function ensureRemoteBoard(
    client: SupabaseClientLike,
    groupId: string,
    cached: Whiteboard
  ): Promise<Whiteboard> {
    const existing = await selectBoard(client, groupId)
    if (existing !== null) {
      if (existing.id === cached.id) deps.repo.upsertBoard(existing)
      else deps.repo.replaceBoard(cached.id, existing)
      provision.set(groupId, 'ready')
      return existing
    }

    const response = (await client
      .from('whiteboards')
      .insert({
        id: cached.id,
        group_id: groupId,
        title: cached.title
      })
      .select('id, group_id, title, created_by, created_at, updated_at')
      .single()) as QueryResponse

    try {
      const created = asRemoteBoard(responseOrThrow(response)) ?? cached
      deps.repo.upsertBoard(created)
      provision.set(groupId, 'ready')
      return created
    } catch (error) {
      // Two members can open a board for the first time simultaneously. The
      // unique group_id race is settled by reading the winner.
      if (isDuplicate(error)) {
        const winner = await selectBoard(client, groupId)
        if (winner !== null) {
          if (winner.id === cached.id) deps.repo.upsertBoard(winner)
          else deps.repo.replaceBoard(cached.id, winner)
          provision.set(groupId, 'ready')
          return winner
        }
      }
      throw error
    }
  }

  function armWake(delayMs: number): void {
    if (disposed || wakeTimer !== null) return
    wakeTimer = schedule(() => {
      wakeTimer = null
      void startDrain()
    }, delayMs)
  }

  function retryDueAt(
    id: string,
    attempts: number
  ): number | undefined {
    const inMemory = nextTryAt.get(id)
    if (inMemory !== undefined) return inMemory
    if (attempts <= 0) return undefined
    const dueAt = now() + backoffMs(attempts - 1)
    nextTryAt.set(id, dueAt)
    return dueAt
  }

  async function uploadShape(
    client: SupabaseClientLike,
    shape: WhiteboardShape
  ): Promise<number | null> {
    const board = deps.repo.getBoardById(shape.boardId)
    if (board === null) {
      deps.repo.markAttempt(shape.id)
      return null
    }
    const attempts = deps.repo.attempts(shape.id)
    try {
      const response = (await client.from('whiteboard_shapes').insert({
        id: shape.id,
        board_id: shape.boardId,
        kind: shape.kind,
        data_json: shape.data,
        style_json: shape.style
      })) as QueryResponse
      if (response.error != null) {
        if (!isDuplicate(response.error)) {
          if (isWhiteboardNotProvisioned(response.error, response.status)) {
            provision.set(board.groupId, 'not-provisioned')
            return null
          }
          throw response.error
        }
        const updateResponse = (await client
          .from('whiteboard_shapes')
          .update({ data_json: shape.data, style_json: shape.style })
          .eq('board_id', shape.boardId)
          .eq('id', shape.id)) as QueryResponse
        if (updateResponse.error != null) throw updateResponse.error
      }
      // A delete may have raced this insert. Keep its tombstone pending so
      // the following drain pass removes the just-created remote row.
      if (!deps.repo.isDeleted(shape.id)) deps.repo.markShapeSynced(shape)
      nextTryAt.delete(shape.id)
      return null
    } catch (error) {
      if (error instanceof NotProvisionedError) {
        provision.set(board.groupId, 'not-provisioned')
        return null
      }
      if (isPermanentUploadError(error)) {
        deps.repo.park(shape.id)
        nextTryAt.delete(shape.id)
        return null
      }
      deps.repo.markAttempt(shape.id)
      if (attempts + 1 >= MAX_WHITEBOARD_UPLOAD_ATTEMPTS) {
        nextTryAt.delete(shape.id)
        return null
      }
      const wait = uploadRetryMs(error, attempts)
      nextTryAt.set(shape.id, now() + wait)
      return wait
    }
  }

  async function uploadUpdate(
    client: SupabaseClientLike,
    shape: WhiteboardShape
  ): Promise<number | null> {
    const board = deps.repo.getBoardById(shape.boardId)
    if (board === null) {
      deps.repo.markAttempt(shape.id)
      return null
    }
    const attempts = deps.repo.attempts(shape.id)
    try {
      const response = (await client
        .from('whiteboard_shapes')
        .update({ data_json: shape.data, style_json: shape.style })
        .eq('board_id', shape.boardId)
        .eq('id', shape.id)) as QueryResponse
      if (response.error != null) {
        if (isWhiteboardNotProvisioned(response.error, response.status)) {
          provision.set(board.groupId, 'not-provisioned')
          return null
        }
        throw response.error
      }
      if (!deps.repo.isDeleted(shape.id)) deps.repo.markShapeSynced(shape)
      nextTryAt.delete(shape.id)
      return null
    } catch (error) {
      if (isPermanentUploadError(error)) {
        deps.repo.park(shape.id)
        nextTryAt.delete(shape.id)
        return null
      }
      deps.repo.markAttempt(shape.id)
      if (attempts + 1 >= MAX_WHITEBOARD_UPLOAD_ATTEMPTS) {
        nextTryAt.delete(shape.id)
        return null
      }
      const wait = uploadRetryMs(error, attempts)
      nextTryAt.set(shape.id, now() + wait)
      return wait
    }
  }

  async function uploadRemoval(
    client: SupabaseClientLike,
    removal: PendingWhiteboardRemoval
  ): Promise<number | null> {
    try {
      // `.select()` so PostgREST reports WHICH rows changed. Without it an
      // update that matched nothing — RLS filtered it out, or the shape was
      // never uploaded — comes back with error: null, and treating that as
      // success marked the tombstone confirmed while the server still held a
      // live row. The next sync then brought the erased shape back.
      const response = (await client
        .from('whiteboard_shapes')
        .update({ deleted_at: removal.deletedAt })
        .eq('board_id', removal.boardId)
        .eq('id', removal.id)
        .select('id')) as QueryResponse
      if (response.error != null) {
        if (isWhiteboardNotProvisioned(response.error, response.status)) {
          provision.set(removal.groupId, 'not-provisioned')
          return null
        }
        throw response.error
      }
      const affected = Array.isArray(response.data) ? response.data.length : 0
      if (affected === 0) {
        // Nothing to delete server-side: either it never got there, or this
        // shape belongs to someone else and RLS refused. Retrying cannot help
        // in either case, and the local tombstone stands regardless — the
        // shape stays gone for this student.
        deps.repo.park(removal.id)
        nextTryAt.delete(removal.id)
        return null
      }
      deps.repo.markSynced(removal.id)
      nextTryAt.delete(removal.id)
      return null
    } catch (error) {
      if (isPermanentUploadError(error)) {
        deps.repo.park(removal.id)
        nextTryAt.delete(removal.id)
        return null
      }
      deps.repo.markAttempt(removal.id)
      if (removal.attempts + 1 >= MAX_WHITEBOARD_UPLOAD_ATTEMPTS) {
        nextTryAt.delete(removal.id)
        return null
      }
      const wait = uploadRetryMs(error, removal.attempts)
      nextTryAt.set(removal.id, now() + wait)
      return wait
    }
  }

  async function drainPass(): Promise<void> {
    const client = deps.getClient()
    if (disposed || client === null || deps.getUserId() === null) return

    for (const shape of deps.repo.pending(OUTBOX_BATCH_SIZE)) {
      const dueAt = retryDueAt(shape.id, deps.repo.attempts(shape.id))
      if (dueAt !== undefined && dueAt > now()) {
        armWake(dueAt - now())
        return
      }
      const board = deps.repo.getBoardById(shape.boardId)
      if (board !== null && provision.get(board.groupId) === 'not-provisioned') {
        return
      }
      const wait = shape.updatedAt === shape.createdAt
        ? await uploadShape(client, shape)
        : await uploadUpdate(client, shape)
      if (wait !== null) {
        armWake(wait)
        return
      }
      if (board !== null && provision.get(board.groupId) === 'not-provisioned') {
        return
      }
    }

    for (const removal of deps.repo.pendingRemovals(OUTBOX_BATCH_SIZE)) {
      const dueAt = retryDueAt(removal.id, removal.attempts)
      if (dueAt !== undefined && dueAt > now()) {
        armWake(dueAt - now())
        return
      }
      if (provision.get(removal.groupId) === 'not-provisioned') return
      const wait = await uploadRemoval(client, removal)
      if (wait !== null) {
        armWake(wait)
        return
      }
      if (provision.get(removal.groupId) === 'not-provisioned') return
    }
  }

  function startDrain(): Promise<void> {
    if (draining !== null) {
      drainRequested = true
      return draining
    }
    draining = (async () => {
      do {
        drainRequested = false
        await drainPass()
      } while (drainRequested && !disposed)
    })().finally(() => {
      draining = null
      // Covers a wake arriving after the loop condition but before finally.
      if (drainRequested && !disposed) void startDrain()
    })
    return draining
  }

  async function fetchSync(
    boardId: string,
    since: string | null
  ): Promise<WhiteboardSyncResult> {
    const startedAt = new Date(now()).toISOString()
    const empty = { shapes: [], removedIds: [], syncedAt: since ?? startedAt }
    const client = deps.getClient()
    const board = deps.repo.getBoardById(boardId)
    if (client === null || deps.getUserId() === null || board === null) return empty
    if (provision.get(board.groupId) === 'not-provisioned') return empty

    try {
      const query = client
        .from('whiteboard_shapes')
        .select(
          'id, board_id, author_id, kind, data_json, style_json, created_at, updated_at, deleted_at'
        )
        .eq('board_id', boardId)
      const response = (await query.order('created_at', {
        ascending: true
      })) as QueryResponse
      const data = responseOrThrow(response)
      const remoteShapes: WhiteboardShape[] = []
      if (Array.isArray(data)) {
        for (const raw of data) {
          const shape = asRemoteShape(raw)
          if (shape === null) continue
          if (deletedAt(raw) === null) remoteShapes.push(shape)
        }
      }
      // RLS intentionally hides soft-deleted rows. Compare the complete live
      // snapshot with confirmed local ids to recover removals missed while the
      // realtime channel was disconnected; pending local rows are excluded.
      const confirmedBefore = new Set(deps.repo.confirmedShapeIds(boardId))
      const remoteIds = new Set(remoteShapes.map((shape) => shape.id))
      const removedIds = [...confirmedBefore].filter((id) => !remoteIds.has(id))
      deps.repo.applyRemote(remoteShapes)
      deps.repo.applyRemoteRemovals(removedIds)
      deps.repo.markBoardSynced(boardId, startedAt)

      // Answer from the repo, not from the snapshot we just fetched. The repo
      // holds local tombstones for erases the server has not accepted (or has
      // refused), so the snapshot still lists those shapes as live. Returning
      // it verbatim put them straight back on screen: the renderer merges
      // additively and its own "removed" set is per-mount, so every reopen
      // resurrected everything the student had erased.
      const live = deps.repo.listShapes(boardId)
      const liveIds = new Set(live.map((shape) => shape.id))
      const shapes =
        since === null
          ? live
          : live.filter(
              (shape) =>
                !confirmedBefore.has(shape.id) || shape.updatedAt > since
            )
      const goneIds = [
        ...new Set([
          ...removedIds,
          // Erased here but still live for everyone else — the renderer must
          // be told, or a merge would re-add them.
          ...remoteShapes
            .map((shape) => shape.id)
            .filter((id) => !liveIds.has(id))
        ])
      ]
      provision.set(board.groupId, 'ready')
      return { shapes, removedIds: goneIds, syncedAt: startedAt }
    } catch (error) {
      if (
        error instanceof NotProvisionedError ||
        isWhiteboardNotProvisioned(error)
      ) {
        provision.set(board.groupId, 'not-provisioned')
      }
      // Sync is a convergence aid. Offline or an unprovisioned schema must
      // never make cached ink disappear or turn opening the tab into an error.
      return empty
    }
  }

  async function reconcile(groupId: string, boardId: string): Promise<void> {
    const client = deps.getClient()
    const userId = deps.getUserId()
    if (client === null || userId === null || disposed) return
    let board = deps.repo.getBoardById(boardId) ?? cacheBoard(groupId)
    try {
      board = await ensureRemoteBoard(client, groupId, board)
    } catch (error) {
      if (
        error instanceof NotProvisionedError ||
        isWhiteboardNotProvisioned(error)
      ) {
        provision.set(groupId, 'not-provisioned')
      }
      return
    }
    // Required reconnect order: commit local strokes before fetching remote
    // changes, so our own echoes cannot appear to arrive late.
    await startDrain()
    const result = await fetchSync(
      board.id,
      deps.repo.getBoardSyncedAt(board.id)
    )
    if (result.shapes.length > 0 || result.removedIds.length > 0) {
      deps.emit(groupId, { type: 'sync', boardId: board.id, ...result })
    }
  }

  function tearDownRealtime(groupId: string): void {
    const entry = realtime.get(groupId)
    if (entry === undefined) return
    realtime.delete(groupId)
    try {
      void entry.channel.unsubscribe()
      void entry.client.removeChannel(entry.channel)
    } catch {
      // Disposal is best-effort and must stay idempotent.
    }
  }

  function ensureRealtime(groupId: string, boardId: string): void {
    const client = deps.getClient()
    if (client === null || disposed) return
    const current = realtime.get(groupId)
    if (current !== undefined) {
      if (current.client === client) {
        current.boardId = boardId
        return
      }
      tearDownRealtime(groupId)
    }

    const channel = client.channel(`group:${groupId}`, {
      config: { private: true }
    })
    const entry: RealtimeEntry = { groupId, boardId, client, channel }
    realtime.set(groupId, entry)

    channel
      .on('broadcast', { event: 'wb_shape' }, ({ payload }) => {
        const shape = asRemoteShape(payload)
        if (shape === null || shape.boardId !== entry.boardId) return
        deps.repo.applyRemote([shape])
        deps.emit(groupId, { type: 'shape', shape })
      })
      .on('broadcast', { event: 'wb_remove' }, ({ payload }) => {
        const removal = removalPayload(payload)
        if (removal === null || removal.boardId !== entry.boardId) return
        deps.repo.applyRemoteRemovals(removal.ids)
        deps.emit(groupId, {
          type: 'remove',
          boardId: removal.boardId,
          ids: removal.ids
        })
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // This also runs after a socket reconnect, providing the required
          // catch-up for broadcasts missed while disconnected.
          void reconcile(groupId, entry.boardId).catch(() => {
            // Reconnects and explicit syncs provide another convergence pass.
          })
        }
      })
  }

  return {
    async open(groupId) {
      let board = cacheBoard(groupId)
      const cachedResult = (): OpenWhiteboardResult => ({
        availability: { state: 'ready' },
        board,
        shapes: deps.repo.listShapes(board.id)
      })
      const client = deps.getClient()
      if (client === null) {
        return { ...cachedResult(), availability: { state: 'unconfigured' } }
      }
      const userId = deps.getUserId()
      if (userId === null) {
        return { ...cachedResult(), availability: { state: 'signed-out' } }
      }

      try {
        board = await ensureRemoteBoard(client, groupId, board)
        ensureRealtime(groupId, board.id)
        void startDrain()
          .then(() => fetchSync(board.id, deps.repo.getBoardSyncedAt(board.id)))
          .then((result) => {
            if (result.shapes.length > 0 || result.removedIds.length > 0) {
              deps.emit(groupId, { type: 'sync', boardId: board.id, ...result })
            }
          })
          .catch(() => {
            // The cache result already returned; background reconciliation is
            // retried on subscribe/open/sync.
          })
        return cachedResult()
      } catch (error) {
        if (
          error instanceof NotProvisionedError ||
          isWhiteboardNotProvisioned(error)
        ) {
          provision.set(groupId, 'not-provisioned')
          return {
            ...cachedResult(),
            availability: { state: 'not-provisioned' }
          }
        }
        // Network failure: keep the fully usable local mirror on screen. A
        // later open or realtime subscribe will retry provisioning and drain.
        ensureRealtime(groupId, board.id)
        return cachedResult()
      }
    },

    async addShape(input) {
      const board = deps.repo.getBoardById(input.boardId)
      if (board === null) throw new NotFoundError('whiteboard', input.boardId)
      const shape = deps.repo.insertLocal(
        input,
        deps.getUserId() ?? 'local',
        board.groupId
      )
      // SQLite is committed before any remote work begins. The returned
      // promise therefore resolves independently of upload success.
      void startDrain()
      return shape
    },

    async updateShape(input) {
      const board = deps.repo.getBoardById(input.boardId)
      if (board === null) throw new NotFoundError('whiteboard', input.boardId)
      const current = deps.repo.listShapes(input.boardId).find(
        (shape) => shape.id === input.id
      )
      const userId = deps.getUserId() ?? 'local'
      if (current === undefined || current.authorId !== userId) {
        throw new NotFoundError('whiteboard shape', input.id)
      }
      const shape = deps.repo.updateShape(input)
      if (shape === null) throw new NotFoundError('whiteboard shape', input.id)
      void startDrain()
      return shape
    },

    async removeShapes(input) {
      const board = deps.repo.getBoardById(input.boardId)
      if (board === null) throw new NotFoundError('whiteboard', input.boardId)
      const liveIds = new Set(
        deps.repo.listShapes(input.boardId).map((shape) => shape.id)
      )
      deps.repo.softDelete(input.ids.filter((id) => liveIds.has(id)))
      void startDrain()
      return { ok: true }
    },

    async sync(boardId, since) {
      await startDrain()
      return fetchSync(boardId, since)
    },

    close(groupId) {
      tearDownRealtime(groupId)
      return { ok: true }
    },

    dispose() {
      disposed = true
      if (wakeTimer !== null) {
        clearTimeout(wakeTimer)
        wakeTimer = null
      }
      for (const groupId of [...realtime.keys()]) tearDownRealtime(groupId)
    }
  }
}
