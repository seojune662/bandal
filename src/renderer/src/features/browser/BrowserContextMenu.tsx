/**
 * Right-click inside a guest page.
 *
 * An Electron guest has no default context menu at all, so before this
 * right-clicking a lecture page did literally nothing.
 *
 * Two things make this trickier than an ordinary menu:
 *  - `event.params.x/y` are GUEST-viewport relative; the menu is host DOM, so
 *    they have to be offset by the webview element's rect (the same correction
 *    `selectionBridge` applies to selection rectangles).
 *  - a guest swallows the pointer stream, so without a passthrough token the
 *    click-outside that should dismiss the menu never reaches us. The release
 *    is unconditional in the effect cleanup — `BrowserWebviewLayer` already
 *    carries scars from a token that stayed held and left guests unclickable.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import { guestActions } from './guestActions'
import { acquirePointerPassthrough } from './webviewPassthrough'
import { resolveAddressInput } from './urlInput'
import { v4 as uuidv4 } from 'uuid'

export interface BrowserContextMenuState {
  /** Host-viewport coordinates, already offset. */
  x: number
  y: number
  linkURL: string
  srcURL: string
  mediaType: string
  selectionText: string
  pageURL: string
  /** Guest-relative coordinates, for `copyImageAt`. */
  guestX: number
  guestY: number
}

export type ContextMenuItemId =
  | 'open-link'
  | 'copy-link'
  | 'save-link'
  | 'copy-image'
  | 'save-image'
  | 'copy-selection'
  | 'search-selection'
  | 'reload'
  | 'copy-page-url'
  | 'open-external'

/**
 * Which entries a click offers, given what was under the cursor. Pure so the
 * branching is testable: Playwright cannot deliver a real right-click into a
 * guest WebContents, so this is the only place the logic can be pinned down.
 */
export function contextMenuItems(
  state: Pick<
    BrowserContextMenuState,
    'linkURL' | 'srcURL' | 'mediaType' | 'selectionText'
  >
): ContextMenuItemId[] {
  const items: ContextMenuItemId[] = []
  if (state.linkURL !== '') {
    items.push('open-link', 'copy-link', 'save-link')
  }
  if (state.mediaType === 'image' && state.srcURL !== '') {
    items.push('copy-image', 'save-image')
  }
  if (state.selectionText.trim() !== '') {
    items.push('copy-selection', 'search-selection')
  }
  // Always available, so a right-click anywhere does something useful.
  items.push('reload', 'copy-page-url', 'open-external')
  return items
}

interface MenuItem {
  label: string
  run: () => void
}

export function BrowserContextMenu({
  tabId,
  state,
  onClose
}: {
  tabId: string
  state: BrowserContextMenuState
  onClose: () => void
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const release = acquirePointerPassthrough()
    const dismiss = (): void => onClose()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // `capture` so a click anywhere closes it before anything else reacts.
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', dismiss)
      release()
    }
  }, [onClose])

  useEffect(() => {
    menuRef.current?.focus()
  }, [])

  const openTab = (url: string): void => {
    useWorkspaceStore
      .getState()
      .openTab(descriptorFor('browser', { tabId: uuidv4(), initialUrl: url }))
  }

  const trimmed = state.selectionText.trim().slice(0, 40)
  const actions: Record<ContextMenuItemId, MenuItem> = {
    'open-link': {
      label: '링크를 새 탭에서 열기',
      run: () => openTab(state.linkURL)
    },
    'copy-link': {
      label: '링크 주소 복사',
      run: () => void navigator.clipboard.writeText(state.linkURL)
    },
    'save-link': {
      label: '링크를 자료로 저장',
      run: () => guestActions.download(tabId, state.linkURL)
    },
    'copy-image': {
      label: '이미지 복사',
      run: () => guestActions.copyImageAt(tabId, state.guestX, state.guestY)
    },
    'save-image': {
      label: '이미지를 자료로 저장',
      run: () => guestActions.download(tabId, state.srcURL)
    },
    'copy-selection': {
      label: '복사',
      run: () => guestActions.copySelection(tabId)
    },
    'search-selection': {
      label: `\u201c${trimmed}\u201d 검색`,
      run: () => {
        const url = resolveAddressInput(state.selectionText.trim())
        if (url !== null) openTab(url)
      }
    },
    reload: { label: '새로고침', run: () => guestActions.reload(tabId) },
    'copy-page-url': {
      label: '페이지 주소 복사',
      run: () => void navigator.clipboard.writeText(state.pageURL)
    },
    'open-external': {
      label: '기본 브라우저에서 열기',
      run: () => void invoke('shell:openExternal', { url: state.pageURL })
    }
  }
  const items = contextMenuItems(state).map((id) => ({ id, ...actions[id] }))

  return createPortal(
    <div
      ref={menuRef}
      className="browser-context-menu"
      role="menu"
      tabIndex={-1}
      style={{ left: `${state.x}px`, top: `${state.y}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="browser-context-menu__item"
          onClick={() => {
            item.run()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
