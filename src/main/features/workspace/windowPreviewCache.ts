import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkspacePreviewKey } from '../../../shared/ipc/workspacePreviewContract'

const MAX_BYTES = 750_000
const PREFIX = 'data:image/jpeg;base64,'

/** Hash both identifiers so course names and any filesystem separators stay out of paths. */
export function windowPreviewCacheKey(key: WorkspacePreviewKey): string {
  if (!key || [key.workspaceKey, key.windowId].some(value => typeof value !== 'string' || !value || value.length > 1000)) throw new Error('Invalid workspace preview key')
  return createHash('sha256').update(JSON.stringify([key.workspaceKey, key.windowId])).digest('hex')
}

export function previewImageBytes(imageDataUrl: string): Buffer {
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith(PREFIX) || imageDataUrl.length > MAX_BYTES * 4 / 3 + PREFIX.length) throw new Error('Invalid workspace preview image')
  const encoded = imageDataUrl.slice(PREFIX.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid workspace preview image')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('Invalid workspace preview image')
  return bytes
}

/** userData already points at the active app profile. Writes and deletion serialize per window. */
export function createWindowPreviewCache(userData: string) {
  const directory = join(userData, 'workspace-previews')
  const pending = new Map<string, Promise<unknown>>()
  const serial = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const promise = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation)
    pending.set(key, promise)
    void promise.finally(() => { if (pending.get(key) === promise) pending.delete(key) }).catch(() => undefined)
    return promise
  }
  return {
    async read(key: WorkspacePreviewKey): Promise<string | null> {
      const hash = windowPreviewCacheKey(key), file = join(directory, `${hash}.jpg`)
      await pending.get(hash)?.catch(() => undefined)
      try {
        if ((await stat(file)).size > MAX_BYTES) return null
        const data = await readFile(file)
        if (data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return null
        return `${PREFIX}${data.toString('base64')}`
      } catch { return null }
    },
    save(key: WorkspacePreviewKey, imageDataUrl: string): Promise<void> {
      const hash = windowPreviewCacheKey(key), bytes = previewImageBytes(imageDataUrl)
      return serial(hash, async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const temporary = join(directory, `${hash}.${randomUUID()}.tmp`)
        try {
          await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' })
          await rename(temporary, join(directory, `${hash}.jpg`))
        } finally { await rm(temporary, { force: true }).catch(() => undefined) }
      })
    },
    remove(key: WorkspacePreviewKey): Promise<void> {
      const hash = windowPreviewCacheKey(key)
      return serial(hash, () => rm(join(directory, `${hash}.jpg`), { force: true }))
    }
  }
}
