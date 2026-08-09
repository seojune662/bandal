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
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

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
  ensureGuest: (tabId: string, initialUrl: string) => void
  touchGuest: (tabId: string) => void
  removeGuest: (tabId: string) => void
  updateNav: (tabId: string, patch: Partial<BrowserNavState>) => void
  updateLogin: (tabId: string, patch: Partial<BrowserLoginState>) => void
}

export function initialNavState(url: string): BrowserNavState {
  return {
    url,
    title: '',
    favicon: null,
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

  ensureGuest: (tabId, initialUrl) => {
    const { liveGuests, nav, login } = get()
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
      }
    })
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
    const { liveGuests, nav, login } = get()
    if (!liveGuests.some((guest) => guest.tabId === tabId)) return
    set({
      liveGuests: liveGuests.filter((guest) => guest.tabId !== tabId),
      nav: withoutKeys(nav, [tabId]),
      login: withoutKeys(login, [tabId])
    })
  },

  updateNav: (tabId, patch) => {
    const { nav } = get()
    const current = nav[tabId]
    if (current === undefined) return
    if (typeof patch.url === 'string' && patch.url.length > 0) {
      lastKnownUrls.set(tabId, patch.url)
    }
    set({ nav: { ...nav, [tabId]: { ...current, ...patch } } })
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
  useBrowserGuests.setState({ liveGuests: [], nav: {}, login: {} })
}
