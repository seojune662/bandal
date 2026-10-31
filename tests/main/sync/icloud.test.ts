import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createICloudProvider, icloudRoot } from '../../../src/main/features/sync/icloud'

const LOG = 'log/aaaaaaaa-0000-4000-8000-000000000001'
let home: string, root: string, tmpDir: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bandal-icloud-'))
  root = icloudRoot(home)
  tmpDir = join(home, 'Bandal', 'sync', 'tmp')
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const provider = () => createICloudProvider({ root, tmpDir })
const ready = () => {
  mkdirSync(join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), { recursive: true })
  mkdirSync(root, { recursive: true })
}

test('status follows iCloud Drive and the container the iPad app makes', async () => {
  expect(await provider().status()).toBe('unavailable')
  mkdirSync(join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), { recursive: true })
  expect(await provider().status()).toBe('needs-ipad')
  mkdirSync(root, { recursive: true })
  expect(await provider().status()).toBe('ready')
})

test('a write lands whole through a temporary file outside the root, and only at sync paths', async () => {
  ready()
  await provider().write(`${LOG}/00000001.json`, Buffer.from('[]'))
  expect(readFileSync(join(root, LOG, '00000001.json'), 'utf8')).toBe('[]')
  expect(readdirSync(tmpDir)).toEqual([])
  await expect(provider().write('../escape.json', Buffer.from('x'))).rejects.toThrow('is not a sync path')
  await expect(provider().write('notes.txt', Buffer.from('x'))).rejects.toThrow('is not a sync path')
})

test('the listing holds sync files and placeholders of them, with versions that change with the bytes', async () => {
  ready()
  mkdirSync(join(root, LOG), { recursive: true })
  writeFileSync(join(root, 'bandal.json'), '{"format":2}')
  writeFileSync(join(root, LOG, '00000001.json'), '[]')
  writeFileSync(join(root, LOG, '.00000002.json.icloud'), 'placeholder')
  writeFileSync(join(root, '.DS_Store'), 'x')
  writeFileSync(join(root, 'notes.txt'), 'x')
  const first = await provider().list()
  expect(first.entries.map(entry => entry.path).sort()).toEqual(['bandal.json', `${LOG}/.00000002.json.icloud`, `${LOG}/00000001.json`])
  expect(Buffer.from(await first.read('bandal.json')).toString('utf8')).toBe('{"format":2}')
  const version = (listing: typeof first) => listing.entries.find(entry => entry.path === `${LOG}/00000001.json`)!.version
  writeFileSync(join(root, LOG, '00000001.json'), '[{"t":1}]')
  expect(version(await provider().list())).not.toBe(version(first))
})

test('a change under the root reaches the watcher', async () => {
  ready()
  const seen = new Promise<void>(resolve => {
    const stop = provider().watch(() => {
      stop()
      resolve()
    })
  })
  await provider().write('bandal.json', Buffer.from('{"format":2}'))
  await seen
})

test('a write never makes the container again once it is gone', async () => {
  ready()
  rmSync(root, { recursive: true })
  await expect(provider().write('bandal.json', Buffer.from('{"format":2}'))).rejects.toThrow('gone')
  expect(existsSync(root)).toBe(false)
})
