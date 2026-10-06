// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { SettingsApp } from '../../../src/renderer/src/features/settings/SettingsApp'
import { refreshAgentConnection, resetAgentConnectionsForTests } from '../../../src/renderer/src/features/chat/agentConnectionStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'

vi.hoisted(() => { Object.defineProperty(window, 'bandal', { configurable: true, value: { on: () => () => undefined, invoke: async () => ({ locale: 'ko-KR' }) } }) })
vi.mock('../../../src/renderer/src/components/BandalMark', () => ({ BandalMark: () => null }))
vi.mock('../../../src/renderer/src/i18n', () => ({ LOCALES: ['ko-KR', 'en-US'], setLocale: vi.fn(), useLocale: () => 'ko-KR', useT: () => (key: string) => key }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; resetAgentConnectionsForTests(); setIpcAdapter(null) })

async function mountSettings() {
  let codexReady = true
  const saved = { ...DEFAULT_SETTINGS, agentProvider: 'gemini' as const }
  const invoke = vi.fn(async (channel: string, req: any) => {
    if (channel === 'settings:get') return saved
    if (channel === 'settings:set') return { ...saved, ...req }
    if (channel === 'agent:availability') return { installed: true, loggedIn: req.provider === 'codex' && codexReady }
    if (channel === 'agent:geminiApiKey') return { configured: false, hint: null, storageAvailable: false }
    return []
  })
  setIpcAdapter({ invoke, on: () => () => undefined } as unknown as IpcAdapter)
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => { root!.render(React.createElement(SettingsApp, { embedded: true, initialCategory: 'ai' })); for (let i = 0; i < 12; i++) await Promise.resolve() })
  return { container, invoke, setCodexReady: (ready: boolean) => { codexReady = ready } }
}

test('opening settings preserves the saved unavailable provider when another provider is ready', async () => {
  const { container, invoke } = await mountSettings()
  expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('settings.ai.gemini.name')
  expect(invoke).not.toHaveBeenCalledWith('settings:set', expect.anything())
})

test('another provider becoming ready does not replace the saved preference; explicit radio selection does', async () => {
  const { container, invoke, setCodexReady } = await mountSettings()
  setCodexReady(false)
  await act(async () => { await refreshAgentConnection('codex', true) })
  setCodexReady(true)
  await act(async () => { await refreshAgentConnection('codex', true) })
  expect(invoke).not.toHaveBeenCalledWith('settings:set', expect.anything())
  expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('settings.ai.gemini.name')
  await act(async () => { (container.querySelectorAll('[role="radio"]')[1] as HTMLButtonElement).click(); for (let i = 0; i < 4; i++) await Promise.resolve() })
  expect(invoke).toHaveBeenCalledWith('settings:set', { agentProvider: 'codex' })
  expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('settings.ai.codex.name')
})
