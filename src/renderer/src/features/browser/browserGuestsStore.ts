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

interface BrowserGuestsState {
  /** Live guests in LRU order (oldest first). */
  liveGuests: LiveGuest[]
  nav: Record<string, BrowserNavState>
  login: Record<string, BrowserLoginState>
  /** Recent pages live only for the lifetime of their browser tab. */
  recent: Record<string, BrowserVisit[]>
  /** undefined = a direct URL tab; true/false = start page visible/hidden. */
  startPageVisible: Record<string, boolean | undefined>
  ensureStartPage: (tabId: string) => void
  ensureGuest: (tabId: string, initialUrl: string) => void
  setStartPageVisible: (tabId: string, visible: boolean) => void
  touchGuest: (tabId: string) => void
  removeGuest: (tabId: string) => void
  updateNav: (tabId: string, patch: Partial<BrowserNavState>) => void
  updateLogin: (tabId: string, patch: Partial<BrowserLoginState>) => void
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

export const useBrowserGuests = create<BrowserGuestsState>()((set, get) => ({
  liveGuests: [],
  nav: {},
  login: {},
  recent: {},
  startPageVisible: {},

  ensureStartPage: (tabId) => {
    const { nav, login, recent, startPageVisible } = get()
    if (startPageVisible[tabId] !== undefined) return
    set({
      nav: { ...nav, [tabId]: nav[tabId] ?? initialNavState('') },
      login: { ...login, [tabId]: login[tabId] ?? initialLoginState() },
      recent: { ...recent, [tabId]: recent[tabId] ?? [] },
      startPageVisible: { ...startPageVisible, [tabId]: true }
    })
  },

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

  setStartPageVisible: (tabId, visible) => {
    const { startPageVisible } = get()
    if (startPageVisible[tabId] === undefined) return
    set({ startPageVisible: { ...startPageVisible, [tabId]: visible } })
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
    const { liveGuests, nav, login, recent, startPageVisible } = get()
    set({
      liveGuests: liveGuests.filter((guest) => guest.tabId !== tabId),
      nav: withoutKeys(nav, [tabId]),
      login: withoutKeys(login, [tabId]),
      recent: withoutKeys(recent, [tabId]),
      startPageVisible: withoutKeys(startPageVisible, [tabId])
    })
  },

  updateNav: (tabId, patch) => {
    const { nav, recent } = get()
    const current = nav[tabId]
    if (current === undefined) return
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
  }
}))

/** Test-only: reset the store and the session URL-restore map. */
export function resetBrowserGuestsForTests(): void {
  lastKnownUrls.clear()
  useBrowserGuests.setState({
    liveGuests: [],
    nav: {},
    login: {},
    recent: {},
    startPageVisible: {}
  })
}
