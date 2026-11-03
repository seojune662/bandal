// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: invokeMock, onPush: () => () => {} }))
import { TabsSettingsPanel } from '../../../src/renderer/src/features/settings/TabsSettingsPanel'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, host: HTMLDivElement
beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue([])
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => [], addEventListener: () => {}, removeEventListener: () => {} }
  })
  useUiStore.setState({ settingsTarget: null, settingsSearchQuery: '' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const selectedTab = (): string | null | undefined =>
  host.querySelector('[role=tab][aria-selected=true]')?.textContent

test('the browser and AI sub-tabs link to their panels instead of embedding them', async () => {
  await act(async () => root.render(<TabsSettingsPanel settings={null} />))
  expect(selectedTab()).toBe('브라우저')
  expect(host.querySelector('[data-settings-target="tabs.browser.settings"]')).not.toBeNull()
  expect(host.querySelector('[data-settings-target^="browser."]')).toBeNull()
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '브라우저 설정 열기')
  act(() => button!.click())
  expect(useUiStore.getState().settingsCategory).toBe('browser')
})

test('a deep link selects its sub-tab, and repeating it re-selects after a manual switch', async () => {
  await act(async () => root.render(<TabsSettingsPanel settings={null} />))
  await act(async () => useUiStore.getState().openSettings({ category: 'tabs', subTab: 'recording' }))
  expect(selectedTab()).toBe('녹음')
  const markdown = Array.from(host.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(b => b.textContent === '마크다운')!
  await act(async () => markdown.click())
  expect(selectedTab()).toBe('마크다운')
  await act(async () => {
    useUiStore.setState({ settingsTarget: { category: 'tabs', subTab: 'recording', nonce: Date.now() + 1 } })
  })
  expect(selectedTab()).toBe('녹음')
})

test('a section id alone resolves its sub-tab from the catalog', async () => {
  await act(async () =>
    root.render(<TabsSettingsPanel settings={null} target={{ category: 'tabs', sectionId: 'tabs.note.paper' }} />)
  )
  expect(selectedTab()).toBe('노트')
  expect(host.querySelector('[data-settings-target="tabs.note.paper"]')).not.toBeNull()
})
