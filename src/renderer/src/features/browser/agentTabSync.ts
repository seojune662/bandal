/**
 * Publishes the browser tabs the student can see to main, for the agent.
 *
 * Main cannot work this out on its own. It knows guests through
 * `guestRegistry`, and live guests are capped at `MAX_LIVE_GUESTS` — a hidden
 * guest beyond the cap is destroyed while its tab stays right there on screen,
 * keeping only its last URL in `browserGuestsStore`. An agent listing built
 * from the registry would therefore omit tabs the student is looking at, which
 * is the one thing "what do I have open?" must never do.
 *
 * So the renderer, which owns the tab strip, is the authority. It pushes the
 * list whenever it changes and main just caches it — the same self-healing
 * shape as `browserAgent:registerTab`.
 */

import { useEffect } from 'react'
import { invoke, onPush } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { useBrowserGuests } from './browserGuestsStore'
import type { BrowserNavState } from './browserGuestsStore'
import type { TabDescriptor } from '../../../../shared/tabs'

export interface AgentTab {
  tabId: string
  title: string
  url: string
  /** The guest was evicted; reading this tab has to wake it first. */
  asleep: boolean
}

export interface AgentTabSyncPayload {
  courseId: string
  tabs: AgentTab[]
  activeTabId: string | null
}

export interface TabSyncSources {
  openTabs: Record<string, TabDescriptor>
  nav: Record<string, BrowserNavState | undefined>
  liveTabIds: readonly string[]
  activeTabId: string | null
  courseId: string | null
}

/**
 * The payload for a given renderer state, or null when there is nothing to
 * say. Pure so the ordering and the `asleep` rule can be tested without a DOM.
 */
export function tabSyncPayload(
  sources: TabSyncSources
): AgentTabSyncPayload | null {
  if (sources.courseId === null) return null
  const live = new Set(sources.liveTabIds)
  const tabs: AgentTab[] = []
  for (const descriptor of Object.values(sources.openTabs)) {
    if (!isTabDescriptor(descriptor) || descriptor.kind !== 'browser') continue
    const tabId = descriptor.payload.tabId
    const state = sources.nav[tabId]
    // Before the first commit the descriptor's own URL is all there is.
    const url = state?.url ?? descriptor.payload.initialUrl ?? ''
    tabs.push({
      tabId,
      title: state?.title ?? '',
      url,
      asleep: !live.has(tabId)
    })
  }
  return {
    courseId: sources.courseId,
    tabs,
    activeTabId: sources.activeTabId
  }
}

function currentPayload(): AgentTabSyncPayload | null {
  const workspace = useWorkspaceStore.getState()
  // A course switch empties openTabs mid-hydration; publishing then would
  // briefly tell the agent the student has nothing open.
  if (workspace.hydration !== 'ready') return null
  const guests = useBrowserGuests.getState()
  return tabSyncPayload({
    openTabs: workspace.openTabs,
    nav: guests.nav,
    liveTabIds: guests.liveGuests.map((guest) => guest.tabId),
    activeTabId: workspace.activeBrowserTabId(),
    courseId: workspace.activeCourseId
  })
}

/** Titles arrive keystroke-by-keystroke on some SPAs; one push per settle. */
const SYNC_DEBOUNCE_MS = 200

/** Keeps main's copy of the visible tabs current. */
export function useAgentTabSync(): void {
  useEffect(() => {
    let timer: number | null = null
    let lastSent = ''

    const publish = (): void => {
      timer = null
      const payload = currentPayload()
      if (payload === null) return
      const serialized = JSON.stringify(payload)
      if (serialized === lastSent) return
      lastSent = serialized
      void invoke('browserAgent:syncTabs', payload).catch(() => {
        // The agent simply will not see the tabs; nothing to show the student.
      })
    }

    const schedule = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(publish, SYNC_DEBOUNCE_MS)
    }

    schedule()
    const unsubWorkspace = useWorkspaceStore.subscribe(schedule)
    const unsubGuests = useBrowserGuests.subscribe(schedule)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      unsubWorkspace()
      unsubGuests()
    }
  }, [])
}

/**
 * Brings a tab forward when the agent needs to read one whose guest the LRU
 * dropped. Focusing the existing panel remounts the guest, which re-registers
 * itself and unblocks the waiting tool call.
 */
export function useActivateTabRequests(): void {
  useEffect(
    () =>
      onPush('browser:activate-tab', ({ tabId }) => {
        const workspace = useWorkspaceStore.getState()
        for (const descriptor of Object.values(workspace.openTabs)) {
          if (!isTabDescriptor(descriptor) || descriptor.kind !== 'browser') {
            continue
          }
          if (descriptor.payload.tabId !== tabId) continue
          // openTab focuses an already-open panel rather than duplicating it.
          workspace.openTab(descriptor)
          return
        }
      }),
    []
  )
}
