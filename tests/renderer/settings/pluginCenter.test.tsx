// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'
import { BUILTIN_PACKS } from '../../../src/shared/workflowPacks/builtins'
import type { McpServerSummary } from '../../../src/shared/types/mcp'
import type { PluginSummary } from '../../../src/shared/types/plugin'
import { PluginsCategoryPanel } from '../../../src/renderer/src/features/settings/PluginsCategoryPanel'
import { resetMcpServersPanelForTests } from '../../../src/renderer/src/features/settings/McpServersPanel'
import { resetPluginsStoreForTests } from '../../../src/renderer/src/stores/pluginsStore'
import { resetWorkflowPacksStoreForTests } from '../../../src/renderer/src/stores/workflowPacksStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

let root: Root | null = null
let container: HTMLDivElement
const plugin = (id: string, enabled = false): PluginSummary => ({ manifest: { manifestVersion: 2, id, name: id, description: '필기 작업을 돕습니다.', author: 'Example', version: '1.0.0', minAppVersion: '0.42.0', main: 'main.js', styles: null, permissions: ['commands'], contributes: { commands: [{ id: 'help', title: '필기 정리', defaultChord: null }], panels: [] } }, enabled, state: enabled ? 'active' : 'needs-approval', approvedPermissions: enabled ? ['commands'] : null, installedAt: '', lastError: null })

function fake(initialPlugins: PluginSummary[] = []) {
  let settings = structuredClone(DEFAULT_SETTINGS)
  settings.experimental.extensionRuntime = false
  let plugins = initialPlugins
  const packs = BUILTIN_PACKS.map(pack => ({ pack, enabled: true, source: 'builtin' as const, approvedAt: null }))
  let servers: McpServerSummary[] = []
  let testOk = false
  const calls: { channel: string; input: any }[] = []
  setIpcAdapter({ invoke: async (channel: string, input: any) => {
    calls.push({ channel, input })
    if (channel === 'settings:get') return settings
    if (channel === 'settings:set') { settings = { ...settings, experimental: { ...settings.experimental, ...input.experimental } }; return settings }
    if (channel === 'packs:list') return { packs }
    if (channel === 'plugins:list') return { plugins }
    if (channel === 'plugins:approve') { plugins = plugins.map(item => item.manifest.id === input.id ? { ...item, state: 'disabled', approvedPermissions: item.manifest.permissions } : item); return { plugin: plugins.find(item => item.manifest.id === input.id) } }
    if (channel === 'plugins:setEnabled') { plugins = plugins.map(item => item.manifest.id === input.id ? { ...item, enabled: input.enabled, state: input.enabled ? 'active' : 'disabled' } : item); return { plugin: plugins.find(item => item.manifest.id === input.id) } }
    if (channel === 'mcp:list') return { servers, availability: { available: true, reason: null } }
    if (channel === 'mcp:save') {
      const { env, headers, ...publicInput } = input
      const existing = servers.find(item => item.id === input.id)
      const saved: McpServerSummary = { ...existing, ...publicInput, id: input.id ?? `server-${servers.length + 1}`, envKeys: env ? Object.keys(env) : existing?.envKeys ?? [], headerKeys: headers ? Object.keys(headers) : existing?.headerKeys ?? [], createdAt: '2026-10-06T01:00:00Z', updatedAt: '2026-10-06T01:00:00Z' }
      servers = [...servers.filter(item => item.id !== saved.id), saved]
      return { server: saved }
    }
    if (channel === 'mcp:test') { const result = { ok: testOk, tools: testOk ? ['search'] : [], ...(testOk ? {} : { error: '설정한 서버를 실행할 수 없습니다. 실행 환경을 확인해 주세요.' }), durationMs: 1 }; servers = servers.map(item => item.id === input.id ? { ...item, lastTest: { at: '2026-10-06T01:00:00Z', ...result } } : item); return result }
    throw new Error(`Unexpected ${channel}`)
  }, on: () => () => undefined } as unknown as IpcAdapter)
  return { calls, succeed: () => { testOk = true } }
}
async function mount(initialFilter: 'all' | 'external' = 'all'): Promise<void> {
  container = document.createElement('div'); container.className = 'settings-content'; document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<PluginsCategoryPanel initialFilter={initialFilter} />) })
}
async function click(element: Element | null): Promise<void> { expect(element).not.toBeNull(); await act(async () => { (element as HTMLElement).click() }) }
async function input(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
function button(text: string): HTMLButtonElement | null { return [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === text) ?? null }
afterEach(() => { if (root) act(() => root!.unmount()); root = null; container?.remove(); setIpcAdapter(null); resetMcpServersPanelForTests(); resetPluginsStoreForTests(); resetWorkflowPacksStoreForTests() })

test('default list hides credentials/metadata and detail back preserves search, scroll and focus', async () => {
  fake(); await mount()
  expect(container.querySelectorAll('.plugin-center-row')).toHaveLength(BUILTIN_PACKS.length + 6)
  expect(container.querySelector('textarea')).toBeNull()
  expect(container.querySelector('input[type="password"]')).toBeNull()
  expect(container.textContent).not.toContain('@notionhq')
  const search = container.querySelector<HTMLInputElement>('.plugin-center-search input')!
  await input(search, 'Notion')
  expect(container.querySelectorAll('.plugin-center-row')).toHaveLength(1)
  container.scrollTop = 135
  const opener = container.querySelector<HTMLButtonElement>('.plugin-center-row__open')!
  opener.focus(); await click(opener)
  expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1)
  expect(container.textContent).not.toContain('Slack 봇 토큰')
  await click(button('목록으로 돌아가기'))
  expect(container.querySelector<HTMLInputElement>('.plugin-center-search input')?.value).toBe('Notion')
  expect(container.scrollTop).toBe(135)
  expect(document.activeElement).toBe(container.querySelector('.plugin-center-row__open'))
})

