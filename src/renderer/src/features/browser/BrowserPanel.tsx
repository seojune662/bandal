/**
 * [M3-F] Browser tab panel — dockview drop-in replacing the M2 placeholder.
 *
 * Owns only the chrome (nav buttons, URL bar, progress) and the anchor the
 * real <webview> guest is positioned over. The guest itself lives in
 * BrowserWebviewLayer; unmounting this panel hides it, never destroys it
 * (see browserAnchor.ts for the contract).
 */

import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { BrowserTabPayload } from '../../../../shared/tabs'
import { Icon } from '../../app/icons'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { useBrowserAnchorRect } from '../workspace/panels/browserAnchor'
import { BrowserIcon } from './browserIcons'
import {
  initialNavState,
  useBrowserGuests,
  type BrowserNavState
} from './browserGuestsStore'
import { guestActions } from './guestActions'
import { resolveAddressInput } from './urlInput'
import './browser.css'

function browserPayloadFromParams(params: unknown): BrowserTabPayload | null {
  if (typeof params !== 'object' || params === null) return null
  const descriptor = (params as Record<string, unknown>)['descriptor']
  if (!isTabDescriptor(descriptor) || descriptor.kind !== 'browser') return null
  return descriptor.payload
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

interface ToolbarProps {
  tabId: string
  nav: BrowserNavState
}

function BrowserToolbar({ tabId, nav }: ToolbarProps): JSX.Element {
  // null = mirror the live URL; string = the user is editing.
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [isFaviconBroken, setFaviconBroken] = useState(false)

  useEffect(() => {
    setFaviconBroken(false)
  }, [nav.favicon])

  const submit = (): void => {
    const url = resolveAddressInput(draft ?? '')
    setDraft(null)
    inputRef.current?.blur()
    if (url !== null) guestActions.navigate(tabId, url)
  }

  const showFavicon = nav.favicon !== null && !isFaviconBroken

  return (
    <div className="browser-toolbar">
      <button
        type="button"
        className="browser-nav-button"
        aria-label="뒤로"
        title="뒤로"
        disabled={!nav.canGoBack}
        onClick={() => guestActions.back(tabId)}
      >
        <BrowserIcon name="arrowLeft" />
      </button>
      <button
        type="button"
        className="browser-nav-button"
        aria-label="앞으로"
        title="앞으로"
        disabled={!nav.canGoForward}
        onClick={() => guestActions.forward(tabId)}
      >
        <BrowserIcon name="arrowRight" />
      </button>
      <button
        type="button"
        className="browser-nav-button"
        aria-label={nav.loading ? '중지' : '새로고침'}
        title={nav.loading ? '중지' : '새로고침'}
        onClick={() =>
          nav.loading ? guestActions.stop(tabId) : guestActions.reload(tabId)
        }
      >
        <Icon name={nav.loading ? 'x' : 'refresh'} />
      </button>

      <form
        className="browser-urlbar"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <span className="browser-urlbar__site" aria-hidden="true">
          {showFavicon ? (
            <img
              className="browser-urlbar__favicon"
              src={nav.favicon ?? undefined}
              alt=""
              onError={() => setFaviconBroken(true)}
            />
          ) : (
            <BrowserIcon name="globe" />
          )}
        </span>
        <input
          ref={inputRef}
          type="text"
          spellCheck={false}
          autoComplete="off"
          aria-label="주소 또는 검색어"
          placeholder="주소를 입력하거나 검색…"
          value={draft ?? nav.url}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              event.currentTarget.blur()
            }
          }}
        />
      </form>

      <div
        className="browser-progress"
        data-active={nav.loading ? 'true' : undefined}
        aria-hidden="true"
      >
        <div className="browser-progress__bar" />
      </div>
    </div>
  )
}

export function BrowserPanel(props: IDockviewPanelProps): JSX.Element {
  const payload = browserPayloadFromParams(props.params)
  const tabId = payload?.tabId ?? ''
  const initialUrl = payload?.initialUrl ?? ''

  const anchorRef = useRef<HTMLDivElement>(null)
  useBrowserAnchorRect(tabId, anchorRef)

  const nav = useBrowserGuests((state) =>
    tabId !== '' ? state.nav[tabId] : undefined
  )
  const navState = nav ?? initialNavState(initialUrl)

  // Create (or LRU-bump) the guest whenever this tab becomes visible.
  useEffect(() => {
    if (tabId !== '') {
      useBrowserGuests.getState().ensureGuest(tabId, initialUrl)
    }
  }, [tabId, initialUrl])

  // Reflect the page title into the dockview tab.
  const { api } = props
  useEffect(() => {
    if (navState.title !== '' && navState.title !== api.title) {
      api.setTitle(navState.title)
    }
  }, [navState.title, api])

  if (payload === null) {
    return <div className="workspace-panel" data-kind="unknown" />
  }

  return (
    <div className="browser-panel" data-kind="browser">
      <BrowserToolbar tabId={tabId} nav={navState} />
      <div
        ref={anchorRef}
        className="browser-anchor"
        data-browser-anchor={tabId}
      >
        {/* Shown before first paint / if the guest renderer ever goes away. */}
        <div className="browser-anchor__fallback">
          <BrowserIcon name="globe" />
          <span>{hostnameOf(navState.url)}</span>
        </div>
      </div>
    </div>
  )
}
