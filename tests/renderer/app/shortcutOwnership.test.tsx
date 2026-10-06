// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { useGlobalShortcuts, useQuickSearch } from '../../../src/renderer/src/app/shortcuts'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(), onPush: () => () => {}, openSettingsWindow: vi.fn()
}))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', async () => {
  const { DEFAULT_SETTINGS } = await import('../../../src/shared/types/settings')
  return { settingsSnapshot: () => DEFAULT_SETTINGS, ensureSettingsLoaded: async () => DEFAULT_SETTINGS }
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('a chord already handled by a focused editor does not also trigger a global action', async () => {
  function Harness() { useGlobalShortcuts(); return <input onKeyDown={event => event.preventDefault()} /> }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  useQuickSearch.getState().close()
  try {
    await act(async () => root.render(<Harness />))
    await act(async () => host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true })))
    expect(useQuickSearch.getState().isOpen).toBe(false)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true })))
    expect(useQuickSearch.getState().isOpen).toBe(true)
  } finally {
    await act(async () => root.unmount()); host.remove(); useQuickSearch.getState().close()
  }
})
