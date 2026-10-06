// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AiShortcuts, openAiShortcut } from '../../../src/renderer/src/features/ai/AiShortcuts'
import { AI_SHORTCUTS_COLLAPSED_KEY, findAiShortcutPanel } from '../../../src/renderer/src/features/ai/aiShortcutModel'
import { useBrowserGuests, resetBrowserGuestsForTests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import type { TabDescriptor } from '../../../src/shared/tabs'
vi.mock('../../../src/renderer/src/i18n', () => ({ useLocale: () => 'ko-KR' }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const workspaceActions = { openTab: useWorkspaceStore.getState().openTab, activatePanel: useWorkspaceStore.getState().activatePanel, showCourseWorkspace: useWorkspaceStore.getState().showCourseWorkspace }
const saved = new Map<string, string>()
const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), clear: () => saved.clear() }
beforeEach(() => { Object.defineProperty(window, 'localStorage', { configurable: true, value: storage }) })
const tab = (tabId: string, initialUrl: string, isPrivate = false): TabDescriptor => ({ kind: 'browser', payload: { tabId, initialUrl, ...(isPrivate ? { isPrivate } : {}) } })
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; window.localStorage.clear(); resetBrowserGuestsForTests(); vi.restoreAllMocks(); useWorkspaceStore.setState({ ...workspaceActions, openTabs: {}, activePanelId: null, activeCourseId: null, surface: 'course' }) })

test('prefers active matching normal tab then live visit recency; reads live URL', () => {
  const tabs = { first: tab('a', 'https://example.com'), second: tab('b', 'https://gemini.google.com/app'), private: tab('p', 'https://gemini.google.com/app', true) }
  const nav = { a: { url: 'https://gemini.google.com/app/conversation' }, b: { url: 'https://gemini.google.com/app/other' } }
  expect(findAiShortcutPanel('gemini', tabs, nav, 'first', ['a', 'b'])).toBe('first')
  expect(findAiShortcutPanel('gemini', tabs, nav, 'private', ['a', 'b', 'p'])).toBe('second')
  expect(findAiShortcutPanel('gemini', tabs, { ...nav, b: { url: 'https://example.com' } }, 'second', ['a', 'b'])).toBe('first')
  expect(findAiShortcutPanel('gemini', { fake: tab('f', 'https://gemini.google.com.evil.test') }, {}, null, [])).toBeNull()
})
test('accepts restored conversations and ChatGPT legacy host, excluding private tabs', () => {
  expect(findAiShortcutPanel('chatgpt', { old: tab('a', 'https://chat.openai.com/c/123') }, {}, null, [])).toBe('old')
  expect(findAiShortcutPanel('claude', { private: tab('p', 'https://claude.ai/chat/123', true) }, {}, null, ['p'])).toBeNull()
})
test('focuses current workspace without opening/navigating and creates a default-profile browser when missing', () => {
  const openTab = vi.spyOn(useWorkspaceStore.getState(), 'openTab').mockImplementation(() => undefined)
  const activatePanel = vi.spyOn(useWorkspaceStore.getState(), 'activatePanel').mockImplementation(() => undefined)
  const showCourseWorkspace = vi.spyOn(useWorkspaceStore.getState(), 'showCourseWorkspace').mockImplementation(() => undefined)
  useWorkspaceStore.setState({ activeCourseId: 'course', openTabs: { match: tab('a', 'https://claude.ai/chat/123') }, activePanelId: null })
  openAiShortcut('claude')
  expect(activatePanel).toHaveBeenCalledWith('match')
  expect(showCourseWorkspace).toHaveBeenCalledWith('course')
  expect(openTab).not.toHaveBeenCalled()
  openAiShortcut('gemini')
  expect(openTab).toHaveBeenCalledWith({ kind: 'browser', payload: { tabId: expect.any(String), initialUrl: 'https://gemini.google.com/app', profileId: 'default' } })
})
test('reuses a temporary null-course tab and does not search other courses', () => {
  const openTab = vi.spyOn(useWorkspaceStore.getState(), 'openTab').mockImplementation(() => undefined)
  const activatePanel = vi.spyOn(useWorkspaceStore.getState(), 'activatePanel').mockImplementation(() => undefined)
  vi.spyOn(useWorkspaceStore.getState(), 'showCourseWorkspace').mockImplementation(() => undefined)
  useWorkspaceStore.setState({ activeCourseId: null, openTabs: { temporary: tab('temp', 'https://chatgpt.com/c/123') } })
  openAiShortcut('chatgpt')
  expect(activatePanel).toHaveBeenCalledWith('temporary')
  useWorkspaceStore.setState({ openTabs: {} })
  useBrowserGuests.setState({ nav: { otherCourse: { url: 'https://chatgpt.com/c/456', title: '', loading: false, canGoBack: false, canGoForward: false } } })
  openAiShortcut('chatgpt')
  expect(openTab).toHaveBeenCalledTimes(1)
})
test('shows three links in the AI section and persists collapse across remounts', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<AiShortcuts />))
  expect([...container.querySelectorAll('.ai-shortcut')].map(button => button.textContent)).toEqual(['ChatGPT', 'Gemini', 'Claude'])
  await act(async () => (container.querySelector('.ai-shortcuts-section__heading') as HTMLButtonElement).click())
  expect(window.localStorage.getItem(AI_SHORTCUTS_COLLAPSED_KEY)).toBe('true')
  expect(container.querySelector('.ai-shortcut')).toBeNull()
  await act(async () => root!.unmount())
  root = createRoot(container)
  await act(async () => root!.render(<AiShortcuts />))
  expect(container.querySelector('.ai-shortcuts-section__heading')?.getAttribute('aria-expanded')).toBe('false')
})
