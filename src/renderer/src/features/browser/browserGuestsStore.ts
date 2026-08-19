/**
 * [M3-F] Store of live webview guests + their navigation state.
 *
 * Lifecycle (see browserAnchor.ts for the anchor contract):
 *  - `ensureGuest` — BrowserPanel mount. Creates the guest (or bumps LRU),
 *    evicting the oldest HIDDEN guests beyond MAX_LIVE_GUESTS.
 *  - `touchGuest` — a guest's anchor became visible again.
 *  - `removeGuest` — the workspace no longer has the tab open (closeTab /
 *    course switch) or LRU eviction. The guest's last URL is remembered for
 *    the whole renderer session so a re-created guest restores where it was.
 *
 * Nav state is fed straight from webview DOM events (BrowserGuestView); the
 * legacy `browser:*` invoke channels from the WebContentsView plan are NOT
 * used (contract cleanup is an M5 concern).
 */

import { create } from 'zustand'
import type { SavedLoginSummary } from '../../../../shared/types/credentials'
import type { BrowserOverlay } from './loadError'

export interface BrowserFindState {
  query: string
  /** 1-based position of the highlighted match; 0 = none yet. */
  activeMatch: number
  matchCount: number
  /** Bumped by ⌘F so the input re-focuses even when already open. */
  focusSeq: number
}
import { invoke } from '../../lib/ipc'
import { settingsSnapshot } from '../../stores/settingsSnapshot'
import { getBrowserAnchorRect } from '../workspace/panels/browserAnchor'
import { MAX_LIVE_GUESTS, pickEvictions, touchOrder } from './guestLru'

export interface LiveGuest {
  tabId: string
  /** URL the <webview> element is created with; never changes afterwards. */
  src: string
}

export interface BrowserNavState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserVisit {
  url: string
  title: string
}

export const MAX_RECENT_VISITS = 6

export interface BrowserLoginState {
  origin: string | null
  hasLoginForm: boolean
  savedLogin: SavedLoginSummary | null
  pending: boolean
  message: 'saved' | 'filled' | 'needs-input' | 'failed' | null
}

export interface BrowserExternalAuthNotice {
  id: number
  url: string
}

interface BrowserGuestsState {
  /** Live guests in LRU order (oldest first). */
  liveGuests: LiveGuest[]
  nav: Record<string, BrowserNavState>
  login: Record<string, BrowserLoginState>
  /** Host-window notice that an auth URL moved to the default browser. */
  externalAuthNotice: BrowserExternalAuthNotice | null
  /** Recent pages live only for the lifetime of their browser tab. */
  recent: Record<string, BrowserVisit[]>
  /**
   * Host DOM shown in the tab's anchor INSTEAD of the guest. The guest keeps
   * living (and loading) underneath; only its rect is withheld, so dismissing
   * an overlay never costs a reload. null / absent = show the guest.
   */
  overlay: Record<string, BrowserOverlay | null | undefined>
  /**
   * Chromium zoom level per tab. The store is the source of truth: the level
   * lives on the render process, so a cross-origin navigation drops it and the
   * guest view re-applies from here.
   */
  zoom: Record<string, number | undefined>
  /**
   * Bumped to ask a panel's omnibox to take focus (⌘L). A counter rather than
   * a boolean so pressing ⌘L twice in a row still moves focus back.
   */
  addressFocusSeq: Record<string, number | undefined>
  /** ⌘F bar, per tab. Absent = closed. */
  find: Record<string, BrowserFindState | undefined>
  /** Favicon as a data URL, per tab. Absent = show the generic globe. */
  favicon: Record<string, string | undefined>
  setFavicon: (tabId: string, dataUrl: string | null) => void
  ensureGuest: (tabId: string, initialUrl: string) => void
  requestAddressFocus: (tabId: string) => void
  openFind: (tabId: string) => void
  closeFind: (tabId: string) => void
  setFindQuery: (tabId: string, query: string) => void
  setFindResult: (
    tabId: string,
    result: { activeMatch: number; matchCount: number }
  ) => void
  setOverlay: (tabId: string, overlay: BrowserOverlay | null) => void
  setZoom: (tabId: string, level: number) => void
  touchGuest: (tabId: string) => void
  removeGuest: (tabId: string) => void
  updateNav: (tabId: string, patch: Partial<BrowserNavState>) => void
  updateLogin: (tabId: string, patch: Partial<BrowserLoginState>) => void
  showExternalAuthNotice: (url: string) => void
  dismissExternalAuthNotice: () => void
}

