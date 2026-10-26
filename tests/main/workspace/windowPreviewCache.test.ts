import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createWindowPreviewCache, windowPreviewCacheKey } from '../../../src/main/features/workspace/windowPreviewCache'

const roots: string[] = []
const image = (value: string) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(value)]).toString('base64')}`
const key = { workspaceKey: 'course:/../private name', windowId: 'window-1' }
const directory = async () => { const path = await mkdtemp(join(tmpdir(), 'bandal-previews-')); roots.push(path); return path }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

test('persists only the latest thumbnail atomically and restores in the same profile', async () => {
  const root = await directory(), cache = createWindowPreviewCache(root)
  await Promise.all([cache.save(key, image('first')), cache.save(key, image('latest'))])
  expect(await createWindowPreviewCache(root).read(key)).toBe(image('latest'))
  const files = await readdir(join(root, 'workspace-previews'))
  expect(files).toEqual([`${windowPreviewCacheKey(key)}.jpg`])
  expect(files[0]).not.toContain('private')
  if (process.platform !== 'win32') expect((await stat(join(root, 'workspace-previews', files[0]!))).mode & 0o777).toBe(0o600)
})

test('cache identity includes workspace and window and never crosses profile roots', async () => {
  const root = await directory(), other = await directory(), cache = createWindowPreviewCache(root)
  await cache.save(key, image('original'))
  expect(await cache.read({ ...key, windowId: 'window-2' })).toBeNull()
  expect(await cache.read({ ...key, workspaceKey: 'other-course' })).toBeNull()
  expect(await createWindowPreviewCache(other).read(key)).toBeNull()
})

test('deleting after an in-flight write removes its result', async () => {
  const root = await directory(), cache = createWindowPreviewCache(root)
  const save = cache.save(key, image('last'))
  await cache.remove(key)
  await save
  expect(await cache.read(key)).toBeNull()
  expect(await readdir(join(root, 'workspace-previews'))).toEqual([])
})

test('invalid keys and malformed images cannot create cache files', async () => {
  const cache = createWindowPreviewCache(await directory())
  expect(() => cache.save({ ...key, windowId: '' }, image('bad'))).toThrow()
  expect(() => cache.save(key, 'data:text/html;base64,AA==')).toThrow()
  expect(() => cache.save(key, 'data:image/jpeg;base64,AAAA')).toThrow()
  expect(() => cache.save(key, image('x'.repeat(750_000)))).toThrow()
})
