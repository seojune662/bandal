import { openDiagnostics } from './diagnosticsBridge'
import { useCourseActive } from '../workspace/courseActivity'
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
import { showToast } from '../../app/toast'
import { DEFAULT_BROWSER_URL } from '../../app/tabCommands'
import { Tooltip } from '../../components/Tooltip'
import { useT } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { favoriteScopeKey, useFavoritesStore } from '../../stores/favoritesStore'
import { settingsSnapshot } from '../../stores/settingsSnapshot'
import { browserTabCourseId, useWorkspaceStore } from '../../stores/workspaceStore'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { useBrowserAnchorRect } from '../workspace/panels/browserAnchor'
import { BrowserIcon } from './browserIcons'
import {
  initialNavState,
  useBrowserGuests,
  type BrowserNavState
} from './browserGuestsStore'
import { BrowserCrashPage, BrowserErrorPage } from './BrowserErrorPage'
import { BrowserDownloadPage } from './BrowserDownloadPage'
import { BrowserDownloadsPanel } from './BrowserDownloadsPanel'
import { BrowserDiagnosticsPanel } from './BrowserDiagnosticsPanel'
import { OPEN_DIAGNOSTICS_EVENT } from './diagnosticsBridge'
import { isDefaultZoom, zoomPercent } from './zoom'
import { useDownloads } from './downloadsStore'
import { toggleFavorite, useBrowserFavorite } from './browserFavorite'
import { BrowserFindBar } from './BrowserFindBar'
import { AgentRunBanner } from './AgentRunBanner'
import {
  browserFavoriteShortcuts,
  hostnameForUrl,
  initialForUrl,
  toneForUrl,
  type BrowserShortcut
} from './browserStartPageModel'
import { guestActions } from './guestActions'
import {
  discardStagedLoginForTab,
  fillLoginForTab,
  saveStagedLoginForTab
} from './loginBridge'
import { BrowserProfilePicker } from './BrowserProfilePicker'
import { BrowserImportBanner } from './BrowserImportDialog'
import { BrowserAddressInput } from './BrowserAddressInput'
import { scheduleProgressVisibility } from './loadingIndicator'
import { openWebVideoInPip, useWebVideoReport } from './videoBridge'
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
  isPrivate: boolean
  onTogglePrivate: () => void
  profileId: string
  onProfileChange: (id: string) => Promise<void>
}

function usePanelVisible(api: IDockviewPanelProps['api']): boolean {
  const courseActive = useCourseActive()
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

  return courseActive && visible
}

