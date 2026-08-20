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
import { BrowserCrashPage, BrowserErrorPage } from './BrowserErrorPage'
import { BrowserDownloadsPanel } from './BrowserDownloadsPanel'
import { BrowserDiagnosticsPanel } from './BrowserDiagnosticsPanel'
import { OPEN_DIAGNOSTICS_EVENT } from './diagnosticsBridge'
import { DEFAULT_ZOOM_LEVEL, isDefaultZoom, zoomPercent } from './zoom'
import { useDownloads } from './downloadsStore'
import { toggleFavorite, useBrowserFavorite } from './browserFavorite'
import { settingsSnapshot } from '../../stores/settingsSnapshot'
import { BrowserFindBar } from './BrowserFindBar'
import { AgentRunBanner } from './AgentRunBanner'
import {
  searchEngine,
  useAddressSuggestions
} from './useAddressSuggestions'
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
  onNavigate,
  focusSeq,
  favicon
}: {
  value: string
  onNavigate: (url: string) => void
  /** Increments when ⌘L asks for focus; 0 = never asked. */
  focusSeq: number
  /** data: URL, or undefined to fall back to the generic globe. */
  favicon: string | undefined
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestions = useAddressSuggestions(draft)

  useEffect(() => {
    if (focusSeq === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSeq])
  useEffect(() => setHighlighted(0), [draft])

  const parts = addressDisplayParts(value)
  const showDisplayUrl = !focused && draft === null && value.length > 0
  const open = focused && draft !== null && suggestions.length > 0
  const clamped = Math.min(highlighted, Math.max(0, suggestions.length - 1))

  const go = (url: string): void => {
    setDraft(null)
    inputRef.current?.blur()
    onNavigate(url)
  }

  const submit = (): void => {
    // ↵ takes the highlighted row when one is, otherwise the literal input —
    // so typing and pressing enter never lands somewhere unexpected.
    const picked = open ? suggestions[clamped] : undefined
    if (picked !== undefined) {
      go(picked.url)
      return
    }
    const url = resolveAddressInput(draft ?? value, searchEngine())
    if (url === null) return
    go(url)
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
      {/* The favicon used to REPLACE this, and every real site has a
          favicon — so the lock was only ever visible on sites without an
          icon, and an http:// phishing clone of a 학사포털 looked exactly
          like the real https:// one. They are different facts and both get
          shown. */}
      <span
        className={
          parts.secure
            ? 'browser-address__security'
            : 'browser-address__security browser-address__security--insecure'
        }
        title={
          parts.secure
            ? '이 연결은 암호화돼 있어요'
            : '암호화되지 않은 연결이에요. 비밀번호를 입력하지 마세요.'
        }
        aria-label={parts.secure ? '보안 연결' : '보안되지 않은 연결'}
      >
        <BrowserIcon name={parts.secure ? 'lock' : 'insecure'} />
      </span>
      {favicon !== undefined && (
        <img className="browser-address__favicon" src={favicon} alt="" />
      )}
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
          role="combobox"
          aria-expanded={open}
          aria-controls="browser-address-suggestions"
          aria-autocomplete="list"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              event.currentTarget.blur()
              return
            }
            if (!open) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setHighlighted((index) => (index + 1) % suggestions.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlighted(
                (index) =>
                  (index - 1 + suggestions.length) % suggestions.length
              )
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
      {open && (
        <ul
          id="browser-address-suggestions"
          className="browser-suggestions"
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.kind}:${suggestion.url}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === clamped}
                data-highlighted={index === clamped ? 'true' : undefined}
                className="browser-suggestion"
                onMouseEnter={() => setHighlighted(index)}
                // The input's blur would close the list before a click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(suggestion.url)}
              >
                <span className="browser-suggestion__label">
                  {suggestion.label}
                </span>
                {suggestion.detail !== '' && (
                  <span className="browser-suggestion__detail">
                    {suggestion.detail}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
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
  const zoomLevel = useBrowserGuests(
    (state) => state.zoom[tabId] ?? DEFAULT_ZOOM_LEVEL
  )
  const addressFocusSeq = useBrowserGuests(
    (state) => state.addressFocusSeq[tabId] ?? 0
  )
  const activeDownloads = useDownloads((state) => state.activeCount)
  const anyDownloads = useDownloads((state) => state.downloads.length > 0)
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  // The context menu lives outside this subtree, so it asks by event rather
  // than by threading a callback through four components.
  useEffect(() => {
    const onOpen = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === tabId) {
        setDiagnosticsOpen(true)
      }
    }
    window.addEventListener(OPEN_DIAGNOSTICS_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_DIAGNOSTICS_EVENT, onOpen)
  }, [tabId])
  const starred = useBrowserFavorite(nav.url)
  const favicon = useBrowserGuests((state) => state.favicon[tabId])
  const findState = useBrowserGuests((state) => state.find[tabId])
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

        <BrowserAddressInput
          value={nav.url}
          onNavigate={onNavigate}
          focusSeq={addressFocusSeq}
          favicon={favicon}
        />

        <div className="browser-toolbar__actions">
          <Tooltip
            label={starred === null ? '즐겨찾기에 추가 (⌘D)' : '즐겨찾기에서 빼기'}
            placement="bottom"
          >
            <button
              type="button"
              className="browser-nav-button"
              aria-pressed={starred !== null}
              onClick={() => toggleFavorite(tabId, nav)}
            >
              <BrowserIcon name={starred === null ? 'star' : 'starFilled'} />
            </button>
          </Tooltip>
          {(activeDownloads > 0 || anyDownloads) && (
            <Tooltip
              label={
                activeDownloads > 0
                  ? `${activeDownloads}개 내려받는 중`
                  : '받은 파일'
              }
              placement="bottom"
            >
              {/* Was a non-interactive <span>: the count was visible and the
                  transfer was not stoppable. */}
              <button
                type="button"
                className="browser-download-badge"
                aria-expanded={downloadsOpen}
                aria-label="다운로드"
                onClick={() => setDownloadsOpen((open) => !open)}
              >
                <BrowserIcon name="download" />
                {activeDownloads > 0 ? activeDownloads : null}
              </button>
            </Tooltip>
          )}
          {downloadsOpen && (
            <BrowserDownloadsPanel onClose={() => setDownloadsOpen(false)} />
          )}
          {diagnosticsOpen && (
            <BrowserDiagnosticsPanel
              tabId={tabId}
              onClose={() => setDiagnosticsOpen(false)}
            />
          )}
          {!isDefaultZoom(zoomLevel) && (
            <Tooltip label="기본 크기로 (⌘0)" placement="bottom">
              <button
                type="button"
                className="browser-zoom-pill"
                onClick={() => {
                  useBrowserGuests.getState().setZoom(tabId, DEFAULT_ZOOM_LEVEL)
                  guestActions.setZoom(tabId, DEFAULT_ZOOM_LEVEL)
                }}
              >
                {zoomPercent(zoomLevel)}%
              </button>
            </Tooltip>
          )}
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
      <AgentRunBanner tabId={tabId} />
      {findState !== undefined && (
        <BrowserFindBar tabId={tabId} state={findState} />
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
  const t = useT()
  const isPanelVisible = usePanelVisible(props.api)

  const nav = useBrowserGuests((state) =>
    tabId !== '' ? state.nav[tabId] : undefined
  )
  const overlay = useBrowserGuests((state) => state.overlay[tabId] ?? null)
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
      // A fresh address dismisses whatever the last load left on screen.
      state.setOverlay(tabId, null)
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

  // Remember where the tab actually is, so restarting does not throw the
  // student back to the URL the tab was opened with. `initialUrl` is excluded
  // from the structural key (layoutPersistence), so this costs no extra write:
  // the parked snapshot carries it on quit and on course switch.
  /**
   * Hand keyboard focus to the page when its tab becomes active.
   *
   * Chrome focuses the document. Without this, activating a browser tab left
   * focus in the host chrome: ↓ and PageDown did nothing, Tab did not move
   * between form fields, and typing went nowhere until the student clicked
   * into the page.
   */
  useEffect(() => {
    if (!isPanelVisible || tabId === '') return undefined
    // One frame, so dockview has finished moving the panel before we take focus.
    const handle = window.requestAnimationFrame(() => {
      guestActions.focus(tabId)
    })
    return () => window.cancelAnimationFrame(handle)
  }, [isPanelVisible, tabId])

  // A visible LMS course page decides where its downloads go.
  useEffect(() => {
    if (!isPanelVisible || navState.url === '') return
    void useDownloads
      .getState()
      .followPage(navState.url, settingsSnapshot().lastActiveCourseId)
      .catch(() => {
        // Falls back to the selected course; nothing to surface.
      })
  }, [isPanelVisible, navState.url])

  useEffect(() => {
    if (tabId === '' || navState.url === '' || navState.url === initialUrl) {
      return
    }
    api.updateParameters({
      descriptor: {
        kind: 'browser',
        payload: { tabId, initialUrl: navState.url }
      }
    })
    useWorkspaceStore.getState().notifyLayoutChanged()
  }, [api, initialUrl, navState.url, tabId])

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
        {overlay !== null ? (
          overlay.kind === 'crashed' ? (
            <BrowserCrashPage tabId={tabId} overlay={overlay} />
          ) : (
            <BrowserErrorPage tabId={tabId} overlay={overlay} />
          )
        ) : (
          /* Shown before first paint / if the guest renderer ever goes away. */
          <div className="browser-anchor__fallback">
            <BrowserIcon name="globe" />
            <span>{hostnameOf(navState.url)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
