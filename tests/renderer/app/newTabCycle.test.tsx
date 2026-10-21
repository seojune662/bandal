// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useGlobalShortcuts } from '../../../src/renderer/src/app/shortcuts'
import { useNewTabMenu } from '../../../src/renderer/src/features/workspace/newTabMenuController'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'

const mocks = vi.hoisted(() => ({
  browser: vi.fn(), markdown: vi.fn(), note: vi.fn(), study: vi.fn().mockResolvedValue(undefined),
  listeners: new Map<string, (payload: any) => void>()
}))
vi.mock('../../../src/renderer/src/app/tabCommands', () => ({
  createBrowserTab: mocks.browser, createDefaultNoteTab: mocks.note, createMarkdownTab: mocks.markdown, createStudyTab: mocks.study
}))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(), onPush: (channel: string, listener: (payload: any) => void) => {
    mocks.listeners.set(channel, listener)
    return () => mocks.listeners.delete(channel)
  }
}))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', async () => {
  const { DEFAULT_SETTINGS } = await import('../../../src/shared/types/settings')
  return { settingsSnapshot: () => DEFAULT_SETTINGS, ensureSettingsLoaded: async () => DEFAULT_SETTINGS }
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
function Harness() { useGlobalShortcuts(); return null }
const key = (type: string, key: string, options: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...options }))
const pressT = (extra: KeyboardEventInit = {}) => key('keydown', 't', { code: 'KeyT', metaKey: true, ...extra })
const release = () => key('keyup', 'Meta')
const push = (phase: string) => mocks.listeners.get('shortcut:passthrough')!({ action: 'new-tab', webContentsId: 42, newTabCycle: phase })

beforeEach(async () => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'bandal', { value: { platform: 'darwin' }, configurable: true })
  useNewTabMenu.getState().close()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useNewTabMenu.getState().close() })

describe('hold modifier and tap T', () => {
  test.each([
    [1, 'browser'], [2, 'markdown'], [3, 'whiteboard'], [4, 'chat'], [5, 'recording'], [6, 'browser']
  ])('%i taps choose %s and create only after modifier release', (count, kind) => {
    for (let i = 0; i < Number(count); i++) { pressT(); key('keyup', 't', { metaKey: true }) }
    expect(mocks.browser).not.toHaveBeenCalled()
    expect(mocks.markdown).not.toHaveBeenCalled()
    expect(mocks.study).not.toHaveBeenCalled()
    expect(useNewTabMenu.getState().cycleIndex).toBe((Number(count) - 1) % 5)
    release(); release()
    if (kind === 'browser') expect(mocks.browser).toHaveBeenCalledTimes(1)
    else if (kind === 'markdown') expect(mocks.markdown).toHaveBeenCalledTimes(1)
    else if (kind === 'whiteboard') expect(mocks.note).toHaveBeenCalledTimes(1)
    else expect(mocks.study).toHaveBeenCalledExactlyOnceWith(kind)
    expect(useNewTabMenu.getState().isOpen).toBe(false)
  })

  test('ignores key repeat, supports a fast key release and starts fresh next time', () => {
    pressT(); pressT({ repeat: true }); release()
    expect(mocks.browser).toHaveBeenCalledTimes(1)
    pressT(); expect(useNewTabMenu.getState().cycleIndex).toBe(0)
  })

  test.each(['escape', 'blur', 'outside'])('%s cancels without creating a tab', reason => {
    pressT()
    if (reason === 'escape') key('keydown', 'Escape', { metaKey: true })
    else if (reason === 'blur') window.dispatchEvent(new Event('blur'))
    else useNewTabMenu.getState().close()
    release()
    expect(mocks.browser).not.toHaveBeenCalled()
    expect(useNewTabMenu.getState().isOpen).toBe(false)
  })

  test('guest and host events share one selection across native focus handoff', () => {
    push('advance'); pressT(); release(); push('commit')
    expect(mocks.markdown).toHaveBeenCalledTimes(1)
    expect(mocks.browser).not.toHaveBeenCalled()
    push('advance'); push('commit')
    expect(mocks.browser).toHaveBeenCalledTimes(1)
    push('advance'); push('cancel'); release()
    expect(mocks.browser).toHaveBeenCalledTimes(1)
  })

  test('Windows uses Control release', () => {
    Object.defineProperty(window, 'bandal', { value: { platform: 'win32' }, configurable: true })
    pressT({ metaKey: false, ctrlKey: true })
    release(); expect(mocks.browser).not.toHaveBeenCalled()
    key('keyup', 'Control')
    expect(mocks.browser).toHaveBeenCalledTimes(1)
  })

  test('a remapped new-tab shortcut keeps the searchable menu and does not auto-create', () => {
    mocks.listeners.get('settings:changed')!({ settings: { ...DEFAULT_SETTINGS, keybindings: { 'new-tab': 'mod+alt+k' } } })
    key('keydown', 'k', { metaKey: true, altKey: true })
    release()
    expect(useNewTabMenu.getState().isOpen).toBe(true)
    expect(useNewTabMenu.getState().cycleIndex).toBeNull()
    expect(mocks.browser).not.toHaveBeenCalled()
  })
})
