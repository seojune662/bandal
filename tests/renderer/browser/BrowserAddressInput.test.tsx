// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: invokeMock, onPush: vi.fn() }))
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
Element.prototype.scrollIntoView = vi.fn()

import { BrowserAddressInput } from '../../../src/renderer/src/features/browser/BrowserAddressInput'
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore'
import { useBrowserGuests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
import { isPointerPassthroughActive } from '../../../src/renderer/src/features/browser/webviewPassthrough'
import { favoriteScopeKey, resetFavoritesStoreForTests, useFavoritesStore } from '../../../src/renderer/src/stores/favoritesStore'
import type { Favorite } from '../../../src/shared/types/favorite'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
const navigate = vi.fn()
const original = 'https://www.youtube.com/?reload=9&app=desktop&hl=ko&gl=KR'
const historyHit = { url: 'https://study.example.com/week1', title: '자료구조 강의실', host: 'study.example.com' }

beforeEach(() => {
  vi.useFakeTimers()
  navigate.mockReset()
  invokeMock.mockReset().mockResolvedValue({ entries: [] })
  useWorkspaceStore.setState({ openTabs: {} })
  resetFavoritesStoreForTests()
  useBrowserGuests.setState({ nav: {}, liveGuests: [] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})
function render(isPrivate = false): HTMLInputElement {
  act(() => root.render(<BrowserAddressInput value={original} onNavigate={navigate}
    focusSeq={0} favicon={undefined} isPrivate={isPrivate} />))
  return host.querySelector('input')!
}
function focus(input: HTMLInputElement): void { act(() => input.focus()) }
function type(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function key(input: HTMLInputElement, key: string, extra = {}): void {
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })) })
}
async function tick(): Promise<void> { await act(() => vi.advanceTimersByTimeAsync(100)) }

describe('browser address interaction', () => {
  test('suggests the owning course and global favorites only from the selected profile', () => {
    const saved = (id: string, profileId: string, courseId: string | null): Favorite => ({
      id, courseId, label: '마이페이지',
      descriptor: { kind: 'browser', payload: { tabId: id, initialUrl: `https://${id}.example`, profileId } },
      sortOrder: 0, createdAt: '', updatedAt: ''
    })
    useWorkspaceStore.setState({ activeCourseId: 'other-course' })
    useFavoritesStore.setState({ byCourse: {
      course: [saved('school-course', 'school', 'course'), saved('personal-course', 'default', 'course')],
      'other-course': [saved('other-course', 'school', 'other-course')],
      [favoriteScopeKey(null)]: [saved('school-imported', 'school', null), saved('personal-imported', 'default', null)]
    } })
    act(() => root.render(<BrowserAddressInput value={original} onNavigate={navigate} focusSeq={0}
      favicon={undefined} isPrivate={false} profileId="school" courseId="course" />))
    focus(host.querySelector('input')!)
    const labels = Array.from(document.querySelectorAll('.browser-suggestion__label'), node => node.textContent)
    expect(labels).toEqual(['school-course.example · 마이페이지', 'school-imported.example · 마이페이지'])
  })

  test('shows just the domain; focus selects the complete URL, and Escape restores it', () => {
    const input = render()
    expect(host.querySelector('.browser-address__display')?.textContent).toBe('youtube.com')
    focus(input)
    expect(input.value).toBe(original)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(original.length)
    type(input, 'temporary')
    key(input, 'Escape')
    expect(input.value).toBe(original)
    expect(document.querySelector('[role=listbox]')).toBeNull()
  })

  test('shows recent visits on focus and portals clickable suggestions above the webview', async () => {
    invokeMock.mockResolvedValue({ entries: [historyHit] })
    const input = render()
    focus(input)
    await tick()
    const list = document.querySelector('[role=listbox]')!
    expect(host.contains(list)).toBe(false)
    expect(list.textContent).toContain('바로가기')
    expect(list.textContent).toContain('자료구조 강의실')
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    // The listbox is a partial occlusion: unrelated split panes remain live.
    expect(isPointerPassthroughActive()).toBe(false)
    act(() => (list.querySelector('[role=option]') as HTMLButtonElement).click())
    expect(navigate).toHaveBeenCalledWith(historyHit.url)
    expect(isPointerPassthroughActive()).toBe(false)
  })

  test('Enter on an untouched focused address preserves every query parameter', async () => {
    invokeMock.mockResolvedValue({ entries: [historyHit] })
    const input = render()
    focus(input)
    await tick()
    key(input, 'Enter')
    expect(navigate).toHaveBeenCalledWith(original)
  })

  test('typing Enter searches even when matching history arrives', async () => {
    invokeMock.mockResolvedValue({ entries: [historyHit] })
    const input = render()
    focus(input)
    type(input, '자료구조')
    await tick()
    const selected = document.getElementById(input.getAttribute('aria-activedescendant')!)
    expect(selected?.getAttribute('data-kind')).toBe('search')
    key(input, 'Enter')
    expect(navigate).toHaveBeenCalledWith(`https://www.google.com/search?q=${encodeURIComponent('자료구조')}`)
  })

  test('arrow keys select a matching shortcut with an accessible active descendant', async () => {
    invokeMock.mockResolvedValue({ entries: [historyHit] })
    const input = render()
    focus(input)
    type(input, '강의실')
    await tick()
    key(input, 'ArrowDown')
    const selected = document.getElementById(input.getAttribute('aria-activedescendant')!)
    expect(selected?.textContent).toContain('자료구조 강의실')
    key(input, 'Enter')
    expect(navigate).toHaveBeenCalledWith(historyHit.url)
  })

  test('a pending old lookup cannot replace a new query or leak into private mode', async () => {
    let resolveOld!: (value: unknown) => void
    invokeMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const input = render()
    focus(input)
    type(input, '자료')
    await tick()
    type(input, 'different')
    await act(async () => resolveOld({ entries: [historyHit] }))
    expect(document.body.textContent).not.toContain('자료구조 강의실')
    render(true)
    await tick()
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  test('switching from loaded history to private hides it immediately', async () => {
    invokeMock.mockResolvedValue({ entries: [historyHit] })
    const input = render()
    focus(input)
    type(input, '자료')
    await tick()
    expect(document.body.textContent).toContain(historyHit.title)
    render(true)
    expect(document.body.textContent).not.toContain(historyHit.title)
  })

  test('Korean composition Enter never navigates', () => {
    const input = render()
    focus(input)
    type(input, '한글')
    key(input, 'Enter', { isComposing: true })
    expect(navigate).not.toHaveBeenCalled()
    key(input, 'Enter')
    expect(navigate).toHaveBeenCalledOnce()
  })

  test('matches the current title and URL of open tabs, excluding private tabs', () => {
    useWorkspaceStore.setState({ openTabs: {
      public: { kind: 'browser', payload: { initialUrl: 'https://old.example.com' } },
      private: { kind: 'browser', payload: { initialUrl: 'https://private.example.com', isPrivate: true } }
    } })
    useBrowserGuests.setState({ nav: {
      public: { url: 'https://current.example.com', title: '새 강의', loading: false, canGoBack: true, canGoForward: false },
      private: { url: 'https://private.example.com', title: '비밀 강의', loading: false, canGoBack: false, canGoForward: false }
    } })
    const input = render()
    focus(input)
    type(input, '강의')
    expect(document.body.textContent).toContain('새 강의')
    expect(document.body.textContent).toContain('current.example.com')
    expect(document.body.textContent).not.toContain('비밀 강의')
  })
})
