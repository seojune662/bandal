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
import { tabIdForWebContents } from '../features/browser/guestActions'
import { tabPanelId } from '../features/workspace/tabIdentity'
import type { ShortcutPassthrough } from '../../../shared/ipc/events'
import { guestActions } from '../features/browser/guestActions'
import { useBrowserGuests } from '../features/browser/browserGuestsStore'
import { DEFAULT_ZOOM_LEVEL, zoomIn, zoomOut } from '../features/browser/zoom'
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
  | { type: 'activate-last-tab' }
  // Browser-only. No-ops unless a browser tab is focused (or the chord came
  // out of a guest page, which names its own tab).
  | { type: 'browser-reload'; ignoreCache: boolean }
  | { type: 'browser-focus-address' }
  | { type: 'browser-find' }
  | { type: 'reopen-tab' }
  | { type: 'cycle-tab'; delta: number }
  | { type: 'browser-zoom'; direction: 'in' | 'out' | 'reset' }

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
  'new-browser-tab',
  'activate-last-tab',
  'browser-reload',
  'browser-focus-address',
  'browser-find',
  'reopen-tab',
  'cycle-tab',
  'browser-zoom'
])

/** ⇧-chords, kept apart because the plain resolver rejects shift outright. */
function shiftActionForKey(key: string): ShortcutAction | null {
  switch (key) {
    case 'm':
      return { type: 'new-markdown' }
    case 'b':
      return { type: 'new-browser-tab' }
    case 'r':
      return { type: 'browser-reload', ignoreCache: true }
    case 't':
      return { type: 'reopen-tab' }
    case '[':
      return { type: 'cycle-tab', delta: -1 }
    case ']':
      return { type: 'cycle-tab', delta: 1 }
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
    case 'r':
      return { type: 'browser-reload', ignoreCache: false }
    case 'l':
      return { type: 'browser-focus-address' }
    case 'f':
      return { type: 'browser-find' }
    case '=':
    case '+':
      return { type: 'browser-zoom', direction: 'in' }
    case '-':
      return { type: 'browser-zoom', direction: 'out' }
    case '0':
      return { type: 'browser-zoom', direction: 'reset' }
    default: {
      // ⌘9 is "last tab" in every browser, not the ninth one.
      if (key === '9') return { type: 'activate-last-tab' }
      if (/^[1-8]$/.test(key)) {
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

/**
 * `originTabId` is set only for chords replayed out of a guest page. A guest
 * lives in a fixed layer outside the dockview panel DOM and focusing it does
 * NOT make its panel active, so 'close-tab' has to name the tab explicitly —
 * otherwise ⌘W in a split closes whichever panel dockview thinks is active.
 */
function runShortcutAction(
  action: ShortcutAction,
  originTabId?: string
): void {
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
      if (originTabId !== undefined) {
        useWorkspaceStore
          .getState()
          .closeTab(
            tabPanelId({
              kind: 'browser',
              payload: { tabId: originTabId, initialUrl: '' }
            })
          )
        return
      }
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
      return
    case 'activate-last-tab':
      useWorkspaceStore.getState().activateLastTab()
      return
    case 'browser-reload': {
      const target = browserTarget(originTabId)
      if (target === null) return
      if (action.ignoreCache) guestActions.reloadIgnoringCache(target)
      else guestActions.reload(target)
      return
    }
    case 'browser-focus-address': {
      const target = browserTarget(originTabId)
      if (target === null) return
      useBrowserGuests.getState().requestAddressFocus(target)
      return
    }
    case 'reopen-tab':
      useWorkspaceStore.getState().reopenClosedTab()
      return
    case 'cycle-tab':
      useWorkspaceStore.getState().activateRelativeTab(action.delta)
      return
    case 'browser-find': {
      const target = browserTarget(originTabId)
      if (target === null) return
      useBrowserGuests.getState().openFind(target)
      return
    }
    case 'browser-zoom': {
      const target = browserTarget(originTabId)
      if (target === null) return
      const store = useBrowserGuests.getState()
      const current = store.zoom[target] ?? DEFAULT_ZOOM_LEVEL
      const next =
        action.direction === 'reset'
          ? DEFAULT_ZOOM_LEVEL
          : action.direction === 'in'
            ? zoomIn(current)
            : zoomOut(current)
      store.setZoom(target, next)
      guestActions.setZoom(target, next)
    }
  }
}

/** Main names the chord; the renderer owns what it means. */
function passthroughAction(
  action: ShortcutPassthrough['action']
): ShortcutAction | null {
  switch (action) {
    case 'new-tab':
      return { type: 'new-tab' }
    case 'close-tab':
      return { type: 'close-tab' }
    case 'activate-last-tab':
      return { type: 'activate-last-tab' }
    case 'reload':
      return { type: 'browser-reload', ignoreCache: false }
    case 'reload-hard':
      return { type: 'browser-reload', ignoreCache: true }
    case 'focus-address':
      return { type: 'browser-focus-address' }
    case 'find':
      return { type: 'browser-find' }
    case 'reopen-tab':
      return { type: 'reopen-tab' }
    case 'prev-tab':
      return { type: 'cycle-tab', delta: -1 }
    case 'next-tab':
      return { type: 'cycle-tab', delta: 1 }
    case 'zoom-in':
      return { type: 'browser-zoom', direction: 'in' }
    case 'zoom-out':
      return { type: 'browser-zoom', direction: 'out' }
    case 'zoom-reset':
      return { type: 'browser-zoom', direction: 'reset' }
    default:
      return null
  }
}

/**
 * A chord replayed out of a guest names its own tab; one typed in the app
 * chrome applies to the focused browser tab, and does nothing over a PDF,
 * a note or the board.
 */
function browserTarget(originTabId?: string): string | null {
  return originTabId ?? useWorkspaceStore.getState().activeBrowserTabId()
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
    const unsubscribe = onPush(
      'shortcut:passthrough',
      ({ action, webContentsId }) => {
        const originTabId = tabIdForWebContents(webContentsId) ?? undefined
        const resolved = passthroughAction(action)
        if (resolved !== null) runShortcutAction(resolved, originTabId)
      }
    )

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      unsubscribe()
    }
  }, [])
}
