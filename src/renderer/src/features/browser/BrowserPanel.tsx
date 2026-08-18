/**
 * [M3-F] Browser tab panel — dockview drop-in replacing the M2 placeholder.
 *
 * Owns only the chrome (nav buttons, URL bar, progress) and the anchor the
 * real <webview> guest is positioned over. The guest itself lives in
 * BrowserWebviewLayer; unmounting this panel hides it, never destroys it
 * (see browserAnchor.ts for the contract).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { BrowserTabPayload } from '../../../../shared/tabs'
import { Icon } from '../../app/icons'
import { Tooltip } from '../../components/Tooltip'
import { useT } from '../../i18n'
import { favoriteScopeKey, useFavoritesStore } from '../../stores/favoritesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { useBrowserAnchorRect } from '../workspace/panels/browserAnchor'
import { BrowserIcon } from './browserIcons'
import {
  initialNavState,
  useBrowserGuests,
  type BrowserNavState
} from './browserGuestsStore'
import {
  browserFavoriteShortcuts,
  hostnameForUrl,
  initialForUrl,
  toneForUrl,
  type BrowserShortcut
} from './browserStartPageModel'
import { guestActions } from './guestActions'
import { fillLoginForTab, saveLoginForTab } from './loginBridge'
import { addressDisplayParts, resolveAddressInput } from './urlInput'
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

function usePanelVisible(api: IDockviewPanelProps['api']): boolean {
  const [visible, setVisible] = useState(() => api.isActive && api.isVisible)

  useEffect(() => {
    const update = (): void => setVisible(api.isActive && api.isVisible)
    const activeDisposable = api.onDidActiveChange(update)
    const visibleDisposable = api.onDidVisibilityChange(update)
    update()
    return () => {
      activeDisposable.dispose()
      visibleDisposable.dispose()
    }
  }, [api])

  return visible
}

function useBrowserFavoriteShortcuts(): BrowserShortcut[] {
  const courseId = useWorkspaceStore((state) => state.activeCourseId)
  const key = favoriteScopeKey(courseId)
  const stored = useFavoritesStore((state) => state.byCourse[key])
  const loading = useFavoritesStore(
    (state) => state.loadingByCourse[key] === true
  )
  const load = useFavoritesStore((state) => state.load)

  useEffect(() => {
    if (courseId !== null && stored === undefined && !loading) {
      void load(courseId)
    }
  }, [courseId, load, loading, stored])

  return useMemo(() => browserFavoriteShortcuts(stored), [stored])
}

function BrowserSiteMark({ url }: { url: string }): JSX.Element {
  return (
    <span
      className="browser-site-mark"
      data-tone={toneForUrl(url)}
      aria-hidden="true"
    >
      {initialForUrl(url)}
    </span>
  )
}

function BrowserAddressInput({
  value,
  onNavigate
}: {
  value: string
  onNavigate: (url: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const parts = addressDisplayParts(value)
  const showDisplayUrl = !focused && draft === null && value.length > 0

  const submit = (): void => {
    const url = resolveAddressInput(draft ?? value)
    if (url === null) return
    setDraft(null)
    inputRef.current?.blur()
    onNavigate(url)
  }

  return (
    <form
      className="browser-address"
      role="search"
      data-display-url={showDisplayUrl ? 'true' : undefined}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <BrowserIcon name={parts.secure ? 'lock' : 'globe'} />
      <span className="browser-address__field">
        <input
          ref={inputRef}
          type="text"
          spellCheck={false}
          autoComplete="off"
          aria-label="주소 또는 검색어"
          placeholder="검색어 또는 주소를 입력하세요"
          value={draft ?? value}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            setFocused(true)
            event.currentTarget.select()
          }}
          onBlur={() => {
            setFocused(false)
            setDraft(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              event.currentTarget.blur()
            }
          }}
        />
        {showDisplayUrl && (
          <span className="browser-address__display" aria-hidden="true">
            <span>{parts.prefix}</span>
            <strong>{parts.domain}</strong>
            <span>{parts.suffix}</span>
          </span>
        )}
      </span>
    </form>
  )
}

function BrowserBookmarksBar({
  favorites,
  onNavigate
}: {
  favorites: readonly BrowserShortcut[]
  onNavigate: (url: string) => void
}): JSX.Element | null {
  if (favorites.length === 0) return null

  return (
    <nav className="browser-bookmarks" aria-label="즐겨찾기 바로가기">
      {favorites.map((favorite) => (
        <Tooltip
          key={favorite.id}
          label={`${favorite.label} — ${hostnameForUrl(favorite.url)}`}
          placement="bottom"
        >
          <button
            type="button"
            className="browser-bookmark"
            onClick={() => onNavigate(favorite.url)}
          >
            <BrowserSiteMark url={favorite.url} />
            <span>{favorite.label}</span>
          </button>
        </Tooltip>
      ))}
    </nav>
  )
}

function BrowserToolbar({ tabId, nav, onNavigate }: ToolbarProps): JSX.Element {
  const login = useBrowserGuests((state) => state.login[tabId])
  const loginTooltip =
    login?.savedLogin === null
      ? '직접 입력한 아이디와 비밀번호를 안전하게 저장합니다.'
      : `${login?.savedLogin.username ?? ''} 계정으로 채웁니다.`

  const goBack = (): void => {
    if (nav.canGoBack) guestActions.back(tabId)
  }

  return (
    <div className="browser-chrome">
      <header className="browser-toolbar" aria-label="브라우저 도구 모음">
        <div className="browser-toolbar__nav">
          <Tooltip label="뒤로" placement="bottom">
            <button
              type="button"
              className="browser-nav-button"
              aria-label="뒤로"
              disabled={!nav.canGoBack}
              onClick={goBack}
            >
              <BrowserIcon name="arrowLeft" />
            </button>
          </Tooltip>
          <Tooltip label="앞으로" placement="bottom">
            <button
              type="button"
              className="browser-nav-button"
              aria-label="앞으로"
              disabled={!nav.canGoForward}
              onClick={() => guestActions.forward(tabId)}
            >
              <BrowserIcon name="arrowRight" />
            </button>
          </Tooltip>
          <Tooltip label={nav.loading ? '중지' : '새로고침'} placement="bottom">
            <button
              type="button"
              className="browser-nav-button"
              aria-label={nav.loading ? '중지' : '새로고침'}
              onClick={() =>
                nav.loading
                  ? guestActions.stop(tabId)
                  : guestActions.reload(tabId)
              }
            >
              <Icon name={nav.loading ? 'x' : 'refresh'} />
            </button>
          </Tooltip>
        </div>

        <BrowserAddressInput value={nav.url} onNavigate={onNavigate} />

        <div className="browser-toolbar__actions">
          {login?.hasLoginForm === true && login.origin !== null && (
            <div className="browser-login-action">
              <Tooltip label={loginTooltip} placement="bottom">
                <button
                  type="button"
                  className="browser-login-button"
                  disabled={login.pending}
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
              </Tooltip>
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
        </div>
      </header>
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
  const t = useT()
  const isPanelVisible = usePanelVisible(props.api)

  const nav = useBrowserGuests((state) =>
    tabId !== '' ? state.nav[tabId] : undefined
  )
  const externalAuthNotice = useBrowserGuests(
    (state) => state.externalAuthNotice
  )
  const navState = nav ?? initialNavState(initialUrl)
  const favorites = useBrowserFavoriteShortcuts()

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
      <BrowserBookmarksBar favorites={favorites} onNavigate={navigate} />
      {isPanelVisible && externalAuthNotice !== null && (
        <div
          key={externalAuthNotice.id}
          className="browser-external-auth"
          role="status"
          aria-live="polite"
        >
          <BrowserIcon name="globe" />
          <span className="browser-external-auth__message">
            {t('browser.externalAuth.message')}
          </span>
          <button
            type="button"
            className="browser-external-auth__dismiss"
            aria-label={t('browser.externalAuth.dismiss')}
            onClick={() =>
              useBrowserGuests.getState().dismissExternalAuthNotice()
            }
          >
            <Icon name="x" />
          </button>
        </div>
      )}
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
