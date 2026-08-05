/**
 * Workspace store: owns which course's layout is mounted in dockview, the
 * open/close/activate tab API, and per-course layout persistence.
 *
 * Persistence design (see docs/orca-analysis.md §5):
 *  - NO zustand persist middleware. Hydration is explicit and ordered:
 *    course switch → flush pending save → `layout:get` → validate hard →
 *    `fromJSON` (or empty layout on any failure).
 *  - Saves are debounced (1s) and only scheduled for *structural* changes
 *    (open/close/move/resize). Decorative churn — focus/active-tab changes —
 *    refreshes the pending snapshot but never starts a save on its own.
 *  - `flushPendingSave` runs on course switch and on `beforeunload`.
 *  - Rapid course switching is guarded with a monotonic serial: stale
 *    `layout:get` responses are discarded.
 *
 * The dockview `DockviewApi` is imperative and lives outside React state;
 * `WorkspaceHost` attaches it once ready.
 */

import { create } from 'zustand'
import type { DockviewApi } from 'dockview'
import type { TabDescriptor } from '../../../shared/tabs'
import { invoke } from '../lib/ipc'
import { tabPanelId, tabTitle } from '../features/workspace/tabIdentity'
import {
  LAYOUT_SAVE_DEBOUNCE_MS,
  structuralKey,
  tabsFromLayout,
  validateLayout
} from '../features/workspace/layoutPersistence'

export type WorkspaceHydration = 'idle' | 'loading' | 'ready'

interface WorkspaceState {
  /** Course whose layout is (being) mounted; null = no course selected. */
  activeCourseId: string | null
  hydration: WorkspaceHydration
  /** Mirror of the descriptors currently open in dockview, by panel id. */
  openTabs: Record<string, TabDescriptor>
  attachApi: (api: DockviewApi) => void
  detachApi: () => void
  /** Swap the whole layout: save current course, hydrate the target. */
  setActiveCourse: (courseId: string | null) => void
  /** Open a tab, focusing the existing panel when the identity matches. */
  openTab: (descriptor: TabDescriptor) => void
  closeTab: (panelId: string) => void
  closeOthers: (panelId: string) => void
  /** Wired to dockview's onDidLayoutChange by WorkspaceHost. */
  notifyLayoutChanged: () => void
  /** Send any pending save immediately (course switch / beforeunload). */
  flushPendingSave: () => void
}

interface PendingSave {
  courseId: string
  layout: unknown
}

// Imperative, non-reactive internals.
let api: DockviewApi | null = null
let switchSerial = 0
let suppressLayoutEvents = false
let lastStructuralKey = ''
let pendingSave: PendingSave | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function sameTabs(
  a: Record<string, TabDescriptor>,
  b: Record<string, TabDescriptor>
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return (
    aKeys.length === bKeys.length && aKeys.every((key) => b[key] !== undefined)
  )
}

function sendSave(save: PendingSave): void {
  void invoke('layout:save', {
    courseId: save.courseId,
    layout: save.layout
  }).catch((error: unknown) => {
    console.error('[Bandal] 레이아웃을 저장하지 못했습니다.', error)
  })
}

