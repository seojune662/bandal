import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  PutWhiteboardAssetInput,
  ReadWhiteboardAssetInput,
  ReadWhiteboardAssetResult,
  WhiteboardAssetSource
} from '../../../shared/types/whiteboard'
import { NotFoundError, ValidationError } from '../../db/errors'
import { writeFileAtomic } from '../../lib/atomicWrite'
import type { WhiteboardRepo } from './whiteboardRepo'

const BUCKET = 'whiteboard-assets'
const MAX_ASSET_BYTES = 8 * 1024 * 1024
const MAX_BASE64_LENGTH = Math.ceil(MAX_ASSET_BYTES / 3) * 4
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

interface AssetRow {
  id: string
  board_id: string
  group_id: string
  author_id: string
  label: string
  mime_type: string
  width_px: number
  height_px: number
  remote_path: string
  pending: number
  attempts: number
}

export interface WhiteboardAssetService {
  put(input: PutWhiteboardAssetInput): Promise<WhiteboardAssetSource>
  read(input: ReadWhiteboardAssetInput): Promise<ReadWhiteboardAssetResult>
  flush(): Promise<void>
  isSynced(assetId: string): boolean
  resetForAuthChange(): void
  dispose(): void
}

interface WhiteboardAssetServiceDeps {
  db: Database
  repo: Pick<WhiteboardRepo, 'getBoardById'>
  userDataPath: string
  getClient: () => SupabaseClient | null
  getUserId: () => string | null
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new ValidationError(`${field} must be a UUID`)
  return value
}

function localPath(root: string, boardId: string, assetId: string): string {
  return join(root, boardId, `${assetId}.webp`)
}

function isWebP(bytes: Buffer): boolean {
  return bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
}

function decodeWebP(base64: unknown): Buffer {
  if (
    typeof base64 !== 'string' ||
    base64.length === 0 ||
    base64.length > MAX_BASE64_LENGTH ||
    base64.length % 4 !== 0 ||
    !BASE64.test(base64)
  ) {
    throw new ValidationError('Invalid whiteboard image encoding')
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES || !isWebP(bytes)) {
    throw new ValidationError('Optimized whiteboard images must be valid WebP files up to 8MB')
  }
  return bytes
}

function asSource(row: AssetRow): WhiteboardAssetSource {
  return {
    relPath: `.bandal/shared-assets/${row.id}.webp`,
    label: row.label,
    storage: 'shared',
    assetId: row.id,
    widthPx: row.width_px,
    heightPx: row.height_px
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500)
  try {
    return JSON.stringify(error).slice(0, 500)
  } catch {
    return 'upload failed'
  }
}

