// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resolveLauncherContext, captureLauncherContext, refreshLauncherContext, useLauncherContext } from '../../../src/renderer/src/features/launcher/launcherContext'
import type { TabDescriptor } from '../../../src/shared/tabs'
import { useCoursesStore } from '../../../src/renderer/src/stores/coursesStore'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { useBrowserGuests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { registerDocumentContext } from '../../../src/renderer/src/features/agent/documentContext'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
const cleanups: Array<() => void> = []
beforeEach(() => { useWorkspaceStore.setState({ openTabs: {} }); setIpcAdapter({ invoke: vi.fn(), on: () => () => {} } as unknown as IpcAdapter) })
afterEach(() => { if (root) act(() => root?.unmount()); root = null; cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); setIpcAdapter(null); document.body.replaceChildren() })

test('uses the exact duplicate panel reader and live URL rather than a canonical tab or initial address', () => {
  const descriptor = { kind: 'pdf' as const, payload: { courseId: 'course', relPath: 'same.pdf' } }
  const documents = [
    { documentId: 'pdf:course:same.pdf', courseId: 'course', kind: 'pdf', title: 'same', page: 1, selection: 'first' },
    { documentId: 'pdf:course:same.pdf::duplicate::second', courseId: 'course', kind: 'pdf', title: 'same', page: 9, selection: 'second' }
  ]
  expect(resolveLauncherContext({ courseId: 'course', source: { panelId: documents[1]!.documentId, descriptor }, documents })).toMatchObject({ sourcePanelId: documents[1]!.documentId, material: { page: 9 }, selection: 'second' })
  expect(resolveLauncherContext({ courseId: 'course', source: { panelId: 'browser:tab', descriptor: { kind: 'browser', payload: { tabId: 'tab', initialUrl: 'https://old.example/' } } }, documents: [], browserNav: { url: 'https://new.example/article', title: 'Current article', loading: false, canGoBack: true, canGoForward: false } }).browser).toEqual({ tabId: 'tab', url: 'https://new.example/article', title: 'Current article' })
  expect(resolveLauncherContext({ courseId: 'course', source: { panelId: 'overview', descriptor: { kind: 'learning', payload: { courseId: 'course' } } }, documents: [] }).binding).toBeNull()
  expect(resolveLauncherContext({ courseId: 'course', source: { panelId: 'root', descriptor: { kind: 'learning', payload: { courseId: 'course', rootRelPath: '' } } }, documents: [] }).binding).toEqual({ courseId: 'course', rootRelPath: '' })
})

test('a pointerdown capture remains available when the launcher hook mounts afterward', async () => {
  const descriptor = { kind: 'note' as const, payload: { courseId: 'course', relPath: 'note.md' } }
  vi.spyOn(useWorkspaceStore.getState(), 'activePanelSource').mockReturnValue({ panelId: 'actual-copy', descriptor })
  useWorkspaceStore.setState({ activePanelId: 'actual-copy', hydration: 'ready' })
  useCoursesStore.setState({ selectedCourseId: 'course' })
  cleanups.push(registerDocumentContext('actual-copy', () => ({ courseId: 'course', kind: 'note', title: 'note', relPath: 'note.md', selection: 'Keep this quote', unsaved: true })))
  await captureLauncherContext()
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  function Host(): JSX.Element { const { context } = useLauncherContext(); return <span>{context.sourcePanelId}:{context.selection}</span> }
  await act(async () => { root!.render(<Host />) })
  expect(element.textContent).toBe('actual-copy:Keep this quote')
})

test('late browser capture cannot overwrite a newer source or silently follow navigation', async () => {
  let source = { panelId: 'browser:tab', descriptor: { kind: 'browser' as const, payload: { tabId: 'tab', initialUrl: 'https://example.com/first' } } }
  vi.spyOn(useWorkspaceStore.getState(), 'activePanelSource').mockImplementation(() => source)
  useWorkspaceStore.setState({ activePanelId: 'browser:tab', hydration: 'ready' })
  useCoursesStore.setState({ selectedCourseId: 'course' })
  useBrowserGuests.setState({ nav: { tab: { url: source.descriptor.payload.initialUrl, title: 'First', loading: false, canGoBack: false, canGoForward: false } } })
  let settle!: (value: unknown) => void
  let reads = 0
  setIpcAdapter({ invoke: vi.fn(() => ++reads === 1 ? new Promise(resolve => { settle = resolve }) : Promise.resolve({ refresh: 'fresh', material: { courseId: 'course', kind: 'browser', title: 'Second', browserTabId: 'tab', url: 'https://example.com/second', selection: 'Second quote' } })), on: () => () => {} } as unknown as IpcAdapter)
  const pending = captureLauncherContext()
  source = { ...source, descriptor: { ...source.descriptor, payload: { ...source.descriptor.payload, initialUrl: 'https://example.com/second' } } }
  useBrowserGuests.setState({ nav: { tab: { url: source.descriptor.payload.initialUrl, title: 'Second', loading: false, canGoBack: true, canGoForward: false } } })
  await captureLauncherContext()
  settle({ refresh: 'fresh', material: { courseId: 'course', kind: 'browser', title: 'Second', browserTabId: 'tab', url: source.descriptor.payload.initialUrl } })
  expect(await pending).toMatchObject({ sourceUnavailable: true, browser: { url: 'https://example.com/first' } })
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  function Host(): JSX.Element { const { context } = useLauncherContext(); return <span>{context.browser?.url}:{context.selection}</span> }
  await act(async () => { root!.render(<Host />) })
  expect(element.textContent).toBe('https://example.com/second:Second quote')
})

