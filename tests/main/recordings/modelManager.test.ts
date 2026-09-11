import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModelManager } from '../../../src/main/features/recordings/modelManager'

vi.mock('../../../src/main/features/recordings/modelCatalog', () => {
  const model = {
    id: 'zipformer-ko',
    name: 'fixture',
    description: '',
    repo: 'fixture',
    revision: 'pinned',
    files: [
      { name: 'model.onnx', bytes: 4, sha256: createHash('sha256').update('test').digest('hex') }
    ]
  }
  return { SPEECH_MODELS: [model], speechModel: () => model }
})
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bandal-model-test-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})
it('installs only verified bytes and detects modification before loading native code', async () => {
  const fetcher = vi.fn(async () => new Response('test'))
  vi.stubGlobal('fetch', fetcher)
  const manager = createModelManager(dir, () => undefined)
  await manager.download('zipformer-ko')
  expect(manager.list()[0]?.status).toBe('installed')
  const path = await manager.verify('zipformer-ko')
  expect(readFileSync(join(path, 'model.onnx'), 'utf8')).toBe('test')
  await manager.download('zipformer-ko')
  expect(fetcher).toHaveBeenCalledTimes(1)
  writeFileSync(join(path, 'model.onnx'), 'evil')
  await expect(manager.verify('zipformer-ko')).rejects.toThrow('손상')
  expect(manager.list()[0]?.status).toBe('error')
})
it('does not expose a corrupt or oversized download as installed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('bad!'))
  )
  const manager = createModelManager(dir, () => undefined)
  await manager.download('zipformer-ko')
  expect(manager.list()[0]?.status).toBe('error')
  await expect(manager.verify('zipformer-ko')).rejects.toThrow('다운로드')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('too much data'))
  )
  await manager.download('zipformer-ko')
  expect(manager.list()[0]?.status).toBe('error')
})
it('cancels an in-flight download, removes uncommitted bytes and can retry', async () => {
  const fetcher = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal!.addEventListener('abort', () =>
          reject(new DOMException('cancelled', 'AbortError'))
        )
      })
  )
  vi.stubGlobal('fetch', fetcher)
  const manager = createModelManager(dir, () => undefined)
  const pending = manager.download('zipformer-ko')
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  writeFileSync(join(dir, 'zipformer-ko', 'model.onnx.part'), 'te')
  manager.cancel('zipformer-ko')
  await pending
  expect(manager.list()[0]?.status).toBe('available')
  expect(existsSync(join(dir, 'zipformer-ko', 'model.onnx.part'))).toBe(false)
  expect(existsSync(join(dir, 'zipformer-ko', 'ready.json'))).toBe(false)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('test'))
  )
  await manager.download('zipformer-ko')
  expect(manager.list()[0]?.status).toBe('installed')
})
