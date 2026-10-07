import { EventEmitter } from 'node:events'
import { afterEach, expect, test, vi } from 'vitest'
const mock = vi.hoisted(() => ({ check: vi.fn(), download: vi.fn(), install: vi.fn() }))
const updater = Object.assign(new EventEmitter(), { checkForUpdates: mock.check, downloadUpdate: mock.download, quitAndInstall: mock.install })
vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-updater', () => ({ default: { get autoUpdater() { return updater } } }))
vi.mock('../../../src/main/features/agent', () => ({ killAllClaudeProcessesSync: vi.fn() }))
const { createUpdaterRuntime } = await import('../../../src/main/features/updater')

afterEach(() => { updater.removeAllListeners(); delete (updater as any).quitAndInstallCalled; vi.clearAllMocks(); mock.install.mockReset() })

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


test('only an active install cancellation broadcasts recovery, clears the Windows guard, and allows exactly one explicit retry', () => {
  const broadcast = vi.fn(), applied = vi.fn()
  Object.defineProperty(updater, 'quitAndInstallCalled', { value: false, writable: true, configurable: true })
  mock.install.mockImplementation(() => {
    if ((updater as any).quitAndInstallCalled) return
    ;(updater as any).quitAndInstallCalled = true
    applied()
  })
  const runtime = createUpdaterRuntime({ currentVersion: '1.0.0', platform: 'win32', broadcast })
  try {
    updater.emit('update-downloaded', { version: '1.1.0' })
    const before = broadcast.mock.calls.length
    runtime.cancelInstall()
    expect(broadcast).toHaveBeenCalledTimes(before)
    expect(runtime.install()).toBe(true)
    expect(runtime.install()).toBe(false)
    expect(applied).toHaveBeenCalledOnce()
    runtime.cancelInstall()
    expect(runtime.status()).toEqual({ phase: 'ready', currentVersion: '1.0.0', version: '1.1.0', restartCancelled: true })
    expect((updater as any).quitAndInstallCalled).toBe(false)
    expect(broadcast).toHaveBeenCalledTimes(before + 1)
    runtime.cancelInstall(); expect(broadcast).toHaveBeenCalledTimes(before + 1)
    expect(runtime.install()).toBe(true)
    expect(runtime.install()).toBe(false)
    expect(applied).toHaveBeenCalledTimes(2)
    expect(runtime.status()).toEqual({ phase: 'ready', currentVersion: '1.0.0', version: '1.1.0' })
  } finally { runtime.dispose() }
})

test.each(['darwin', 'missing', 'readonly', 'other-type'] as const)('cancel recovery does not mutate an incompatible %s installer field', scenario => {
  if (scenario !== 'missing') Object.defineProperty(updater, 'quitAndInstallCalled', { value: scenario === 'other-type' ? 1 : true, writable: scenario !== 'readonly', configurable: true })
  const value = (updater as any).quitAndInstallCalled
  const runtime = createUpdaterRuntime({ currentVersion: '1.0.0', platform: scenario === 'darwin' ? 'darwin' : 'win32', broadcast: vi.fn() })
  try {
    updater.emit('update-downloaded', { version: '1.1.0' }); runtime.install(); runtime.cancelInstall()
    expect((updater as any).quitAndInstallCalled).toBe(value)
    expect(runtime.status()).toMatchObject({ phase: 'ready', restartCancelled: true })
  } finally { runtime.dispose() }
})

test('an updater error clears the active install so ordinary browser quit cancellation does not rebroadcast', () => {
  const broadcast = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const runtime = createUpdaterRuntime({ currentVersion: '1.0.0', broadcast })
  try {
    updater.emit('update-downloaded', { version: '1.1.0' }); expect(runtime.install()).toBe(true)
    updater.emit('error', new Error('update install failed'))
    const before = broadcast.mock.calls.length
    runtime.cancelInstall(); expect(broadcast).toHaveBeenCalledTimes(before)
    updater.emit('update-downloaded', { version: '1.1.0' }); expect(runtime.install()).toBe(true)
    expect(mock.install).toHaveBeenCalledTimes(2)
  } finally { runtime.dispose(); error.mockRestore() }
})
