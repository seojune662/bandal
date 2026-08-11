/**
 * [M3-F] Browser tab panel — dockview drop-in replacing the M2 placeholder.
 *
 * Owns only the chrome (nav buttons, URL bar, progress) and the anchor the
 * real <webview> guest is positioned over. The guest itself lives in
 * BrowserWebviewLayer; unmounting this panel hides it, never destroys it
 * (see browserAnchor.ts for the contract).
 */

import { useCallback, useEffect, useRef } from 'react'
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
import {
  BrowserAddressInput,
  BrowserBookmarksBar,
  useBrowserFavoriteShortcuts
} from './BrowserStartPage'
import { guestActions } from './guestActions'
import { fillLoginForTab, saveLoginForTab } from './loginBridge'
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
  onNavigate: (url: string) => void
}

function BrowserToolbar({ tabId, nav, onNavigate }: ToolbarProps): JSX.Element {
  const login = useBrowserGuests((state) => state.login[tabId])

  const goBack = (): void => {
    if (nav.canGoBack) guestActions.back(tabId)
  }

  return (
    <div className="browser-toolbar">
      <button
        type="button"
        className="browser-nav-button"
        title="뒤로"
        disabled={!nav.canGoBack}
        onClick={goBack}
      >
        <BrowserIcon name="arrowLeft" />
        <span>뒤로</span>
      </button>
      <button
        type="button"
        className="browser-nav-button"
        title="앞으로"
        disabled={!nav.canGoForward}
        onClick={() => guestActions.forward(tabId)}
      >
        <BrowserIcon name="arrowRight" />
        <span>앞으로</span>
      </button>
      <button
        type="button"
        className="browser-nav-button"
        title={nav.loading ? '중지' : '새로고침'}
        onClick={() =>
          nav.loading ? guestActions.stop(tabId) : guestActions.reload(tabId)
        }
      >
        <Icon name={nav.loading ? 'x' : 'refresh'} />
        <span>{nav.loading ? '중지' : '새로고침'}</span>
      </button>

      <BrowserAddressInput
        ariaLabel="주소 또는 검색어"
        mode="toolbar"
        value={nav.url}
        onNavigate={onNavigate}
      />

      {login?.hasLoginForm === true && login.origin !== null && (
        <div className="browser-login-action">
          <button
            type="button"
            className="browser-login-button"
            disabled={login.pending}
            title={
              login.savedLogin === null
                ? '직접 입력한 아이디와 비밀번호를 안전하게 저장합니다.'
                : `${login.savedLogin.username} 계정으로 채웁니다.`
            }
            onClick={() => {
              if (login.savedLogin === null) void saveLoginForTab(tabId)
              else void fillLoginForTab(tabId)
            }}
          >
            {login.pending
              ? '처리 중…'
              : login.savedLogin === null
                ? '이 사이트 로그인 저장'
                : '로그인 채우기'}
          </button>
          {login.message !== null && (
            <span className="browser-login-message" role="status">
              {login.message === 'saved'
                ? '저장됨'
                : login.message === 'filled'
                  ? '채움'
                  : login.message === 'needs-input'
                    ? '비밀번호를 직접 입력한 뒤 저장하세요.'
                    : '처리하지 못했어요.'}
            </span>
          )}
        </div>
      )}

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
  const { favorites, loading: favoritesLoading, hasCourse } =
    useBrowserFavoriteShortcuts()

  const navigate = useCallback(
    (url: string): void => {
      if (tabId === '') return
      const state = useBrowserGuests.getState()
      if (state.liveGuests.some((guest) => guest.tabId === tabId)) {
        guestActions.navigate(tabId, url)
      } else {
        state.ensureGuest(tabId, url)
      }
      state.setStartPageVisible(tabId, false)
    },
    [tabId]
  )

  // Every browser tab loads its URL in a guest, including the default new tab.
  useEffect(() => {
    if (tabId !== '') {
      useBrowserGuests.getState().ensureGuest(tabId, initialUrl)
    }
  }, [tabId, initialUrl])

  // Reflect the page title into the dockview tab.
  const { api } = props
  useEffect(() => {
    const title = navState.title || hostnameOf(navState.url) || '브라우저'
    if (title !== api.title) api.setTitle(title)
  }, [api, navState.title, navState.url])

  if (payload === null) {
    return <div className="workspace-panel" data-kind="unknown" />
  }

  return (
    <div className="browser-panel" data-kind="browser">
      <BrowserToolbar tabId={tabId} nav={navState} onNavigate={navigate} />
      <BrowserBookmarksBar
        favorites={favorites}
        loading={favoritesLoading}
        hasCourse={hasCourse}
        onNavigate={navigate}
      />
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