test('same-panel article and vocabulary navigation refreshes the source, rejects stale execution and observes only the bound project changes', async () => {
  const binding = { courseId: 'same-course', rootRelPath: 'Reading' }
  const panelId = 'learning-copy'
  const descriptor = (view: 'reader' | 'vocabulary', itemId?: string): TabDescriptor => ({ kind: 'learning', payload: { ...binding, view, ...(itemId ? { itemId } : {}) } })
  vi.spyOn(useWorkspaceStore.getState(), 'activePanelSource').mockImplementation(() => ({ panelId, descriptor: useWorkspaceStore.getState().openTabs[panelId]! }))
  useWorkspaceStore.setState({ activePanelId: panelId, hydration: 'ready', openTabs: { [panelId]: descriptor('reader', 'article-a') } })
  useCoursesStore.setState({ selectedCourseId: binding.courseId })
  let selection = 'Quote from article A'
  cleanups.push(registerDocumentContext(panelId, () => ({ courseId: binding.courseId, kind: 'learning', title: 'Generic folder', selection })))
  let words = [{ id: 'word-a' }]
  const invoke = vi.fn(async () => ({ name: 'Science', articles: [{ id: 'article-a', title: 'Article A', exportRelPath: '기사/a.md' }, { id: 'article-b', title: 'Article B', exportRelPath: '기사/b.md' }], words, exports: [{ relPath: '단어장.md' }] }))
  let changed!: (event: { binding: typeof binding }) => void
  setIpcAdapter({ invoke, on: (channel: string, callback: typeof changed) => { if (channel === 'learning:changed') changed = callback; return () => {} } } as unknown as IpcAdapter)
  const pinned = await captureLauncherContext()
  const element = document.createElement('div'); document.body.append(element); root = createRoot(element)
  function Host(): JSX.Element { const { context } = useLauncherContext(); return <span>{context.material?.title}|{context.articleIds.join(',')}|{context.wordIds.join(',')}|{context.selection}</span> }
  await act(async () => { root!.render(<Host />) })
  expect(element.textContent).toBe('Article A|article-a||Quote from article A')
  await act(async () => { useWorkspaceStore.setState({ openTabs: { [panelId]: descriptor('reader', 'article-b') } }) })
  expect(element.textContent).toBe('Article B|article-b||')
  await expect(refreshLauncherContext(pinned)).rejects.toThrow('원문이 바뀌')
  await act(async () => { await captureLauncherContext() })
  expect(element.textContent).toBe('Article B|article-b||')
  await act(async () => { useWorkspaceStore.setState({ openTabs: { [panelId]: descriptor('vocabulary') } }) })
  expect(element.textContent).toBe('단어장 · Science||word-a|')
  const reads = invoke.mock.calls.length
  await act(async () => { changed({ binding: { ...binding, rootRelPath: 'Unrelated' } }) })
  expect(invoke).toHaveBeenCalledTimes(reads)
  words = [...words, { id: 'word-b' }]
  await act(async () => { changed({ binding }) })
  expect(element.textContent).toBe('단어장 · Science||word-a,word-b|')
  // A fresh selection in this view becomes valid and survives a word refresh.
  const documentElement = document.createElement('div'); documentElement.className = 'tab-document'; documentElement.textContent = 'New vocabulary quote'; document.body.append(documentElement)
  selection = 'New vocabulary quote'
  vi.spyOn(window, 'getSelection').mockReturnValue({ anchorNode: documentElement.firstChild } as Selection)
  await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
  await act(async () => { changed({ binding }) })
  expect(element.textContent).toBe('단어장 · Science||word-a,word-b|New vocabulary quote')
})