export function initialNavState(url: string): BrowserNavState {
  return {
    url,
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false
  }
}

export function initialLoginState(): BrowserLoginState {
  return {
    origin: null,
    hasLoginForm: false,
    savedLogin: null,
    pending: false,
    message: null
  }
}

/** Last committed URL per tab — survives eviction/destruction for restore. */
const lastKnownUrls = new Map<string, string>()
let nextExternalAuthNoticeId = 0

function visitLabel(url: string, title: string): string {
  const trimmedTitle = title.trim()
  if (trimmedTitle.length > 0) return trimmedTitle
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function canRememberVisit(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function rememberVisit(
  visits: readonly BrowserVisit[],
  url: string,
  title: string
): BrowserVisit[] {
  if (!canRememberVisit(url)) return [...visits]
  return [
    { url, title: visitLabel(url, title) },
    ...visits.filter((visit) => visit.url !== url)
  ].slice(0, MAX_RECENT_VISITS)
}

function withoutKeys<T>(
  nav: Record<string, T>,
  keys: readonly string[]
): Record<string, T> {
  if (keys.length === 0) return nav
  const next = { ...nav }
  for (const key of keys) delete next[key]
  return next
}

/**
 * Remembers a page once it has both a committed URL and a title.
 *
 * Fired from `updateNav` rather than from a navigation event so a page is
 * recorded with the name a student would recognise: `did-navigate` lands
 * before `page-title-updated`, and a history row titled with its own URL is
 * useless in the omnibox.
 */
function recordVisitFrom(
  current: BrowserNavState,
  patch: Partial<BrowserNavState>
): void {
  const url = patch.url ?? current.url
  const title = patch.title ?? current.title
  if (url === '' || title === '') return
  // Same (url, title) as we already reported for this tab: nothing new.
  if (patch.url === undefined && patch.title === undefined) return
  void invoke('browser:recordVisit', {
    url,
    title,
    courseId: settingsSnapshot().lastActiveCourseId
  }).catch(() => {
    // History is a convenience; never let it surface as an error.
  })
}

export const useBrowserGuests = create<BrowserGuestsState>()((set, get) => ({
  liveGuests: [],
  nav: {},
  login: {},
  externalAuthNotice: null,
  recent: {},
  overlay: {},
  zoom: {},
  addressFocusSeq: {},
  find: {},
  favicon: {},

  ensureGuest: (tabId, initialUrl) => {
    const { liveGuests, nav, login, recent } = get()
    if (liveGuests.some((guest) => guest.tabId === tabId)) {
      get().touchGuest(tabId)
      return
    }
    const src = lastKnownUrls.get(tabId) ?? initialUrl
    const grown = [...liveGuests, { tabId, src }]
    const evicted = pickEvictions(
      grown.map((guest) => guest.tabId),
      MAX_LIVE_GUESTS,
      (id) => id !== tabId && getBrowserAnchorRect(id) === null
    )
    const evictedSet = new Set(evicted)
    set({
      liveGuests: grown.filter((guest) => !evictedSet.has(guest.tabId)),
      nav: {
        ...withoutKeys(nav, evicted),
        [tabId]: initialNavState(src)
      },
      login: {
        ...withoutKeys(login, evicted),
        [tabId]: initialLoginState()
      },
      recent: { ...recent, [tabId]: recent[tabId] ?? [] }
    })
  },

  setFavicon: (tabId, dataUrl) => {
    const { favicon } = get()
    if ((favicon[tabId] ?? null) === dataUrl) return
    set({
      favicon:
        dataUrl === null
          ? withoutKeys(favicon, [tabId])
          : { ...favicon, [tabId]: dataUrl }
    })
  },

  openFind: (tabId) => {
    const { find } = get()
    // Re-opening while open must re-focus the field, not reset the query.
    set({
      find: {
        ...find,
        [tabId]: {
          query: find[tabId]?.query ?? '',
          activeMatch: find[tabId]?.activeMatch ?? 0,
          matchCount: find[tabId]?.matchCount ?? 0,
          focusSeq: (find[tabId]?.focusSeq ?? 0) + 1
        }
      }
    })
  },

  closeFind: (tabId) => {
    const { find } = get()
    if (find[tabId] === undefined) return
    set({ find: withoutKeys(find, [tabId]) })
  },

  setFindQuery: (tabId, query) => {
    const { find } = get()
    const current = find[tabId]
    if (current === undefined) return
    set({
      find: {
        ...find,
        // A new query invalidates the old counts; showing them would lie.
        [tabId]: { ...current, query, activeMatch: 0, matchCount: 0 }
      }
    })
  },

  setFindResult: (tabId, result) => {
    const { find } = get()
    const current = find[tabId]
    if (current === undefined) return
    set({ find: { ...find, [tabId]: { ...current, ...result } } })
  },

  requestAddressFocus: (tabId) => {
    const { addressFocusSeq } = get()
    set({
      addressFocusSeq: {
        ...addressFocusSeq,
        [tabId]: (addressFocusSeq[tabId] ?? 0) + 1
      }
    })
  },

  setZoom: (tabId, level) => {
    const { zoom } = get()
    if (zoom[tabId] === level) return
    set({ zoom: { ...zoom, [tabId]: level } })
  },

  setOverlay: (tabId, overlay) => {
    const current = get().overlay
    if ((current[tabId] ?? null) === overlay) return
    set({ overlay: { ...current, [tabId]: overlay } })
  },

  touchGuest: (tabId) => {
    const { liveGuests } = get()
    if (!liveGuests.some((guest) => guest.tabId === tabId)) return
    const order = touchOrder(
      liveGuests.map((guest) => guest.tabId),
      tabId
    )
    const byId = new Map(liveGuests.map((guest) => [guest.tabId, guest]))
    set({
      liveGuests: order
        .map((id) => byId.get(id))
        .filter((guest): guest is LiveGuest => guest !== undefined)
    })
  },

  removeGuest: (tabId) => {
    const { liveGuests, nav, login, recent, overlay, zoom } = get()
    set({
      liveGuests: liveGuests.filter((guest) => guest.tabId !== tabId),
      nav: withoutKeys(nav, [tabId]),
      login: withoutKeys(login, [tabId]),
      recent: withoutKeys(recent, [tabId]),
      overlay: withoutKeys(overlay, [tabId]),
      zoom: withoutKeys(zoom, [tabId]),
      addressFocusSeq: withoutKeys(get().addressFocusSeq, [tabId]),
      find: withoutKeys(get().find, [tabId]),
      favicon: withoutKeys(get().favicon, [tabId])
    })
  },

  updateNav: (tabId, patch) => {
    const { nav, recent } = get()
    const current = nav[tabId]
    if (current === undefined) return
    recordVisitFrom(current, patch)
    const next = { ...current, ...patch }
    if (typeof patch.url === 'string' && patch.url.length > 0) {
      lastKnownUrls.set(tabId, patch.url)
    }

    let nextRecent = recent[tabId] ?? []
    if (typeof patch.url === 'string' && patch.url.length > 0) {
      // A title from the prior page is stale until page-title-updated arrives.
      nextRecent = rememberVisit(nextRecent, patch.url, patch.title ?? '')
    } else if (typeof patch.title === 'string' && current.url.length > 0) {
      nextRecent = rememberVisit(nextRecent, current.url, patch.title)
    }

    set({
      nav: { ...nav, [tabId]: next },
      recent: { ...recent, [tabId]: nextRecent }
    })
  },

  updateLogin: (tabId, patch) => {
    const { login } = get()
    const current = login[tabId]
    if (current === undefined) return
    set({ login: { ...login, [tabId]: { ...current, ...patch } } })
  },

  showExternalAuthNotice: (url) => {
    set({
      externalAuthNotice: { id: ++nextExternalAuthNoticeId, url }
    })
  },

  dismissExternalAuthNotice: () => {
    set({ externalAuthNotice: null })
  }
}))

/** Test-only: reset the store and the session URL-restore map. */
export function resetBrowserGuestsForTests(): void {
  lastKnownUrls.clear()
  nextExternalAuthNoticeId = 0
  useBrowserGuests.setState({
    liveGuests: [],
    nav: {},
    login: {},
    externalAuthNotice: null,
    recent: {},
    overlay: {},
    zoom: {},
    addressFocusSeq: {},
    find: {},
    favicon: {}
  })
}