function clearSaveTimer(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
  const flush = (): void => {
    clearSaveTimer()
    if (pendingSave === null) return
    const save = pendingSave
    pendingSave = null
    sendSave(save)
  }

  const scheduleSave = (courseId: string, layout: unknown): void => {
    pendingSave = { courseId, layout }
    clearSaveTimer()
    saveTimer = setTimeout(flush, LAYOUT_SAVE_DEBOUNCE_MS)
  }

  const clearDockview = (): void => {
    if (api === null) return
    suppressLayoutEvents = true
    try {
      api.clear()
    } finally {
      suppressLayoutEvents = false
    }
  }

  const hydrate = async (courseId: string, serial: number): Promise<void> => {
    if (api === null) return // attachApi re-runs hydration once ready
    set({ hydration: 'loading' })

    let raw: unknown = null
    try {
      raw = (await invoke('layout:get', { courseId })).layout
    } catch (error) {
      console.error('[Bandal] 레이아웃을 불러오지 못했습니다.', error)
    }
    // A newer switch won the race — drop this hydration entirely.
    if (serial !== switchSerial || api === null) return

    const validated = raw === null ? null : validateLayout(raw)
    suppressLayoutEvents = true
    try {
      api.clear()
      if (validated !== null) api.fromJSON(validated.layout)
    } catch (error) {
      console.error(
        '[Bandal] 저장된 레이아웃이 손상되어 빈 화면으로 시작합니다.',
        error
      )
      try {
        api.clear()
      } catch {
        // dockview is already empty; nothing more to recover.
      }
    } finally {
      suppressLayoutEvents = false
    }

    const live = api.toJSON()
    lastStructuralKey = structuralKey(live)
    set({ openTabs: tabsFromLayout(live), hydration: 'ready' })

    // Persist the cleaned document when validation dropped anything, so the
    // next hydration starts from a healthy file.
    if (validated !== null && validated.droppedPanelIds.length > 0) {
      scheduleSave(courseId, live)
    }
  }

  return {
    activeCourseId: null,
    hydration: 'idle',
    openTabs: {},

    attachApi: (nextApi) => {
      api = nextApi
      lastStructuralKey = ''
      const { activeCourseId } = get()
      if (activeCourseId === null) {
        set({ hydration: 'ready', openTabs: {} })
        return
      }
      void hydrate(activeCourseId, ++switchSerial)
    },

    detachApi: () => {
      flush()
      api = null
      set({ hydration: 'idle', openTabs: {} })
    },

    setActiveCourse: (courseId) => {
      if (get().activeCourseId === courseId) return
      const serial = ++switchSerial
      flush() // persist the outgoing course's layout before swapping
      set({
        activeCourseId: courseId,
        openTabs: {},
        hydration: courseId === null ? 'ready' : 'loading'
      })
      lastStructuralKey = ''
      if (courseId === null) {
        clearDockview()
        return
      }
      void hydrate(courseId, serial)
    },

    openTab: (descriptor) => {
      if (api === null) return
      const panelId = tabPanelId(descriptor)
      const existing = api.getPanel(panelId)
      if (existing !== undefined) {
        existing.api.setActive()
        return
      }
      api.addPanel({
        id: panelId,
        component: descriptor.kind,
        title: tabTitle(descriptor),
        params: { descriptor }
      })
    },

    closeTab: (panelId) => {
      if (api === null) return
      api.getPanel(panelId)?.api.close()
    },

    closeOthers: (panelId) => {
      if (api === null) return
      for (const panel of [...api.panels]) {
        if (panel.id !== panelId) panel.api.close()
      }
    },

    notifyLayoutChanged: () => {
      if (suppressLayoutEvents || api === null) return
      const { activeCourseId, hydration, openTabs } = get()
      if (activeCourseId === null || hydration !== 'ready') return

      const layout = api.toJSON()
      const tabs = tabsFromLayout(layout)
      if (!sameTabs(openTabs, tabs)) set({ openTabs: tabs })

      const key = structuralKey(layout)
      if (key === lastStructuralKey) {
        // Decorative churn (focus change). Refresh a pending snapshot so an
        // already-scheduled save carries the latest active tab, but never
        // start a save for focus alone.
        if (pendingSave !== null && pendingSave.courseId === activeCourseId) {
          pendingSave = { courseId: activeCourseId, layout }
        }
        return
      }
      lastStructuralKey = key
      scheduleSave(activeCourseId, layout)
    },

    flushPendingSave: () => {
      flush()
    }
  }
})

/** Test-only: reset the store's imperative internals and state. */
export function resetWorkspaceStoreForTests(): void {
  clearSaveTimer()
  api = null
  switchSerial = 0
  suppressLayoutEvents = false
  lastStructuralKey = ''
  pendingSave = null
  useWorkspaceStore.setState({
    activeCourseId: null,
    hydration: 'idle',
    openTabs: {}
  })
}
