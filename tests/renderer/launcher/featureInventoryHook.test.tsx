// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'
import type { PluginSummary } from '../../../src/shared/types/plugin'
import { useFeatureInventory } from '../../../src/renderer/src/features/launcher/featureInventory'
import { resetPluginsStoreForTests } from '../../../src/renderer/src/stores/pluginsStore'
import { resetWorkflowPacksStoreForTests } from '../../../src/renderer/src/stores/workflowPacksStore'
import { resetSettingsSnapshotForTests } from '../../../src/renderer/src/stores/settingsSnapshot'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  resetPluginsStoreForTests(); resetWorkflowPacksStoreForTests(); resetSettingsSnapshotForTests()
  setIpcAdapter(null); document.body.replaceChildren()
})

test('retry reloads failed runtime settings and applies the recovered permission availability', async () => {
  const plugin: PluginSummary = {
    manifest: { manifestVersion: 2, id: 'study.tools', name: 'Study Tools', description: 'Study tools', author: 'Student', version: '1.0.0', minAppVersion: '0.35.0', main: 'main.js', styles: null,
      permissions: ['commands'], contributes: { commands: [{ id: 'quiz', title: 'Custom quiz', defaultChord: null }], panels: [], menus: [] } },
    enabled: true, state: 'active', approvedPermissions: ['commands'], installedAt: 'now', lastError: null
  }
  const settings = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockRejectedValueOnce(new Error('Still disconnected'))
    .mockResolvedValue({ ...DEFAULT_SETTINGS, experimental: { ...DEFAULT_SETTINGS.experimental, extensionRuntime: false } })
  setIpcAdapter({ invoke: vi.fn((channel: string) => {
    if (channel === 'settings:get') return settings()
    if (channel === 'packs:list') return Promise.resolve({ packs: [] })
    if (channel === 'plugins:list') return Promise.resolve({ plugins: [plugin] })
    throw new Error(`Unexpected IPC: ${channel}`)
  }), on: () => () => {} } as unknown as IpcAdapter)
  let inventory!: ReturnType<typeof useFeatureInventory>
  function Host(): JSX.Element { inventory = useFeatureInventory(); return <span>{inventory.error}</span> }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root!.render(<Host />) })
  expect(inventory.error).toBe('플러그인 실행 설정을 불러오지 못했어요.')
  await act(async () => { await inventory.reload() })
  expect(inventory.error).toBe('플러그인 실행 설정을 불러오지 못했어요.')
  await act(async () => { await inventory.reload() })
  expect(settings).toHaveBeenCalledTimes(3)
  expect(inventory.error).toBeNull()
  expect(inventory.entries[0]?.unavailableReason).toContain('플러그인 실행이 꺼져')
})
