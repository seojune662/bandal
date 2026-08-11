/**
 * [M6-A] Global keyboard shortcuts.
 *
 *   ⌘T      새 탭 메뉴 (workspace의 openNewTabMenu)
 *   ⇧⌘M     새 마크다운 (과목 폴더에 .md 생성 후 탭으로 열기)
 *   ⇧⌘B     새 브라우저 탭
 *   ⌘W      활성 탭 닫기 — 탭이 없으면 no-op (창은 절대 닫지 않는다;
 *           기본 메뉴의 ⌘W(Close Window)는 src/main/menu.ts가 ⇧⌘W로 옮겨
 *           이 chord가 렌더러까지 내려온다)
 *   ⌘P      빠른 파일 검색 (선택된 과목의 materials:search 옴니박스)
 *   ⌘,      설정 화면 (메뉴 액셀러레이터가 먼저 먹지만, 여기도 폴백으로 처리)
 *   ⌘1..9   n번째 탭 활성화
 *
 * Guard rules (all encoded in the pure `resolveShortcut`, unit-tested):
 *  - IME-safe: composing keydowns (isComposing / keyCode 229) never match.
 *  - Chord must be exactly meta-or-ctrl — alt/shift disqualify.
 *  - While a <webview> guest has focus, only ⌘T/⌘W act. (In practice the
 *    guest owns the keyboard, so those two arrive via the main process
 *    `shortcut:passthrough` push — see hardenWebviews; the target guard here
 *    is defense in depth for the host-side <webview> element.)
 *  - Editable targets (inputs, Milkdown) keep working: these are modifier
 *    chords, not text input, so they stay active there.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { onPush } from '../lib/ipc'
import { openNewTabMenu } from '../features/workspace/newTabMenuController'
import { createBrowserTab, createMarkdownTab } from './tabCommands'
import { useUiStore } from '../stores/uiStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

// -- pure resolver ------------------------------------------------------------

export type ShortcutAction =
  | { type: 'new-tab' }
  | { type: 'new-markdown' }
  | { type: 'new-browser-tab' }
  | { type: 'close-tab' }
  | { type: 'quick-search' }
  | { type: 'settings' }
  | { type: 'activate-tab'; index: number }

export interface ShortcutInput {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  /** True while an IME composition is in flight (or keyCode === 229). */
  isComposing: boolean
  /** True when the event target / focus is a <webview> guest element. */
  targetIsWebview: boolean
}

const GUEST_ALLOWED: ReadonlySet<ShortcutAction['type']> = new Set([
  'new-tab',
  'close-tab',
  'new-markdown',
  'new-browser-tab'
])

/** ⇧-chords, kept apart because the plain resolver rejects shift outright. */
function shiftActionForKey(key: string): ShortcutAction | null {
  switch (key) {
    case 'm':
      return { type: 'new-markdown' }
    case 'b':
      return { type: 'new-browser-tab' }
    default:
      return null
  }
}

function actionForKey(key: string): ShortcutAction | null {
  switch (key) {
    case 't':
      return { type: 'new-tab' }
    case 'w':
      return { type: 'close-tab' }
    case 'p':
      return { type: 'quick-search' }
    case ',':
      return { type: 'settings' }
    default: {
      if (/^[1-9]$/.test(key)) {
        return { type: 'activate-tab', index: Number(key) - 1 }
      }
      return null
    }
  }
}

/** Maps a keydown to a shortcut action, or null when guards reject it. */
export function resolveShortcut(input: ShortcutInput): ShortcutAction | null {
  if (input.isComposing) return null
  if (!(input.metaKey || input.ctrlKey)) return null
  if (input.altKey) return null

  if (input.shiftKey) {
    const shifted = shiftActionForKey(input.key.toLowerCase())
    if (shifted === null) return null
    return input.targetIsWebview && !GUEST_ALLOWED.has(shifted.type)
      ? null
      : shifted
  }

  const action = actionForKey(input.key.toLowerCase())
  if (action === null) return null
  if (input.targetIsWebview && !GUEST_ALLOWED.has(action.type)) return null
  return action
}

// -- quick-search open/close state (⌘P overlay) -------------------------------

interface QuickSearchState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const useQuickSearch = create<QuickSearchState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen }))
}))

// -- dispatch + registration --------------------------------------------------

function runShortcutAction(action: ShortcutAction): void {
  switch (action.type) {
    case 'new-tab':
      openNewTabMenu()
      return
    case 'new-markdown':
      void createMarkdownTab()
      return
    case 'new-browser-tab':
      createBrowserTab()
      return
    case 'close-tab':
      useWorkspaceStore.getState().closeActiveTab()
      return
    case 'quick-search':
      useQuickSearch.getState().toggle()
      return
    case 'settings':
      useUiStore.getState().openSettings()
      return
    case 'activate-tab':
      useWorkspaceStore.getState().activateTabAt(action.index)
  }
}

function isWebviewTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.tagName.toLowerCase() === 'webview'
  )
}

/** Registers the window keydown listener + the guest passthrough push. */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = resolveShortcut({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing || event.keyCode === 229,
        targetIsWebview:
          isWebviewTarget(event.target) ||
          isWebviewTarget(document.activeElement)
      })
      if (action === null) return
      event.preventDefault()
      runShortcutAction(action)
    }
    window.addEventListener('keydown', onKeyDown)

    // ⌘T/⌘W typed INSIDE a browser guest arrive via main's
    // before-input-event interception (the guest never sees the chord).
    const unsubscribe = onPush('shortcut:passthrough', ({ action }) => {
      runShortcutAction({ type: action })
    })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      unsubscribe()
    }
  }, [])
}
