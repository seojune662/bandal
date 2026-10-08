// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { WorkspaceTabIcon } from '../../../src/renderer/src/features/workspace/workspaceIcons'
const state = vi.hoisted(() => ({ favicon: {} as Record<string, string | undefined> }))
vi.mock('../../../src/renderer/src/features/browser/browserGuestsStore', () => ({ useBrowserGuests: (selector: (value: typeof state) => unknown) => selector(state) }))
afterEach(() => { document.body.replaceChildren(); state.favicon = {}; vi.unstubAllGlobals() })

test('browser tabs use their own raster favicon and recover from missing or broken icons', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element)
  const descriptor = { kind: 'browser' as const, payload: { tabId: 'page', initialUrl: 'https://example.test' } }
  const render = () => root.render(<WorkspaceTabIcon descriptor={descriptor} />)
  await act(async () => render())
  expect(element.querySelector('svg')?.getAttribute('data-tab-icon')).toBe('browser')
  state.favicon.page = 'data:image/png;base64,AAAA'
  await act(async () => render())
  expect(element.querySelector('img')?.src).toBe(state.favicon.page)
  await act(async () => element.querySelector('img')!.dispatchEvent(new Event('error')))
  expect(element.querySelector('img')).toBeNull()
  state.favicon.page = 'data:image/png;base64,BBBB'
  await act(async () => render())
  expect(element.querySelector('img')?.src).toBe(state.favicon.page)
  state.favicon.page = 'https://example.test/favicon.png'
  await act(async () => render())
  expect(element.querySelector('img')).toBeNull()
  await act(async () => root.unmount())
})

test('PDF and Markdown remain distinguishable even without titles', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element)
  await act(async () => root.render(<><WorkspaceTabIcon descriptor={{ kind: 'pdf', payload: { courseId: 'course', relPath: 'paper.pdf' } }} /><WorkspaceTabIcon descriptor={{ kind: 'note', payload: { courseId: 'course', relPath: 'note.md' } }} /></>))
  const icons = [...element.querySelectorAll('svg')]
  expect(icons.map(icon => icon.getAttribute('data-tab-icon'))).toEqual(['pdf', 'note'])
  expect(icons[0]!.innerHTML).not.toBe(icons[1]!.innerHTML)
  await act(async () => root.unmount())
})