export function createWhiteboardAssetService(
  deps: WhiteboardAssetServiceDeps
): WhiteboardAssetService {
  const root = join(deps.userDataPath, 'whiteboard-assets')
  let disposed = false
  let draining: Promise<void> | null = null
  let retryTimer: NodeJS.Timeout | null = null

  function row(assetId: string): AssetRow | undefined {
    return deps.db
      .prepare('SELECT * FROM whiteboard_assets_cache WHERE id = ?')
      .get(assetId) as AssetRow | undefined
  }

  function armRetry(attempts: number): void {
    if (disposed || retryTimer !== null) return
    const delay = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts))
    retryTimer = setTimeout(() => {
      retryTimer = null
      void flush()
    }, delay)
    retryTimer.unref?.()
  }

  async function upload(candidate: AssetRow): Promise<boolean> {
    const client = deps.getClient()
    const userId = deps.getUserId()
    if (client === null || userId === null) {
      armRetry(candidate.attempts)
      return false
    }
    try {
      const bytes = readFileSync(localPath(root, candidate.board_id, candidate.id))
      const stored = await client.storage.from(BUCKET).upload(
        candidate.remote_path,
        bytes,
        { contentType: candidate.mime_type, upsert: true, cacheControl: '31536000' }
      )
      if (stored.error !== null) throw stored.error
      const metadata = await client.from('whiteboard_assets').upsert({
        id: candidate.id,
        board_id: candidate.board_id,
        group_id: candidate.group_id,
        author_id: userId,
        storage_path: candidate.remote_path,
        label: candidate.label,
        mime_type: candidate.mime_type,
        width_px: candidate.width_px,
        height_px: candidate.height_px
      }, { onConflict: 'id' })
      if (metadata.error !== null) throw metadata.error
      deps.db.prepare(
        `UPDATE whiteboard_assets_cache
            SET pending = 0, attempts = 0, author_id = ?, last_error = NULL, updated_at = ?
          WHERE id = ?`
      ).run(userId, new Date().toISOString(), candidate.id)
      return true
    } catch (error) {
      deps.db.prepare(
        `UPDATE whiteboard_assets_cache
            SET attempts = attempts + 1, last_error = ?, updated_at = ?
          WHERE id = ?`
      ).run(errorText(error), new Date().toISOString(), candidate.id)
      armRetry(candidate.attempts + 1)
      return false
    }
  }

  async function flush(): Promise<void> {
    if (disposed) return
    if (draining !== null) return draining
    draining = (async () => {
      const pending = deps.db.prepare(
        `SELECT * FROM whiteboard_assets_cache
          WHERE pending = 1
          ORDER BY created_at ASC LIMIT 20`
      ).all() as AssetRow[]
      for (const candidate of pending) {
        const uploaded = await upload(candidate)
        if (!uploaded) break
      }
    })().finally(() => {
      draining = null
    })
    return draining
  }

  return {
    async put(input) {
      const boardId = requireUuid(input.boardId, 'boardId')
      const assetId = requireUuid(input.assetId, 'assetId')
      const board = deps.repo.getBoardById(boardId)
      if (board === null) throw new NotFoundError('whiteboard', boardId)
      if (input.mimeType !== 'image/webp') {
        throw new ValidationError('Only optimized WebP images are accepted')
      }
      if (
        !Number.isInteger(input.widthPx) || input.widthPx <= 0 || input.widthPx > 4096 ||
        !Number.isInteger(input.heightPx) || input.heightPx <= 0 || input.heightPx > 4096
      ) {
        throw new ValidationError('Invalid image dimensions')
      }
      const bytes = decodeWebP(input.base64)
      const directory = join(root, boardId)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      writeFileAtomic(localPath(root, boardId, assetId), bytes, { mode: 0o600 })
      const now = new Date().toISOString()
      const authorId = deps.getUserId() ?? 'local'
      const remotePath = `${board.groupId}/${boardId}/${assetId}.webp`
      const label = typeof input.label === 'string'
        ? input.label.trim().slice(0, 240) || '사진'
        : '사진'
      deps.db.prepare(
        `INSERT INTO whiteboard_assets_cache
           (id, board_id, group_id, author_id, label, mime_type, width_px,
            height_px, remote_path, pending, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           width_px = excluded.width_px,
           height_px = excluded.height_px,
           pending = 1,
           attempts = 0,
           last_error = NULL,
           updated_at = excluded.updated_at`
      ).run(
        assetId,
        boardId,
        board.groupId,
        authorId,
        label,
        input.mimeType,
        input.widthPx,
        input.heightPx,
        remotePath,
        now,
        now
      )
      await flush()
      const saved = row(assetId)
      if (saved === undefined) throw new NotFoundError('whiteboard asset', assetId)
      return asSource(saved)
    },

    async read(input) {
      const boardId = requireUuid(input.boardId, 'boardId')
      const assetId = requireUuid(input.assetId, 'assetId')
      const board = deps.repo.getBoardById(boardId)
      if (board === null) throw new NotFoundError('whiteboard', boardId)
      const path = localPath(root, boardId, assetId)
      try {
        return { encoding: 'base64', data: readFileSync(path).toString('base64') }
      } catch {
        const client = deps.getClient()
        if (client === null || deps.getUserId() === null) {
          throw new NotFoundError('whiteboard asset', assetId)
        }
        const remotePath = `${board.groupId}/${boardId}/${assetId}.webp`
        const downloaded = await client.storage.from(BUCKET).download(remotePath)
        if (downloaded.error !== null || downloaded.data === null) {
          throw downloaded.error ?? new NotFoundError('whiteboard asset', assetId)
        }
        const bytes = Buffer.from(await downloaded.data.arrayBuffer())
        if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES || !isWebP(bytes)) {
          throw new ValidationError('Downloaded whiteboard image is invalid')
        }
        mkdirSync(join(root, boardId), { recursive: true, mode: 0o700 })
        writeFileAtomic(path, bytes, { mode: 0o600 })
        return { encoding: 'base64', data: bytes.toString('base64') }
      }
    },

    flush,
    isSynced(assetId) {
      return row(assetId)?.pending === 0
    },
    resetForAuthChange() {
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      if (deps.getUserId() !== null) void flush()
    },
    dispose() {
      disposed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
    }
  }
}
