// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { SettingsApp } from '../../../src/renderer/src/features/settings/SettingsApp'
import { resetAgentConnectionsForTests } from '../../../src/renderer/src/features/chat/agentConnectionStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'
import { ConfirmDialogProvider } from '../../../src/renderer/src/components/ui/confirm-dialog'
import { TooltipProvider } from '../../../src/renderer/src/components/ui/tooltip'

vi.hoisted(() => { Object.defineProperty(window, 'bandal', { configurable: true, value: { on: () => () => undefined, invoke: async () => ({ locale: 'ko-KR' }) } }) })
vi.mock('../../../src/renderer/src/components/BandalMark', () => ({ BandalMark: () => null }))
// 계정 shows the account and school panels above 과목; these tests are about the panels below them.
vi.mock('../../../src/renderer/src/features/settings/AccountPanel', () => ({ AccountPanel: () => null }))
vi.mock('../../../src/renderer/src/features/settings/UniversitySettingsPanel', () => ({ UniversitySettingsPanel: () => null }))
vi.mock('../../../src/renderer/src/i18n', () => ({ LOCALES: ['ko-KR', 'en-US'], setLocale: vi.fn(), useLocale: () => 'ko-KR', useT: () => (key: string) => key }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; resetAgentConnectionsForTests(); setIpcAdapter(null) })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function mount(category: string, override: (channel: string, input: any) => Promise<unknown> | undefined) {
  const listeners = new Map<string, (value: any) => void>()
  const invoke = vi.fn((channel: string, input: any) => override(channel, input) ?? (
    // A section shows several panels; 사용 통계 stays loading here.
    channel === 'usage:summary' ? new Promise(() => undefined) : Promise.resolve(
    channel === 'settings:get' ? DEFAULT_SETTINGS : channel === 'agent:availability' ? { installed: false, loggedIn: false } : [])))
  setIpcAdapter({ invoke, on: (channel: string, listener: (value: any) => void) => { listeners.set(channel, listener); return () => listeners.delete(channel) } } as unknown as IpcAdapter)
  const container = document.createElement('div'); root = createRoot(container)
  // The app's root providers: a section shows several panels, some with tooltips and confirmations.
  await act(async () => root!.render(<TooltipProvider><ConfirmDialogProvider><SettingsApp embedded initialCategory={category} /></ConfirmDialogProvider></TooltipProvider>))
  return { container, push: (value: unknown) => listeners.get('settings:changed')!({ settings: value }) }
}

test('a late preference command reply does not replace a newer settings broadcast', async () => {
  const response = deferred<unknown>()
  const { container, push } = await mount('ai', channel => channel === 'settings:set' ? response.promise : undefined)
  await act(async () => (container.querySelectorAll('[role="radio"]')[1] as HTMLButtonElement).click())
  await act(async () => push({ ...DEFAULT_SETTINGS, agentProvider: 'gemini' }))
  await act(async () => response.resolve({ ...DEFAULT_SETTINGS, agentProvider: 'codex' }))
  expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('settings.ai.gemini.name')
})

test('a slower course listing cannot undo the current archived-course filter', async () => {
  const old = deferred<unknown>(), latest = deferred<unknown>()
  const { container } = await mount('courses', (channel, input) => channel === 'courses:list' ? input.includeArchived ? latest.promise : old.promise : undefined)
  await act(async () => (container.querySelector('[role="switch"]') as HTMLButtonElement).click())
  const course = { id: 'archived', name: '보관한 과목', archived: true, source: 'managed', folderPath: '/course', color: 'blue' }
  await act(async () => latest.resolve([course]))
  expect(container.textContent).toContain('보관한 과목')
  await act(async () => old.resolve([]))
  expect(container.textContent).toContain('보관한 과목')
})

test('Settings lists the iPad-style sections, 동기화 among them, and a panel deep link opens its section', async () => {
  const { container } = await mount('tabs', () => undefined)
  const items = [...container.querySelectorAll<HTMLElement>('.settings-nav [data-category]')].map((item) => item.dataset['category'])
  expect(items).toEqual(['general', 'appearance', 'account', 'ai', 'sync', 'integrations', 'packs', 'privacy', 'about'])
  // `tabs` lives in 화면: that section is the current one, and the panel is rendered in it.
  expect(container.querySelector('[data-category="appearance"]')?.getAttribute('aria-current')).toBe('page')
  expect(container.querySelector('[data-settings-panel="tabs"]')).not.toBeNull()
  expect(container.querySelector('[data-settings-panel="appearance"]')).not.toBeNull()
})
