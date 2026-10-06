import { EventEmitter } from 'node:events'
import { afterEach, expect, test, vi } from 'vitest'
const mock = vi.hoisted(() => ({ check: vi.fn(), download: vi.fn(), install: vi.fn() }))
const updater = Object.assign(new EventEmitter(), { checkForUpdates: mock.check, downloadUpdate: mock.download, quitAndInstall: mock.install })
vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-updater', () => ({ default: { get autoUpdater() { return updater } } }))
vi.mock('../../../src/main/features/agent', () => ({ killAllClaudeProcessesSync: vi.fn() }))
const { createUpdaterRuntime } = await import('../../../src/main/features/updater')

afterEach(() => { updater.removeAllListeners(); vi.clearAllMocks() })

test('reserves an update download before progress and surfaces a network interruption for retry', async () => {
  const runtime = createUpdaterRuntime({ currentVersion: '1.0.0', broadcast: vi.fn() })
  let finish!: () => void
  mock.download.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
  try {
    updater.emit('update-available', { version: '1.1.0' })
    const downloading = runtime.download()
    expect(runtime.status()).toMatchObject({ phase: 'downloading', percent: 0, version: '1.1.0' })
    await runtime.download()
    await runtime.check()
    expect(mock.download).toHaveBeenCalledOnce()
    expect(mock.check).not.toHaveBeenCalled()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(runtime.status().phase).toBe('error')
    error.mockRestore()
    finish()
    await downloading
    mock.download.mockResolvedValue([])
    await runtime.download()
    expect(mock.download).toHaveBeenCalledTimes(2)
  } finally { runtime.dispose() }
})

test('deduplicates checks and detaches only its own event listeners on disposal', async () => {
  const observer = vi.fn()
  updater.on('update-available', observer)
  const broadcast = vi.fn()
  const runtime = createUpdaterRuntime({ currentVersion: '1.0.0', broadcast })
  let finish!: () => void
  mock.check.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
  const checking = runtime.check()
  await runtime.check()
  expect(mock.check).toHaveBeenCalledOnce()
  runtime.dispose()
  const before = broadcast.mock.calls.length
  updater.emit('update-available', { version: '1.1.0' })
  expect(observer).toHaveBeenCalledOnce()
  expect(broadcast).toHaveBeenCalledTimes(before)
  finish()
  await checking
})