test('failed external setup stays saved off, successful retry enables only after testing', async () => {
  const probe = fake(); await mount('external')
  await click(container.querySelector('[data-feature-id="preset:notion"] .plugin-center-row__open'))
  await input(container.querySelector<HTMLInputElement>('input[type="password"]')!, 'fixture-token')
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(container.textContent).toContain('확인 실패 · 꺼짐')
  expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  expect(probe.calls.filter(call => call.channel === 'mcp:save')).toHaveLength(1)
  expect(probe.calls.find(call => call.channel === 'mcp:save')?.input.enabled).toBe(false)
  probe.succeed()
  await click(container.querySelector('[role="switch"]'))
  expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  expect(probe.calls.filter(call => call.channel.startsWith('mcp:') && call.channel !== 'mcp:list').map(call => [call.channel, call.input.enabled])).toEqual([['mcp:save', false], ['mcp:test', undefined], ['mcp:test', undefined], ['mcp:save', true]])
  expect(container.textContent).toContain('마지막 연결 확인')
  expect(container.textContent).toContain('새 화면 도우미 대화부터 적용')
})

test('approval explains globally enabled extensions and Escape returns focus without enabling', async () => {
  const probe = fake([plugin('example.new'), plugin('example.other', true)]); await mount()
  const target = container.querySelector<HTMLButtonElement>('[data-feature-id="plugin:example.new"] [role="switch"]')!
  target.focus(); await click(target)
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('example.other도 함께 시작')
  const dialog = container.querySelector('[role="dialog"]')!
  const focusables = dialog.querySelectorAll<HTMLButtonElement>('button')
  focusables[focusables.length - 1]!.focus()
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
  expect(document.activeElement).toBe(focusables[0])
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(target)
  expect(probe.calls.some(call => call.channel === 'plugins:approve')).toBe(false)
  await click(target)
  await click(button('승인하고 실행 켜기'))
  expect(target.getAttribute('aria-checked')).toBe('true')
  expect(probe.calls.filter(call => ['plugins:approve', 'settings:set', 'plugins:setEnabled'].includes(call.channel)).map(call => call.channel)).toEqual(['plugins:approve', 'settings:set', 'plugins:setEnabled'])
})


test('an errored extension shown off retries activation instead of disabling it', async () => {
  const errored = { ...plugin('example.retry', true), state: 'errored' as const, lastError: '호스트 실행 실패' }
  const probe = fake([errored]); await mount()
  // Enable the runtime explicitly through the existing settings boundary.
  await click(container.querySelector('[data-feature-id="plugin:example.retry"] [role="switch"]'))
  await click(button('실행을 켜고 활성화'))
  const toggles = probe.calls.filter(call => call.channel === 'plugins:setEnabled')
  expect(toggles.map(call => call.input.enabled)).toEqual([true])
})
