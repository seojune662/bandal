import { beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'
import { ensureSettingsLoaded, resetSettingsSnapshotForTests } from '../../../src/renderer/src/stores/settingsSnapshot'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), push: undefined as ((event: unknown) => void) | undefined }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: mocks.invoke,
  onPush: (_event: string, handler: (event: unknown) => void) => { mocks.push = handler; return () => {} }
}))
beforeEach(() => { vi.clearAllMocks(); resetSettingsSnapshotForTests() })

test('a fresh settings push recovers an older initial read failure', async () => {
  let reject!: (reason: Error) => void
  mocks.invoke.mockReturnValue(new Promise((_resolve, fail) => { reject = fail }))
  const pending = ensureSettingsLoaded()
  const settings = { ...DEFAULT_SETTINGS, theme: 'dark' as const }
  mocks.push!({ settings })
  reject(new Error('old read failed'))
  await expect(pending).resolves.toBe(settings)
  await expect(ensureSettingsLoaded()).resolves.toBe(settings)
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
})

test('a read failure without a push remains retryable', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(DEFAULT_SETTINGS)
  await expect(ensureSettingsLoaded()).rejects.toThrow('read failed')
  await expect(ensureSettingsLoaded()).resolves.toBe(DEFAULT_SETTINGS)
})