function useBrowserFavoriteShortcuts(profileId: string): BrowserShortcut[] {
  const courseId = useWorkspaceStore((state) => state.activeCourseId)
  const key = favoriteScopeKey(courseId)
  const stored = useFavoritesStore((state) => state.byCourse[key])
  const global = useFavoritesStore((state) => state.byCourse[favoriteScopeKey(null)])
  const load = useFavoritesStore((state) => state.load)

  useEffect(() => {
    for (const scope of courseId === null ? [null] : [courseId, null]) {
      const state = useFavoritesStore.getState()
      const scopeKey = favoriteScopeKey(scope)
      if (state.byCourse[scopeKey] === undefined && !state.loadingByCourse[scopeKey]) void load(scope)
    }
  }, [courseId, load])

  return useMemo(() => browserFavoriteShortcuts([...(stored ?? []), ...(courseId === null ? [] : global ?? [])], profileId), [stored, global, courseId, profileId])
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

export function BrowserFavoriteButton({
  starred,
  onToggle
}: {
  starred: boolean
  onToggle: () => void
}): JSX.Element {
  const ariaLabel = starred ? '즐겨찾기에서 제거' : '즐겨찾기에 추가'
  return (
    <Tooltip
      label={starred ? '즐겨찾기에서 빼기' : '즐겨찾기에 추가 (⌘D)'}
      placement="bottom"
    >
      <button
        type="button"
        className="browser-nav-button"
        aria-label={ariaLabel}
        aria-pressed={starred}
        onClick={onToggle}
      >
        <BrowserIcon name={starred ? 'starFilled' : 'star'} />
      </button>
    </Tooltip>
  )
}

export function BrowserPipChip({
  hasPlayingVideo,
  onOpen
}: {
  hasPlayingVideo: boolean
  onOpen: () => void
}): JSX.Element | null {
  if (!hasPlayingVideo) return null
  return (
    <button
      type="button"
      className="browser-login-button"
      aria-label="작은 창으로 보기"
      onClick={onOpen}
    >
      <BrowserIcon name="pip" />
      PiP
    </button>
  )
}

export function BrowserLoginPrompt({
  kind,
  onSave,
  onDecline,
  onSuppress
}: {
  kind: 'save' | 'update'
  onSave: () => void
  onDecline: () => void
  onSuppress: () => void
}): JSX.Element {
  return (
    <div className="browser-external-auth browser-login-prompt" role="status">
      <BrowserIcon name="key" />
      <span className="browser-external-auth__message">
        {kind === 'update'
          ? '비밀번호를 업데이트할까요?'
          : '이 사이트 로그인을 저장할까요?'}
      </span>
      <button
        type="button"
        className="browser-login-prompt__action browser-login-prompt__action--primary"
        onClick={onSave}
      >
        저장
      </button>
      <button
        type="button"
        className="browser-login-prompt__action"
        onClick={onDecline}
      >
        이번엔 안 함
      </button>
      <button
        type="button"
        className="browser-login-prompt__action"
        onClick={onSuppress}
      >
        이 사이트는 묻지 않기
      </button>
    </div>
  )
}

function BrowserToolbar({
  tabId,
  nav,
  onNavigate,
  isPrivate,
  onTogglePrivate,
  profileId,
  onProfileChange
}: ToolbarProps): JSX.Element {
  const video = useWebVideoReport(tabId)
  const login = useBrowserGuests((state) => state.login[tabId])
  const zoomLevel = useBrowserGuests(
    (state) =>
      state.zoom[tabId] ?? settingsSnapshot().browser.defaultZoomLevel
  )
  const addressFocusSeq = useBrowserGuests(
    (state) => state.addressFocusSeq[tabId] ?? 0
  )
  const activeDownloads = useDownloads((state) => state.activeCount)
  const anyDownloads = useDownloads((state) => state.downloads.length > 0)
  const [downloadsAnchor, setDownloadsAnchor] = useState<DOMRect | null>(null)
  const [diagnosticsAnchor, setDiagnosticsAnchor] = useState<DOMRect | null>(null)
  const [progressVisible, setProgressVisible] = useState(false)
  const toolbarActionsRef = useRef<HTMLDivElement>(null)

  useEffect(
    () => scheduleProgressVisibility(nav.loading, setProgressVisible),
    [nav.loading]
  )

  // The context menu lives outside this subtree, so it asks by event rather
  // than by threading a callback through four components.
  useEffect(() => {
    const onOpen = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === tabId) {
        const anchor = toolbarActionsRef.current?.getBoundingClientRect()
        if (anchor !== undefined) setDiagnosticsAnchor(anchor)
      }
    }
    window.addEventListener(OPEN_DIAGNOSTICS_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_DIAGNOSTICS_EVENT, onOpen)
  }, [tabId])
  const starred = useBrowserFavorite(nav.url, profileId)
  const favicon = useBrowserGuests((state) => state.favicon[tabId])
  const findState = useBrowserGuests((state) => state.find[tabId])
  const loginTooltip =
    `${login?.savedLogin?.username ?? ''} 계정으로 안전하게 채웁니다.`

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
          <Tooltip label="홈" placement="bottom">
            <button
              type="button"
              className="browser-nav-button"
              aria-label="홈페이지로 이동"
              onClick={() => {
                const homePage = settingsSnapshot().browser.homePage
                onNavigate(homePage !== '' ? homePage : DEFAULT_BROWSER_URL)
              }}
            >
              <BrowserIcon name="home" />
            </button>
          </Tooltip>
        </div>

        <BrowserAddressInput
          value={nav.url}
          onNavigate={onNavigate}
          focusSeq={addressFocusSeq}
          favicon={favicon}
          isPrivate={isPrivate}
          profileId={profileId}
        />

        <div ref={toolbarActionsRef} className="browser-toolbar__actions">
          <BrowserProfilePicker profileId={profileId} onChange={onProfileChange} />
          <Tooltip
            label={isPrivate ? '시크릿 모드 끄기' : '이 탭을 시크릿 모드로 전환'}
            placement="bottom"
          >
            <button
              type="button"
              className="browser-nav-button browser-private-button"
              aria-label={isPrivate ? '시크릿 모드 끄기' : '시크릿 모드 켜기'}
              aria-pressed={isPrivate}
              onClick={onTogglePrivate}
            >
              <BrowserIcon name="private" />
            </button>
          </Tooltip>
          <BrowserPipChip
            hasPlayingVideo={video?.hasPlayingVideo === true}
            onOpen={() => {
              void openWebVideoInPip(tabId, {
                url: nav.url,
                title: nav.title
              }).catch(() => {
                showToast('작은 창을 열지 못했어요.', 'danger')
              })
            }}
          />
          {!isPrivate && (
            <BrowserFavoriteButton
              starred={starred !== null}
              onToggle={() => toggleFavorite(tabId, nav)}
            />
          )}
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
                aria-expanded={downloadsAnchor !== null}
                aria-label="다운로드"
                onClick={(event) => {
                  if (downloadsAnchor !== null) {
                    setDownloadsAnchor(null)
                    return
                  }
                  setDiagnosticsAnchor(null)
                  setDownloadsAnchor(event.currentTarget.getBoundingClientRect())
                }}
              >
                <BrowserIcon name="download" />
                {activeDownloads > 0 ? activeDownloads : null}
              </button>
            </Tooltip>
          )}
          {downloadsAnchor !== null && (
            <BrowserDownloadsPanel
              anchor={downloadsAnchor}
              onClose={() => setDownloadsAnchor(null)}
            />
          )}
          {diagnosticsAnchor !== null && (
            <BrowserDiagnosticsPanel
              tabId={tabId}
              anchor={diagnosticsAnchor}
              onClose={() => setDiagnosticsAnchor(null)}
            />
          )}
          {!isDefaultZoom(
            zoomLevel,
            settingsSnapshot().browser.defaultZoomLevel
          ) && (
            <Tooltip label="기본 크기로 (⌘0)" placement="bottom">
              <button
                type="button"
                className="browser-zoom-pill"
                onClick={() => {
                  const defaultZoomLevel =
                    settingsSnapshot().browser.defaultZoomLevel
                  useBrowserGuests.getState().setZoom(tabId, defaultZoomLevel)
                  guestActions.setZoom(tabId, defaultZoomLevel)
                }}
              >
                {zoomPercent(zoomLevel)}%
              </button>
            </Tooltip>
          )}
          {login?.hasLoginForm === true &&
            login.usernameFocused &&
            login.origin !== null &&
            login.savedLogins.length > 0 && (
            <div className="browser-login-action">
              {login.savedLogins.length > 1 ? (
                <select
                  aria-label="저장된 로그인 계정 선택"
                  className="browser-login-account"
                  value=""
                  disabled={login.pending}
                  onChange={(event) => {
                    if (event.target.value) void fillLoginForTab(tabId, event.target.value)
                  }}
                >
                  <option value="">계정을 선택해 채우기</option>
                  {login.savedLogins.map((account) => (
                    <option key={account.id} value={account.id}>{account.username || account.origin}</option>
                  ))}
                </select>
              ) : (
              <Tooltip label={loginTooltip} placement="bottom">
                <button
                  type="button"
                  className="browser-login-button"
                  disabled={login.pending}
                  onClick={() => void fillLoginForTab(tabId)}
                >
                  <BrowserIcon name="key" />
                  {login.pending
                    ? '처리 중…'
                    : '저장된 로그인 채우기'}
                </button>
              </Tooltip>
              )}
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
        data-active={progressVisible ? 'true' : undefined}
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
  // This owner survives a course change while a native profile decision awaits.
  const [ownerCourse] = useState(() => browserTabCourseId(tabId))
  const initialUrl = payload?.initialUrl ?? ''
  const initialPrivate = payload?.isPrivate === true
  const [isPrivate, setPrivate] = useState(initialPrivate)
  const [profileId, setProfileId] = useState(payload?.profileId ?? 'default')

  const anchorRef = useRef<HTMLDivElement>(null)
  useBrowserAnchorRect(tabId, anchorRef)
  const t = useT()
  const isPanelVisible = usePanelVisible(props.api)

  const nav = useBrowserGuests((state) =>
    tabId !== '' ? state.nav[tabId] : undefined
  )
  const overlay = useBrowserGuests((state) => state.overlay[tabId] ?? null)
  const login = useBrowserGuests((state) => state.login[tabId])
  const authFallback = useBrowserGuests((state) => state.authFallback[tabId])
  const navState = nav ?? initialNavState(initialUrl)
  const favorites = useBrowserFavoriteShortcuts(profileId)

  const navigate = useCallback(
    (url: string): void => {
      if (tabId === '') return
      const state = useBrowserGuests.getState()
      if (state.liveGuests.some((guest) => guest.tabId === tabId)) {
        guestActions.navigate(tabId, url)
      } else {
        state.ensureGuest(tabId, url, isPrivate, profileId, ownerCourse)
      }
      // A fresh address dismisses whatever the last load left on screen.
      state.setOverlay(tabId, null)
    },
    [isPrivate, tabId, profileId, ownerCourse]
  )

  // Unvisited background tabs stay cheap; a visited page remains alive when hidden.
  useEffect(() => {
    if (tabId !== '' && isPanelVisible) {
      useBrowserGuests.getState().ensureGuest(tabId, initialUrl, isPrivate, profileId, ownerCourse)
    }
  }, [isPrivate, tabId, initialUrl, profileId, isPanelVisible, ownerCourse])

  const togglePrivate = useCallback((): void => {
    if (tabId === '') return
    void (async () => {
      const { allowed } = await invoke('browser:prepareProfileSwitch', { tabId })
      if (!allowed) return
      const next = !isPrivate
      const url = navState.url || initialUrl
      setPrivate(next)
      props.api.updateParameters({
        descriptor: {
          kind: 'browser',
          payload: {
            tabId,
            initialUrl: url,
            profileId,
            ...(next ? { isPrivate: true } : {})
          }
        }
      })
      useBrowserGuests.getState().ensureGuest(tabId, url, next, profileId, ownerCourse)
      useWorkspaceStore.getState().notifyLayoutChanged()
    })().catch(console.error)
  }, [initialUrl, isPrivate, navState.url, props.api, tabId, profileId, ownerCourse])

  const changeProfile = useCallback(async (id: string): Promise<void> => {
    if (id === profileId) return
    const { allowed } = await invoke('browser:prepareProfileSwitch', { tabId })
    if (!allowed) return
    const url = navState.url || initialUrl
    props.api.updateParameters({ descriptor: { kind: 'browser', payload: { tabId, initialUrl: url, isPrivate, profileId: id } } })
    setProfileId(id)
    useBrowserGuests.getState().ensureGuest(tabId, url, isPrivate, id, ownerCourse)
    useWorkspaceStore.getState().notifyLayoutChanged()
  }, [profileId, tabId, navState.url, initialUrl, props.api, isPrivate, ownerCourse])

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

  useEffect(() => {
    if (tabId === '' || navState.url === '' || navState.url === initialUrl) {
      return
    }
    api.updateParameters({
      descriptor: {
        kind: 'browser',
        payload: {
          tabId,
          initialUrl: navState.url,
          profileId,
          ...(isPrivate ? { isPrivate: true } : {})
        }
      }
    })
    useWorkspaceStore.getState().notifyLayoutChanged()
  }, [api, initialUrl, isPrivate, navState.url, tabId, profileId])

  if (payload === null) {
    return <div className="workspace-panel" data-kind="unknown" />
  }

  return (
    <div
      className="browser-panel"
      data-kind="browser"
      data-private={isPrivate ? 'true' : undefined}
    >
      <BrowserToolbar
        tabId={tabId}
        nav={navState}
        onNavigate={navigate}
        isPrivate={isPrivate}
        onTogglePrivate={togglePrivate}
        profileId={profileId}
        onProfileChange={changeProfile}
      />
      {isPanelVisible &&
        !isPrivate &&
        login?.savePrompt !== null &&
        login?.savePrompt !== undefined && (
          <BrowserLoginPrompt
            kind={login.savePrompt.kind}
            onSave={() => void saveStagedLoginForTab(tabId)}
            onDecline={() => void discardStagedLoginForTab(tabId, false)}
            onSuppress={() => void discardStagedLoginForTab(tabId, true)}
          />
        )}
      <BrowserBookmarksBar favorites={favorites} onNavigate={navigate} />
      {isPanelVisible && !isPrivate && (navState.url === DEFAULT_BROWSER_URL || navState.url === `${DEFAULT_BROWSER_URL}/` || navState.url === 'about:blank') && <BrowserImportBanner key={profileId} profileId={profileId} />}
      {isPanelVisible && (navState.httpStatus ?? 0) >= 400 && (
        <div className="browser-external-auth" role="status">
          <span className="browser-external-auth__message">{`사이트에서 HTTP ${navState.httpStatus} 응답을 보냈어요. 로그인 요청은 자동으로 다시 보내지 않습니다.`}</span>
          <button type="button" className="browser-login-prompt__action" onClick={() => openDiagnostics(tabId)}>진단 보기</button>
        </div>
      )}
      {isPanelVisible && authFallback !== undefined && (
        <div
          className="browser-external-auth"
          role="status"
          aria-live="polite"
        >
          <BrowserIcon name="globe" />
          <span className="browser-external-auth__message">
            {t('browser.authFallback.message')}
          </span>
          <button
            type="button"
            className="browser-login-prompt__action browser-login-prompt__action--primary"
            onClick={() => {
              void invoke('shell:openExternal', { url: authFallback })
            }}
          >
            {t('browser.authFallback.action')}
          </button>
          <button
            type="button"
            className="browser-external-auth__dismiss"
            aria-label={t('browser.authFallback.dismiss')}
            onClick={() =>
              useBrowserGuests.getState().setAuthFallback(tabId, null)
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
          overlay.kind === 'download' ? (
            <BrowserDownloadPage id={overlay.downloadId} />
          ) : overlay.kind === 'crashed' ? (
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
