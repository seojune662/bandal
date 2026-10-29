/**
 * Workspace store: owns the active and retained course Dockviews, the
 * open/close/activate tab API, and per-course layout persistence.
 *
 * Persistence design (see docs/orca-analysis.md §5):
 *  - NO zustand persist middleware. Hydration is explicit and ordered:
 *    course switch → flush pending save → `layout:get` → validate hard →
 *    `fromJSON` (read failures retain the saved layout for an explicit retry).
 *  - Saves are debounced (1s) and only scheduled for *structural* changes
 *    (open/close/move/resize). Decorative churn — focus/active-tab changes —
 *    refreshes the pending snapshot but never starts a save on its own.
 *  - `flushPendingSave` runs on course switch and on `beforeunload`.
 *  - Rapid course switching is guarded with a monotonic serial: stale
 *    `layout:get` responses are discarded.
 *
 * The dockview `DockviewApi` is imperative and lives outside React state;
 * `WorkspaceHost` attaches each retained API; `api` points at the active one.
 */

import { create } from 'zustand'
import type { DockviewApi, IDockviewPanel } from 'dockview'
import { isTabDescriptor } from '../../../shared/tabs'
import type { TabDescriptor } from '../../../shared/tabs'
import type { LearningBinding } from '../../../shared/types/learning'
import { workspaceKey, workspaceFromKey, workspaceLayoutScope, type WorkspaceRef } from '../../../shared/types/workspace'
import { DEFAULT_WORKSPACE_WINDOW_ID, isWorkspaceWindows, readWorkspaceWindows, workspaceWindowKey, workspaceWindowFromKey, type WorkspaceWindowInfo, type WorkspaceWindows, type WorkspaceChromeMode } from '../../../shared/workspaceWindows'
import { remapWorkspacePanelIds } from '../../../shared/workspacePanelIds'
import { migrateLearningLayout } from '../features/workspace/learningLayoutMigration'
import { isPageNoteSource } from '../../../shared/pdfPageNote'
import { showToast } from '../app/toast'
import { invoke } from '../lib/ipc'
import { settingsSnapshot } from './settingsSnapshot'
import { rememberedRightRailScopes, useUiStore } from './uiStore'
import { rememberWorkspace } from '../features/workspace/workspaceSelection'
import { useWorkspaceAssistantStore } from '../features/assistantPanel/workspaceAssistantStore'
import { tabPanelId, tabTitle } from '../features/workspace/tabIdentity'
import {
  createDuplicatePanelId,
  duplicateTabDescriptor,
  panelIdMatchesDescriptor
} from '../features/workspace/tabDuplication'
import { canCloseTab } from '../features/workspace/tabCloseGuard'
import { flushOpenNoteSession } from '../features/notes/noteSessionRegistry'
import { flushDocumentSaves } from '../features/documents/saveRegistry'
import { rebindPanelContent } from '../features/workspace/panelContentHost'
import type { WorkspaceTarget } from '../features/workspace/placementContext'
import { closeWorkspacePanel } from '../features/workspace/workspaceLayout'
import { useBrowserGuests } from '../features/browser/browserGuestsStore'
import {
  LAYOUT_SAVE_DEBOUNCE_MS,
  persistentLayout,
  structuralKey,
  tabsFromLayout,
  validateLayout
} from '../features/workspace/layoutPersistence'

export type WorkspaceHydration = 'idle' | 'loading' | 'ready' | 'error'
export type WorkspaceSurface = 'course' | 'learning-home' | 'study-market' | 'community'

function finishMaterialOpen(descriptor: TabDescriptor, background = false): void {
  if (!background && ['pdf', 'note', 'image', 'file', 'recording', 'whiteboard', 'learning-resource'].includes(descriptor.kind)) {
    useUiStore.getState().closeMaterialsExpanded({ returnFocus: false })
  }
}

interface WorkspaceState {
  /** Global home keeps the selected course and its live layout intact. */
  surface: WorkspaceSurface
  showStudyMarket: () => void
  showCommunity: () => void
  showLearningHome: () => void
  showCourseWorkspace: (courseId: string | null) => void
  prepareCloseLearningSpace: (binding: LearningBinding, standalone: boolean) => Promise<boolean>
  closeLearningSpace: (binding: LearningBinding, standalone: boolean) => Promise<boolean>
  /** Course whose layout is (being) mounted; null = no course selected. */
  activeWorkspaceKey: string | null
  activeWindowKey: string | null
  activeWindowId: string | null
  windows: WorkspaceWindowInfo[]
  workspaceChromeMode: WorkspaceChromeMode
  windowsOverviewOpen: boolean
  selectWindow: (windowId: string) => void
  createWindow: () => string | null
  renameWindow: (windowId: string, name: string) => void
  reorderWindows: (windowIds: string[]) => void
  closeWindow: (windowId: string) => Promise<boolean>
  setWorkspaceChromeMode: (mode: WorkspaceChromeMode) => void
  toggleWindowsOverview: () => void
  setWindowsOverviewOpen: (open: boolean) => void
  attachWindowApi: (windowKey: string | null, api: DockviewApi) => void
  detachWindowApi: (windowKey: string | null) => void
  activeWorkspace: WorkspaceRef | null
  /** Physical owner retained for resource APIs. Never an encoded workspace key. */
  activeCourseId: string | null
  setActiveWorkspace: (workspace: WorkspaceRef | null) => void
  afterWorkspaceTransition: (action: () => void) => void
  showWorkspace: (workspace: WorkspaceRef | null) => void
  showWorkspaceWindow: (workspace: WorkspaceRef, windowId: string) => void
  /** Actual Dockview identity, including duplicate instances. */
  activePanelId: string | null
  hydration: WorkspaceHydration
  retryHydration: () => void
  /** Mirror of the descriptors currently open in dockview, by panel id. */
  openTabs: Record<string, TabDescriptor>
  attachCourseApi: (courseId: string | null, api: DockviewApi) => void
  detachCourseApi: (courseId: string | null) => void
  attachApi: (api: DockviewApi) => void
  detachApi: () => void
  /** Swap the whole layout: save current course, hydrate the target. */
  setActiveCourse: (courseId: string | null) => void
  /** Open a tab, focusing the existing panel when the identity matches. */
  openTab: (
    descriptor: TabDescriptor,
    options?: {
      newInstance?: boolean
      /** Open a document alongside the current recording or other panel. */
      beside?: boolean
      /** ⌘-click: open it but stay where you are, as every browser does. */
      background?: boolean
      target?: WorkspaceTarget
      /** Recheck request ownership when a delayed open is replayed after hydration. */
      shouldOpen?: () => boolean
      /** The exact created/reused panel, including delayed and duplicate opens. */
      onOpened?: (panelId: string) => void
    }
  ) => void
  /** Opens one PDF and its page-matched note as a persisted 50:50 pair. */
  openPdfNotePair: (
    pdf: TabDescriptor,
    note: TabDescriptor,
    connectionId: string,
    initialPage: number
  ) => void
  /** Closes the canonical tab and all its duplicate views. */
  closeTabsMatching: (descriptor: TabDescriptor) => void
  closeTab: (panelId: string) => Promise<void>
  saveRetainedLayout: (courseId: string | null, layout: ReturnType<DockviewApi['toJSON']>) => void
  rememberDetachedBrowserPage: (tabId: string, url: string, title: string) => void
  closeOthers: (panelId: string, scope?: 'group' | 'workspace') => Promise<void>
  closeTabs: (panelIds: readonly string[]) => Promise<void>
  /** [M6-A] ⌘W: close the focused tab; no tab → no-op (never the window). */
  closeActiveTab: () => Promise<void>
  /** [M6-A] ⌘1..8: activate the nth open tab (0-based); out of range → no-op. */
  activateTabAt: (index: number) => void
  activatePanel: (panelId: string) => void
  /** ⌘9: the LAST tab, following browser convention rather than the 9th. */
  activateLastTab: () => void
  /** ⌃Tab / ⌘⇧[ ] — wraps at both ends. */
  activateRelativeTab: (delta: number) => void
  /** ⌘⇧T. Re-opens the most recently closed tab of the current course. */
  reopenClosedTab: () => void
  /**
   * tabId of the focused browser tab, or null when the active tab is anything
   * else. Browser-only chords (⌘R, ⌘L, zoom) are no-ops over a PDF or a note.
   */
  activeBrowserTabId: () => string | null
  /** The descriptor of whatever tab is focused, for ⌘P and the like. */
  activeTabDescriptor: () => TabDescriptor | null
  activePanelSource: () => { panelId: string; descriptor: TabDescriptor } | null
  /** Wired to dockview's onDidLayoutChange by WorkspaceHost. */
  notifyLayoutChanged: () => void
  /** Send immediately; transitions await the durable ACK, legacy callers may ignore it. */
  flushPendingSave: () => Promise<void>
  /**
   * [M5] Drop a pending save for a course that no longer exists
   * (delete/archive) — saving it would fail against the dead course row.
   */
  discardPendingSave: (courseId: string) => void
  discardWorkspace: (workspace: WorkspaceRef) => void
}

interface PendingSave {
  courseId: string
  layout: unknown
  exhausted: boolean
  revision: number
}

interface ActiveSave {
  saves: PendingSave[]
  failures: number
  inFlight: boolean
  retryTimer: ReturnType<typeof setTimeout> | null
}

// Imperative, non-reactive internals.
let api: DockviewApi | null = null
let activePanelSubscription: { dispose(): void } | null = null
let retainedMode = false
const courseApis = new Map<string | null, DockviewApi>()
const hydratedCourses = new Set<string>()
const pendingOpens = new Map<string, (() => void)[]>()

/** Recent user closures retain their location; private pages never enter history. */
const CLOSED_TAB_LIMIT = 10
interface ClosedTab {
  courseId: string | null
  panelId: string
  descriptor: TabDescriptor
  title: string
  params: Record<string, unknown>
  groupId: string | undefined
  index: number
}
let closedTabs: ClosedTab[] = []
/** Full, unfiltered layouts for course switching inside this renderer run. */
const runtimeLayouts = new Map<string, unknown>()
const discardedCourses = new Set<string>()
const windowCollections = new Map<string, WorkspaceWindows>()
const envelopeWorkspaces = new Set<string>()
const requestedWindowSelections = new Map<string, string>()
const closingWindows = new Set<string>()
interface OwnedWorkspaceOpen { requestId: string; key: string; descriptor: TabDescriptor; background: boolean; followSavedSelection: boolean; newInstance?: boolean; groupId?: string; shouldOpen?: () => boolean; onOpened?: (panelId: string) => void }
const ownedWorkspaceOpens = new Map<string, OwnedWorkspaceOpen>()
let suppressWorkspacePublish = false
const windowRemovedListeners = new Set<(workspaceKey: string, windowId: string) => void>()
export function onWorkspaceWindowRemoved(listener: (workspaceKey: string, windowId: string) => void): () => void {
  windowRemovedListeners.add(listener); return () => { windowRemovedListeners.delete(listener) }
}
function publishWindowRemoved(key: string): void {
  const { workspaceKey, windowId } = workspaceWindowFromKey(key)
  for (const listener of windowRemovedListeners) listener(workspaceKey, windowId)
}
let beforeWindowLeave: ((windowKey: string) => void | Promise<void>) | null = null
let transitionIntent = 0
let requestedTransitionKey: string | null | undefined
export function registerBeforeWorkspaceWindowLeave(callback: (windowKey: string) => void | Promise<void>): () => void {
  beforeWindowLeave = callback
  return () => { if (beforeWindowLeave === callback) beforeWindowLeave = null }
}
/** Capture the selected destination while its previous canvas is still visible.
 * Resolve a cold workspace's saved window now, before later async file work. */
export function capturePendingWorkspaceTarget(): Promise<WorkspaceTarget> | undefined {
  const key = requestedTransitionKey
  if (!key || key === useWorkspaceStore.getState().activeWindowKey) return undefined
  const parsed = workspaceWindowFromKey(key), workspace = workspaceFromKey(key)
  const groupId = workspaceApiForWindow(key)?.activeGroup?.id
  const target = { courseId: workspace.courseId, workspace, windowId: parsed.windowId, ...(groupId ? { groupId } : {}) }
  if (parsed.windowId !== DEFAULT_WORKSPACE_WINDOW_ID || loadedWindowCollection(parsed.workspaceKey)) return Promise.resolve(target)
  return invoke('layout:get', workspaceLayoutScope(workspace)).then(saved => ({ ...target, windowId: readWorkspaceWindows(saved.layout).activeWindowId }))
}
function collectionFor(key: string): WorkspaceWindows {
  const base = workspaceWindowFromKey(key).workspaceKey
  let collection = windowCollections.get(base)
  if (!collection) { collection = readWorkspaceWindows(null); windowCollections.set(base, collection) }
  return collection
}
function selectedWindowKey(key: string): string {
  const parsed = workspaceWindowFromKey(key)
  if (parsed.windowId !== DEFAULT_WORKSPACE_WINDOW_ID) return key
  return workspaceWindowKey(parsed.workspaceKey, windowCollections.get(parsed.workspaceKey)?.activeWindowId ?? DEFAULT_WORKSPACE_WINDOW_ID)
}
function emptyWindowLayout(): ReturnType<DockviewApi['toJSON']> {
  return { grid: { root: { type: 'branch', data: [] }, width: 0, height: 0, orientation: 'HORIZONTAL' as ReturnType<DockviewApi['toJSON']>['grid']['orientation'] }, panels: {} }
}
function windowInfo(collection: WorkspaceWindows): WorkspaceWindowInfo[] {
  return collection.windows.map(({ id, name, chromeMode }) => ({ id, name, chromeMode }))
}
function loadedWindowCollection(base: string): WorkspaceWindows | undefined {
  const collection = windowCollections.get(base)
  return collection?.windows.some(window => runtimeLayouts.has(workspaceWindowKey(base, window.id))) ? collection : undefined
}
async function convertStoredWindows(base: string, raw: unknown): Promise<{ collection: WorkspaceWindows; changed: boolean }> {
  const collection = readWorkspaceWindows(raw)
  let changed = false
  const occupied = new Set([...runtimeLayouts].filter(([key]) => workspaceWindowFromKey(key).workspaceKey !== base).flatMap(([, layout]) => Object.keys(tabsFromLayout(layout))))
  for (const [key, target] of courseApis) if (key === null || workspaceWindowFromKey(key).workspaceKey !== base) for (const panel of target.panels) occupied.add(panel.id)
  for (const window of collection.windows) {
    const converted = await migrateLearningLayout(window.layout)
    const unique = remapWorkspacePanelIds(converted.layout, (id, panel) => {
      const descriptor = panel.params?.descriptor
      const next = occupied.has(id) && isTabDescriptor(descriptor) && descriptor.kind !== 'browser' ? createDuplicatePanelId(descriptor) : id
      occupied.add(next); return next
    })
    window.layout = unique.layout; changed ||= converted.changed || unique.changed
  }
  return { collection, changed }
}
function findLogicalPanel(target: DockviewApi, descriptor: TabDescriptor): IDockviewPanel | undefined {
  return target.getPanel(tabPanelId(descriptor)) ?? target.panels.find(panel => isTabDescriptor(panel.params?.descriptor) && tabPanelId(panel.params.descriptor) === tabPanelId(descriptor))
}
/** Same-file panels in distinct windows must not overwrite editor peer/session IDs. */
function newPanelId(descriptor: TabDescriptor, key: string | null): string {
  if (descriptor.kind === 'browser') return tabPanelId(descriptor)
  const canonical = tabPanelId(descriptor)
  const elsewhere = [...courseApis].some(([other, target]) => other !== key && !!target.getPanel(canonical)) ||
    [...runtimeLayouts].some(([other, layout]) => other !== key && canonical in tabsFromLayout(layout))
  return key !== null && (workspaceWindowFromKey(key).windowId !== DEFAULT_WORKSPACE_WINDOW_ID || elsewhere) ? createDuplicatePanelId(descriptor) : canonical
}

function closedSnapshot(panel: IDockviewPanel, courseId: string | null): ClosedTab | null {
  const descriptor = panel.params?.descriptor
  if (!isTabDescriptor(descriptor) || (descriptor.kind === 'browser' && descriptor.payload.isPrivate)) return null
  return {
    courseId, panelId: panel.id, descriptor, title: panel.title ?? tabTitle(descriptor),
    params: { ...panel.params }, groupId: panel.group?.id,
    index: panel.group?.panels.findIndex(entry => entry.id === panel.id) ?? -1
  }
}
let switchSerial = 0
let suppressLayoutEvents = false
let lastStructuralKey = ''
let pendingSaves: PendingSave[] = []
let saveTimer: ReturnType<typeof setTimeout> | null = null
let activeSave: ActiveSave | null = null
let saveRevision = 0
const saveWaiters = new Set<{ resolve(): void; reject(error: Error): void }>()

function settleSaveWaiters(): void {
  if (activeSave !== null || pendingSaves.some(save => !save.exhausted)) return
  for (const waiter of saveWaiters) {
    if (pendingSaves.length > 0) waiter.reject(new Error('작업 공간을 저장하지 못해 전환하지 않았어요. 저장 상태를 확인한 뒤 다시 시도해 주세요.'))
    else waiter.resolve()
  }
  saveWaiters.clear()
}

const LAYOUT_SAVE_RETRY_LIMIT = 3
const LAYOUT_SAVE_RETRY_BASE_MS = 250

function sameTabs(
  a: Record<string, TabDescriptor>,
  b: Record<string, TabDescriptor>
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
  )
}

function clearSaveTimer(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
  let replayingOpens = false
  const syncActivePanel = (): void => {
    const activePanelId = get().surface === 'course' && !get().windowsOverviewOpen && get().hydration === 'ready' ? api?.activePanel?.id ?? null : null
    if (get().activePanelId !== activePanelId) set({ activePanelId })
  }
  const bindApi = (nextApi: DockviewApi | null): void => {
    activePanelSubscription?.dispose()
    activePanelSubscription = null
    api = nextApi
    // The optional call also supports lightweight, older test adapters.
    activePanelSubscription = api?.onDidActivePanelChange?.(syncActivePanel) ?? null
    syncActivePanel()
  }
  const pendingCloses = new Map<IDockviewPanel, Promise<void>>()
  const requestClose = (target: DockviewApi, panel: IDockviewPanel, courseId: string | null): Promise<void> => {
    const pending = pendingCloses.get(panel)
    if (pending) return pending
    const snapshot = closedSnapshot(panel, courseId)
    const close = (allowed: boolean): void => {
      if (!allowed || target.getPanel(panel.id) !== panel) return
      if (snapshot) closedTabs = [...closedTabs, snapshot].slice(-CLOSED_TAB_LIMIT)
      closeWorkspacePanel(target, panel.id)
      if (get().activeWindowKey !== courseId && courseId !== null) get().saveRetainedLayout(courseId, target.toJSON())
    }
    try {
      const descriptor = panel.params?.descriptor
      const result = isTabDescriptor(descriptor) ? canCloseTab(descriptor) : true
      if (typeof result === 'boolean') { close(result); return Promise.resolve() }
      const job = result.then(close).catch(error => {
        console.error('[Bandal] 탭을 닫지 못했습니다.', error)
        showToast('탭을 닫지 못했어요. 다시 시도해 주세요.', 'danger')
      }).finally(() => pendingCloses.delete(panel))
      pendingCloses.set(panel, job)
      return job
    } catch (error) {
      console.error('[Bandal] 탭을 닫지 못했습니다.', error)
      showToast('탭을 닫지 못했어요. 다시 시도해 주세요.', 'danger')
      return Promise.resolve()
    }
  }

  const queueDuringHydration = (open: () => void): boolean => {
    const { activeWindowKey: activeWorkspaceKey, hydration } = get()
    if (activeWorkspaceKey === null || (hydration !== 'loading' && hydration !== 'error')) return false
    const queued = pendingOpens.get(activeWorkspaceKey) ?? []
    queued.push(open)
    pendingOpens.set(activeWorkspaceKey, queued)
    return true
  }
  const replayOpens = (courseId: string): void => {
    const queued = pendingOpens.get(courseId) ?? []
    pendingOpens.delete(courseId)
    replayingOpens = true
    try { for (const open of queued) open() } finally { replayingOpens = false }
  }

  const saveIsPending = (save: PendingSave): boolean =>
    pendingSaves.some(current => current.courseId === save.courseId && current.revision === save.revision)

  const finishActiveSave = (job: ActiveSave): void => {
    if (activeSave !== job) return
    if (job.retryTimer !== null) clearTimeout(job.retryTimer)
    activeSave = null
    flush()
  }

  const attemptSave = (job: ActiveSave): void => {
    if (activeSave !== job) return
    if (!job.saves.every(saveIsPending)) {
      finishActiveSave(job)
      return
    }
    job.retryTimer = null
    job.inFlight = true
    const single = job.saves.length === 1 ? job.saves[0]! : null
    const request = single
      ? invoke('layout:save', { ...workspaceLayoutScope(workspaceFromKey(single.courseId)), layout: single.layout })
      : invoke('layout:saveMany', { layouts: job.saves.map(({ courseId, layout }) => ({ ...workspaceLayoutScope(workspaceFromKey(courseId)), layout })) })
    void request.then(
      () => {
        if (activeSave !== job) return
        job.inFlight = false
        // A newer snapshot for the same course may have replaced this exact
        // object while IPC was in flight. Only the ACKed snapshot is removed.
        pendingSaves = pendingSaves.filter((save) => !job.saves.some(saved => saved.courseId === save.courseId && saved.revision === save.revision))
        finishActiveSave(job)
      },
      (error: unknown) => {
        if (activeSave !== job) return
        job.inFlight = false
        // Deleted courses and superseded snapshots no longer need a retry.
        if (!job.saves.every(saveIsPending)) {
          finishActiveSave(job)
          return
        }
        job.failures += 1
        if (job.failures <= LAYOUT_SAVE_RETRY_LIMIT) {
          const retryDelay =
            LAYOUT_SAVE_RETRY_BASE_MS * 2 ** (job.failures - 1)
          job.retryTimer = setTimeout(() => attemptSave(job), retryDelay)
          return
        }
        job.saves.forEach(save => { save.exhausted = true })
        console.error('[Bandal] 레이아웃을 저장하지 못했습니다.', error)
        showToast('작업 공간을 저장하지 못했어요', 'danger')
        finishActiveSave(job)
      }
    )
  }

  const flush = (): void => {
    clearSaveTimer()
    if (activeSave !== null) {
      // beforeunload/course-switch flushes remain immediate even if a failed
      // background save was waiting in its retry backoff.
      if (!activeSave.inFlight && activeSave.retryTimer !== null) {
        clearTimeout(activeSave.retryTimer)
        activeSave.retryTimer = null
        attemptSave(activeSave)
      }
      return
    }
    const saves = pendingSaves.filter(save => !save.exhausted)
    if (saves.length === 0) { settleSaveWaiters(); return }
    const job: ActiveSave = {
      saves,
      failures: 0,
      inFlight: false,
      retryTimer: null
    }
    activeSave = job
    attemptSave(job)
  }

  const replacePendingSave = (courseId: string, layout: unknown): void => {
    if (discardedCourses.has(courseId)) return
    const { workspaceKey: base, windowId } = workspaceWindowFromKey(courseId)
    const collection = collectionFor(base)
    const window = collection.windows.find(window => window.id === windowId)
    if (window) window.layout = layout
    const serialized = envelopeWorkspaces.has(base) ? { ...collection, windows: collection.windows.map(window => {
      const key = workspaceWindowKey(base, window.id)
      const live = hydratedCourses.has(key) ? courseApis.get(key)?.toJSON() : undefined
      return { ...window, layout: persistentLayout(key === courseId ? layout : live ?? runtimeLayouts.get(key) ?? window.layout) }
    }) } : layout
    pendingSaves = pendingSaves.filter((save) => save.courseId !== base)
    pendingSaves.push({
      courseId: base,
      layout: serialized,
      exhausted: false,
      revision: ++saveRevision
    })
    // A failed paired save must resume as a pair, even if only one side changed.
    for (const save of pendingSaves) save.exhausted = false
  }

  const scheduleSave = (courseId: string, layout: unknown): void => {
    replacePendingSave(courseId, layout)
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

  const saveWindowMetadata = (base: string): void => {
    const collection = collectionFor(base), key = workspaceWindowKey(base, collection.activeWindowId)
    scheduleSave(key, runtimeLayouts.get(key) ?? collection.windows.find(window => window.id === collection.activeWindowId)?.layout ?? emptyWindowLayout())
  }
  const requestTransition = (workspace: WorkspaceRef | null, windowId?: string): void => {
    const key = workspace === null ? null : workspaceWindowKey(workspaceKey(workspace), windowId ?? collectionFor(workspaceKey(workspace)).activeWindowId)
    if (key !== get().activeWindowKey) useUiStore.getState().closeMaterialsExpanded({ returnFocus: false })
    const intent = ++transitionIntent
    if (requestedTransitionKey && requestedTransitionKey !== key) pendingOpens.delete(requestedTransitionKey)
    requestedTransitionKey = key
    // Sidebar commands belong to the selection the user just made, even while
    // the outgoing canvas finishes its bounded preview capture.
    useUiStore.getState().setRightRailScope(workspace === null ? null : workspaceKey(workspace))
    if (key === get().activeWindowKey) { requestedTransitionKey = undefined; set({ windowsOverviewOpen: false }); syncActivePanel(); return }
    const apply = (): void => { if (intent === transitionIntent) { requestedTransitionKey = undefined; activateWorkspace(workspace, windowId) } }
    const outgoing = get().activeWindowKey
    if (outgoing && beforeWindowLeave) {
      try { const pending = beforeWindowLeave(outgoing); if (pending) { void Promise.resolve(pending).catch(() => {}).then(apply); return } } catch { /* Previews never prevent navigation. */ }
    }
    apply()
  }
  const activateWorkspace = (workspace: WorkspaceRef | null, requestedWindowId?: string): void => {
    const base = workspace === null ? null : workspaceKey(workspace)
    const collection = base === null ? null : collectionFor(base)
    if (base && collection && requestedWindowId && !collection.windows.some(window => window.id === requestedWindowId)) requestedWindowSelections.set(base, requestedWindowId)
    const windowId = collection ? requestedWindowId && collection.windows.some(window => window.id === requestedWindowId) ? requestedWindowId : collection.activeWindowId : null
    const courseId = base === null || windowId === null ? null : workspaceWindowKey(base, windowId)
    useUiStore.getState().setRightRailScope(base)
    rememberWorkspace(workspace)
    if (get().activeWindowKey === courseId) return
    const serial = ++switchSerial
    const outgoingCourseId = get().activeWindowKey
    if (api !== null && outgoingCourseId !== null && !discardedCourses.has(outgoingCourseId) && get().hydration === 'ready') {
      const live = api.toJSON()
      runtimeLayouts.set(outgoingCourseId, live)
      replacePendingSave(outgoingCourseId, persistentLayout(live))
    }
    if (collection && windowId) collection.activeWindowId = windowId
    flush()
    set({ activeWorkspaceKey: base, activeWindowKey: courseId, activeWindowId: windowId,
      windows: collection ? windowInfo(collection) : [], workspaceChromeMode: collection?.windows.find(window => window.id === windowId)?.chromeMode ?? 'all',
      windowsOverviewOpen: false, activeWorkspace: workspace, activeCourseId: workspace?.courseId ?? null,
      activePanelId: null, openTabs: {}, hydration: courseId === null ? 'ready' : 'loading' })
    lastStructuralKey = ''
    if (base && envelopeWorkspaces.has(base)) saveWindowMetadata(base)
    if (retainedMode) {
      bindApi(courseApis.get(courseId) ?? null)
      if (api && courseId !== null && hydratedCourses.has(courseId)) {
        const live = api.toJSON(); lastStructuralKey = structuralKey(live)
        set({ openTabs: tabsFromLayout(live), hydration: 'ready', activePanelId: get().surface === 'course' ? api.activePanel?.id ?? null : null })
        replayOpens(courseId); return
      }
    }
    if (courseId === null) {
      if (retainedMode && api) { const live = api.toJSON(); set({ openTabs: tabsFromLayout(live), activePanelId: get().surface === 'course' ? api.activePanel?.id ?? null : null }); return }
      clearDockview(); return
    }
    void hydrate(courseId, serial)
  }

  const hydrate = async (courseId: string, serial: number): Promise<void> => {
    if (api === null) return // attachApi re-runs hydration once ready
    set({ hydration: 'loading', activePanelId: null })

    let migrated = false
    let raw: unknown = runtimeLayouts.get(courseId) ?? null
    if (raw === null && !runtimeLayouts.has(courseId)) {
      try {
        const saved = await invoke('layout:get', workspaceLayoutScope(workspaceFromKey(courseId)))
        if (serial !== switchSerial || api === null) return
        const base = workspaceWindowFromKey(courseId).workspaceKey
        const converted = await convertStoredWindows(base, saved.layout)
        // An owned native request may have staged a newer retained snapshot
        // while this read/conversion was in flight. Never overwrite its tab.
        const collection = loadedWindowCollection(base) ?? converted.collection
        migrated = saved.legacyProjectLayout === true || converted.changed
        if (serial !== switchSerial || api === null) return
        windowCollections.set(base, collection)
        if (isWorkspaceWindows(saved.layout)) envelopeWorkspaces.add(base)
        for (const window of collection.windows) runtimeLayouts.set(workspaceWindowKey(base, window.id), window.layout)
        const requestedId = workspaceWindowFromKey(courseId).windowId
        // The first host mounts before the persisted selected window is known.
        const requestedSelection = requestedWindowSelections.get(base)
        requestedWindowSelections.delete(base)
        const selectedId = requestedSelection && collection.windows.some(window => window.id === requestedSelection) ? requestedSelection : isWorkspaceWindows(saved.layout) ? collection.activeWindowId : requestedId
        collection.activeWindowId = selectedId
        const selectedKey = workspaceWindowKey(base, selectedId)
        set({ windows: windowInfo(collection), workspaceChromeMode: collection.windows.find(window => window.id === selectedId)?.chromeMode ?? 'all' })
        if (selectedKey !== courseId) {
          if (migrated) scheduleSave(selectedKey, collection.windows.find(window => window.id === selectedId)!.layout)
          const queued = pendingOpens.get(courseId)
          if (queued) { pendingOpens.set(selectedKey, [...(pendingOpens.get(selectedKey) ?? []), ...queued]); pendingOpens.delete(courseId) }
          set({ activeWindowKey: selectedKey, activeWindowId: selectedId })
          if (retainedMode) bindApi(courseApis.get(selectedKey) ?? null)
          if (api) void hydrate(selectedKey, ++switchSerial)
          return
        }
        raw = collection.windows.find(window => window.id === requestedId)?.layout ?? null
      } catch (error) {
        console.error('[Bandal] 레이아웃을 불러오지 못했습니다.', error)
        if (serial === switchSerial && api !== null) set({ hydration: 'error', activePanelId: null })
        return
      }
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
    runtimeLayouts.set(courseId, live)
    lastStructuralKey = structuralKey(live)
    hydratedCourses.add(courseId)
    set({ openTabs: tabsFromLayout(live), hydration: 'ready', activePanelId: get().surface === 'course' ? api.activePanel?.id ?? null : null })

    // Persist the cleaned document when validation dropped anything, so the
    // next hydration starts from a healthy file.
    if (migrated || (validated !== null && validated.droppedPanelIds.length > 0)) {
      scheduleSave(courseId, persistentLayout(live))
    }
    replayOpens(courseId)
  }

  return {
    surface: 'course',
    showCommunity: () => {
      if (get().surface === 'community') return
      get().notifyLayoutChanged()
      flush()
      set({ surface: 'community', activePanelId: null })
    },
    prepareCloseLearningSpace: (binding, standalone) => prepareCloseLearningSpace(binding, standalone),
    closeLearningSpace: (binding, standalone) => closeLearningSpace(binding, standalone),
    showStudyMarket: () => {
      if (get().surface === 'study-market') return
      get().notifyLayoutChanged()
      flush()
      set({ surface: 'study-market', activePanelId: null })
    },
    showLearningHome: () => {
      if (get().surface === 'learning-home') return
      get().notifyLayoutChanged()
      flush()
      set({ surface: 'learning-home', activePanelId: null })
    },
    showCourseWorkspace: (courseId) => get().showWorkspace(courseId === null ? null : { kind: 'course', courseId }),
    showWorkspaceWindow: (workspace, windowId) => { requestTransition(workspace, windowId); set({ surface: 'course' }); syncActivePanel() },
    showWorkspace: (workspace) => {
      get().setActiveWorkspace(workspace)
      set({ surface: 'course' }); syncActivePanel()
    },
    activeWorkspace: null,
    activeCourseId: null,
    activeWorkspaceKey: null,
    activeWindowKey: null,
    activeWindowId: null,
    windows: [],
    workspaceChromeMode: 'all',
    windowsOverviewOpen: false,
    activePanelId: null,
    hydration: 'idle',
    retryHydration: () => {
      const { activeWindowKey: activeWorkspaceKey, hydration } = get()
      if (activeWorkspaceKey !== null && hydration === 'error') void hydrate(activeWorkspaceKey, ++switchSerial)
    },
    openTabs: {},

    attachWindowApi: (courseId, nextApi) => get().attachCourseApi(courseId, nextApi),
    detachWindowApi: (courseId) => get().detachCourseApi(courseId),
    attachCourseApi: (courseId, nextApi) => {
      retainedMode = true
      if (courseId !== null) discardedCourses.delete(courseId)
      courseApis.set(courseId, nextApi)
      if (get().activeWindowKey !== courseId) return
      bindApi(nextApi)
      if (courseId === null) set({ hydration: 'ready', openTabs: {}, activePanelId: get().surface === 'course' ? nextApi.activePanel?.id ?? null : null })
      else void hydrate(courseId, ++switchSerial)
    },

    detachCourseApi: (courseId) => {
      const outgoing = courseApis.get(courseId)
      if (outgoing && courseId !== null && !discardedCourses.has(courseId) && hydratedCourses.has(courseId)) {
        const live = outgoing.toJSON()
        runtimeLayouts.set(courseId, live)
        replacePendingSave(courseId, persistentLayout(live))
        flush()
      }
      courseApis.delete(courseId)
      if (courseId !== null) hydratedCourses.delete(courseId)
      if (api === outgoing) bindApi(null)
      set({ openTabs: { ...get().openTabs } })
    },

    attachApi: (nextApi) => {
      bindApi(nextApi)
      lastStructuralKey = ''
      const { activeWindowKey: activeWorkspaceKey } = get()
      if (activeWorkspaceKey === null) {
        set({ hydration: 'ready', openTabs: {}, activePanelId: get().surface === 'course' ? nextApi.activePanel?.id ?? null : null })
        return
      }
      void hydrate(activeWorkspaceKey, ++switchSerial)
    },

    detachApi: () => {
      flush()
      bindApi(null)
      set({ hydration: 'idle', openTabs: {}, activePanelId: null })
    },

    setActiveCourse: (courseId) => {
      if (get().activeCourseId === courseId && (courseId === null || get().activeWorkspace?.kind === 'course')) return
      get().setActiveWorkspace(courseId === null ? null : { kind: 'course', courseId })
    },
    setActiveWorkspace: (workspace) => requestTransition(workspace),
    afterWorkspaceTransition: action => {
      if (requestedTransitionKey && requestedTransitionKey !== get().activeWindowKey) {
        const queued = pendingOpens.get(requestedTransitionKey) ?? []
        queued.push(action); pendingOpens.set(requestedTransitionKey, queued)
      } else action()
    },
    selectWindow: (windowId) => {
      const workspace = get().activeWorkspace
      if (!workspace || !collectionFor(workspaceKey(workspace)).windows.some(window => window.id === windowId)) return
      requestTransition(workspace, windowId)
    },
    createWindow: () => {
      const workspace = get().activeWorkspace
      if (!workspace || get().hydration !== 'ready') return null
      get().notifyLayoutChanged()
      const base = workspaceKey(workspace), collection = collectionFor(base)
      const id = crypto.randomUUID()
      let number = 1
      while (collection.windows.some(window => window.name === `윈도우 ${number}`)) number++
      const window = { id, name: `윈도우 ${number}`, chromeMode: 'all' as const, layout: emptyWindowLayout() }
      collection.windows.push(window); envelopeWorkspaces.add(base)
      runtimeLayouts.set(workspaceWindowKey(base, id), window.layout)
      set({ windows: windowInfo(collection) })
      scheduleSave(workspaceWindowKey(base, id), window.layout)
      requestTransition(workspace, id)
      return id
    },
    renameWindow: (id, name) => {
      const base = get().activeWorkspaceKey
      if (!base || get().hydration !== 'ready') return
      const collection = collectionFor(base), window = collection.windows.find(window => window.id === id)
      const trimmed = name.trim().slice(0, 100)
      if (!window || !trimmed || window.name === trimmed) return
      window.name = trimmed; envelopeWorkspaces.add(base)
      set({ windows: windowInfo(collection) }); saveWindowMetadata(base)
    },
    reorderWindows: (ids) => {
      const base = get().activeWorkspaceKey
      if (!base || get().hydration !== 'ready') return
      const collection = collectionFor(base)
      if (ids.length !== collection.windows.length || new Set(ids).size !== ids.length || ids.some(id => !collection.windows.some(window => window.id === id))) return
      collection.windows = ids.map(id => collection.windows.find(window => window.id === id)!)
      envelopeWorkspaces.add(base); set({ windows: windowInfo(collection) }); saveWindowMetadata(base)
    },
    closeWindow: async (id) => {
      const workspace = get().activeWorkspace
      if (!workspace || get().hydration !== 'ready') return false
      const base = workspaceKey(workspace), collection = collectionFor(base)
      const index = collection.windows.findIndex(window => window.id === id)
      const key = workspaceWindowKey(base, id)
      if (index < 0 || collection.windows.length <= 1 || closingWindows.has(key)) return false
      closingWindows.add(key)
      const target = courseApis.get(key)
      const descriptors = target ? target.panels.flatMap(panel => isTabDescriptor(panel.params?.descriptor) ? [panel.params.descriptor] : []) : Object.values(tabsFromLayout(runtimeLayouts.get(key)))
      let removed: typeof collection.windows[number] | undefined
      let previousActive = collection.activeWindowId
      const wasOverviewOpen = get().windowsOverviewOpen
      const acceptedBrowsers: TabDescriptor[] = []
      const reconcileAcceptedBrowsers = async (): Promise<void> => {
        if (!acceptedBrowsers.length || windowCollections.get(base) !== collection) return
        const ids = new Set(acceptedBrowsers.map(tabPanelId))
        if (target) {
          for (const panel of [...target.panels]) {
            if (!isTabDescriptor(panel.params?.descriptor) || !ids.has(tabPanelId(panel.params.descriptor))) continue
            const snapshot = closedSnapshot(panel, key)
            if (snapshot) closedTabs = [...closedTabs, snapshot].slice(-CLOSED_TAB_LIMIT)
            closeWorkspacePanel(target, panel.id)
          }
          get().saveRetainedLayout(key, target.toJSON())
          if (get().activeWindowKey === key) get().notifyLayoutChanged()
        } else {
          const raw = runtimeLayouts.get(key)
          const layout = validateLayout(raw)?.layout
          if (layout) {
            for (const [panelId, descriptor] of Object.entries(tabsFromLayout(layout))) if (ids.has(tabPanelId(descriptor))) {
              if (descriptor.kind === 'browser' && !descriptor.payload.isPrivate) closedTabs = [...closedTabs, {
                courseId: key, panelId, descriptor, title: tabTitle(descriptor), params: layout.panels[panelId]!.params ?? { descriptor }, groupId: undefined, index: -1
              }].slice(-CLOSED_TAB_LIMIT)
              delete layout.panels[panelId]
            }
            const remaining = validateLayout(layout)?.layout ?? emptyWindowLayout()
            runtimeLayouts.set(key, remaining); scheduleSave(key, remaining)
            set({ openTabs: { ...get().openTabs } })
          }
        }
        try { await get().flushPendingSave() } catch (error) { console.error('[workspace] 닫힌 브라우저 탭 상태를 저장하지 못했습니다.', error) }
        showToast('윈도우를 유지했어요. 이미 닫기를 허용한 브라우저 탭은 닫혔어요.')
      }
      try {
        // Native beforeunload may close the page immediately; document failures must veto first.
        const savedResources = new Set<string>()
        for (const descriptor of descriptors) {
          if (!('courseId' in descriptor.payload) || !('relPath' in descriptor.payload)) continue
          const ref = { courseId: descriptor.payload.courseId, relPath: descriptor.payload.relPath }
          const resourceKey = JSON.stringify([ref.courseId, ref.relPath])
          if (savedResources.has(resourceKey)) continue
          savedResources.add(resourceKey)
          if (descriptor.kind === 'note') {
            const result = await flushOpenNoteSession(ref)
            if (result && result.result.status !== 'saved') throw new Error('필기를 저장하지 못했습니다.')
          }
          await flushDocumentSaves(ref)
        }
        if (get().activeWindowKey === key) get().notifyLayoutChanged()
        else if (target) get().saveRetainedLayout(key, target.toJSON())
        await get().flushPendingSave()
        for (const descriptor of descriptors) {
          if (!await canCloseTab(descriptor)) { await reconcileAcceptedBrowsers(); return false }
          if (descriptor.kind === 'browser') acceptedBrowsers.push(descriptor)
        }
        if (get().activeWindowKey === key) await beforeWindowLeave?.(key)
        if (windowCollections.get(base) !== collection || collection.windows.length <= 1 || !collection.windows.some(window => window.id === id)) { await reconcileAcceptedBrowsers(); return false }
        get().notifyLayoutChanged()
        await get().flushPendingSave()
        previousActive = collection.activeWindowId
        removed = collection.windows.find(window => window.id === id)
        collection.windows = collection.windows.filter(window => window.id !== id)
        const next = collection.windows[Math.min(index, collection.windows.length - 1)]!
        if (collection.activeWindowId === id) collection.activeWindowId = next.id
        envelopeWorkspaces.add(base)
        // Commit the new collection before unmounting editors or destroying browser pages.
        saveWindowMetadata(base)
        await get().flushPendingSave()
        discardedCourses.add(key); pendingOpens.delete(key); runtimeLayouts.delete(key); hydratedCourses.delete(key)
        closedTabs = closedTabs.filter(tab => tab.courseId !== key)
        if (get().activeWorkspaceKey === base) set({ windows: windowInfo(collection) })
        if (get().activeWindowKey === key) {
          activateWorkspace(workspace, next.id)
          if (wasOverviewOpen) { set({ windowsOverviewOpen: true, activePanelId: null }); syncActivePanel() }
        }
        suppressLayoutEvents = true
        try { target?.clear() } finally { suppressLayoutEvents = false }
        set({ openTabs: { ...get().openTabs } })
        publishWindowRemoved(key)
        return true
      } catch (error) {
        if (removed && windowCollections.get(base) === collection) {
          collection.windows.splice(Math.min(index, collection.windows.length), 0, removed)
          const selected = get().activeWorkspaceKey === base ? get().activeWindowId : null
          collection.activeWindowId = selected && collection.windows.some(window => window.id === selected) ? selected : previousActive
          if (get().activeWorkspaceKey === base) set({ windows: windowInfo(collection) })
          saveWindowMetadata(base)
        }
        await reconcileAcceptedBrowsers()
        console.error('[workspace] 윈도우를 닫지 못했습니다.', error)
        showToast('윈도우를 닫지 못했어요. 저장 상태를 확인해 주세요.', 'danger'); return false
      } finally { closingWindows.delete(key) }
    },
    setWorkspaceChromeMode: (mode) => {
      const base = get().activeWorkspaceKey, id = get().activeWindowId
      if (!base || !id || get().hydration !== 'ready' || !['all', 'tabs-hidden', 'all-hidden'].includes(mode)) return
      const collection = collectionFor(base), window = collection.windows.find(window => window.id === id)
      if (!window || window.chromeMode === mode) return
      window.chromeMode = mode; envelopeWorkspaces.add(base)
      set({ workspaceChromeMode: mode, windows: windowInfo(collection) }); saveWindowMetadata(base)
    },
    toggleWindowsOverview: () => get().setWindowsOverviewOpen(!get().windowsOverviewOpen),
    setWindowsOverviewOpen: (open) => {
      if (open && (!get().activeWorkspace || get().hydration !== 'ready')) return
      if (open) useUiStore.getState().closeMaterialsExpanded({ returnFocus: false })
      set({ windowsOverviewOpen: open }); syncActivePanel()
    },

    openTab: (descriptor, options) => {
      if (!options?.target && !replayingOpens && requestedTransitionKey && requestedTransitionKey !== get().activeWindowKey) {
        const queued = pendingOpens.get(requestedTransitionKey) ?? []
        queued.push(() => get().openTab(descriptor, options)); pendingOpens.set(requestedTransitionKey, queued); return
      }
      if (options?.shouldOpen && !options.shouldOpen()) return
      const destination = options?.target ? { ...options.target, courseId: options.target.workspace === undefined ? options.target.courseId : options.target.workspace === null ? null : workspaceWindowKey(workspaceKey(options.target.workspace), options.target.windowId ?? collectionFor(workspaceKey(options.target.workspace)).activeWindowId) } : undefined
      if (destination?.courseId && !discardedCourses.has(destination.courseId) &&
          (!workspaceApiForWindow(destination.courseId) || !hydratedCourses.has(destination.courseId))) {
        const copy = options?.newInstance ? duplicateTabDescriptor(descriptor) : descriptor
        const staged: OwnedWorkspaceOpen = { requestId: crypto.randomUUID(), key: destination.courseId, descriptor: copy,
          background: options?.background === true, followSavedSelection: false,
          ...(options?.newInstance ? { newInstance: true } : {}), ...(destination.groupId ? { groupId: destination.groupId } : {}),
          ...(options?.shouldOpen ? { shouldOpen: options.shouldOpen } : {}), ...(options?.onOpened ? { onOpened: options.onOpened } : {}) }
        ownedWorkspaceOpens.set(staged.requestId, staged)
        void materializeOwnedWorkspaceOpen(staged)
        return
      }
      if (destination && destination.courseId !== get().activeWindowKey) {
        const target = workspaceApiForWindow(destination.courseId)
        const group = destination.groupId ? target?.getGroup(destination.groupId) : undefined
        if (!target && destination.courseId !== null && !discardedCourses.has(destination.courseId) && runtimeLayouts.has(destination.courseId)) {
          const copy = options?.newInstance ? duplicateTabDescriptor(descriptor) : descriptor
          const id = options?.newInstance && copy.kind !== 'browser' ? createDuplicatePanelId(copy) : newPanelId(copy, destination.courseId)
          const layout = appendRetainedTab(runtimeLayouts.get(destination.courseId), copy, id, { groupId: destination.groupId, background: options?.background, newInstance: options?.newInstance })
          if (layout) {
            get().saveRetainedLayout(destination.courseId, layout)
            options?.onOpened?.(options?.newInstance ? id : Object.entries(tabsFromLayout(layout)).find(([, tab]) => tabPanelId(tab) === tabPanelId(copy))?.[0] ?? id)
            return
          }
        }
        if (!target || (destination.groupId && !group) || (destination.courseId !== null && !hydratedCourses.has(destination.courseId))) {
          showToast('원래 작업 영역을 찾을 수 없어요. 만든 자료는 원래 과목에서 열 수 있어요.')
          return
        }
        const copy = options?.newInstance ? duplicateTabDescriptor(descriptor) : descriptor
        const id = options?.newInstance && copy.kind !== 'browser' ? createDuplicatePanelId(copy) : newPanelId(copy, destination.courseId)
        const existing = options?.newInstance ? undefined : findLogicalPanel(target, copy)
        if (existing) {
          existing.api.updateParameters({ ...existing.params, descriptor: copy })
          if (options?.background !== true) existing.api.setActive()
        } else target.addPanel({ id, component: copy.kind, title: tabTitle(copy), params: { descriptor: copy },
          ...(group ? { position: { referenceGroup: group.id, index: group.panels.length } } : {}), inactive: options?.background === true })
        get().saveRetainedLayout(destination.courseId, target.toJSON())
        options?.onOpened?.(existing?.id ?? id)
        return
      }
      if (!destination && !replayingOpens && options?.background !== true && get().surface !== 'course') get().showWorkspace(get().activeWorkspace)
      if (queueDuringHydration(() => get().openTab(descriptor, options))) return
      if (api === null) return
      const targetGroup = destination?.groupId ? api.getGroup(destination.groupId) : undefined
      if (destination?.groupId && !targetGroup) {
        showToast('원래 작업 영역이 닫혔어요. 만든 자료는 과목에서 다시 열 수 있어요.')
        return
      }
      // newInstance: 같은 파일의 새 뷰를 하나 더 연다 (⌘클릭/분할 열기).
      // 복제 패널 id 규칙은 탭 복제와 동일 — validateLayout이 이미 수용한다.
      if (options?.newInstance) descriptor = duplicateTabDescriptor(descriptor)
      let panelId = options?.newInstance && descriptor.kind !== 'browser'
        ? createDuplicatePanelId(descriptor) : newPanelId(descriptor, get().activeWindowKey)
      let existing = options?.newInstance ? undefined : findLogicalPanel(api, descriptor)
      if (options?.beside && existing && existing.group === api.activePanel?.group) {
        descriptor = duplicateTabDescriptor(descriptor)
        panelId = descriptor.kind === 'browser' ? tabPanelId(descriptor) : createDuplicatePanelId(descriptor)
        existing = undefined
      }
      if (existing !== undefined) {
        // An expanded AI tab keeps its conversation ID while its source link
        // can change, so refresh the descriptor before focusing it.
        existing.api.updateParameters({ ...existing.params, descriptor })
        if (options?.background !== true) existing.api.setActive()
        finishMaterialOpen(descriptor, options?.background)
        options?.onOpened?.(existing.id)
        return
      }
      // [R3] "현재 탭 옆에 열기" 설정: 새 탭을 활성 그룹의 끝이 아니라
      // 지금 보고 있는 탭 바로 다음 칸에 넣는다(복제 탭과 같은 위치 규칙,
      // TabContextMenu.duplicateTab 참고). 기존 패널을 포커스만 하는 위의
      // 경로에는 적용하지 않는다 — 이미 있는 탭은 자리를 옮기지 않는다.
      const focusedPanel = api.activePanel
      const activePanel = targetGroup ? targetGroup.activePanel : focusedPanel
      const activeIndex =
        activePanel === undefined
          ? -1
          : activePanel.group.panels.findIndex(
              (panel) => panel.id === activePanel.id
            )
      const position =
        options?.beside && activePanel
          ? { position: { referencePanel: activePanel, direction: 'right' as const } }
          : settingsSnapshot().openAdjacentTab &&
              activePanel !== undefined &&
              activeIndex >= 0
          ? { position: { referencePanel: activePanel, index: activeIndex + 1 } }
          : targetGroup ? { position: { referenceGroup: targetGroup.id, index: targetGroup.panels.length } } : {}
      const added = api.addPanel({
        id: panelId,
        component: descriptor.kind,
        title: tabTitle(descriptor),
        params: { descriptor },
        inactive: options?.background === true,
        ...position
      })
      finishMaterialOpen(descriptor, options?.background)
      // dockview activates a new panel by default. ⌘-clicking five 공지 links
      // would otherwise yank focus five times and leave the student on the
      // last one.
      if (options?.background === true && focusedPanel !== undefined) {
        focusedPanel.api.setActive()
        void added
      }
      options?.onOpened?.(added.id)
    },

    openPdfNotePair: (pdfDescriptor, noteDescriptor, connectionId, initialPage) => {
      if (queueDuringHydration(() => get().openPdfNotePair(pdfDescriptor, noteDescriptor, connectionId, initialPage))) return
      if (
        api === null ||
        !isPageNoteSource(pdfDescriptor) ||
        noteDescriptor.kind !== 'note'
      ) {
        return
      }
      const pairId = crypto.randomUUID()
      const current = api.activePanel
      let pdfPanel =
        current !== undefined && panelIdMatchesDescriptor(current.id, pdfDescriptor)
          ? current
          : findLogicalPanel(api, pdfDescriptor)

      if (pdfPanel === undefined) {
        pdfPanel = api.addPanel({
          id: newPanelId(pdfDescriptor, get().activeWindowKey),
          component: pdfDescriptor.kind,
          title: tabTitle(pdfDescriptor),
          params: {
            descriptor: pdfDescriptor,
            pageNotePair: {
              connectionId,
              pairId,
              role: 'pdf',
              initialPage
            }
          }
        })
      } else {
        pdfPanel.api.updateParameters({
          descriptor: pdfDescriptor,
          pageNotePair: {
            connectionId,
            pairId,
            role: 'pdf',
            initialPage
          }
        })
      }

      const canonicalNoteId = newPanelId(noteDescriptor, get().activeWindowKey)
      const noteId =
        api.getPanel(canonicalNoteId) === undefined
          ? canonicalNoteId
          : createDuplicatePanelId(noteDescriptor)
      const notePanel = api.addPanel({
        id: noteId,
        component: 'note',
        title: tabTitle(noteDescriptor),
        params: {
          descriptor: noteDescriptor,
          pageNotePair: {
            connectionId,
            pairId,
            role: 'note',
            initialPage
          }
        },
        position: { referencePanel: pdfPanel, direction: 'right' }
      })
      pdfPanel.api.setActive()
      notePanel.api.setActive()
      finishMaterialOpen(noteDescriptor)
    },

    saveRetainedLayout: (courseId, layout) => {
      if (courseId === null || discardedCourses.has(courseId)) return
      runtimeLayouts.set(courseId, layout)
      scheduleSave(courseId, persistentLayout(layout))
      // Reaping must see closures in inactive retained workspaces too.
      set({ openTabs: { ...get().openTabs } })
    },

    rememberDetachedBrowserPage: (tabId, url, title) => {
      if (!url || url === 'about:blank') return
      for (const [courseId, raw] of runtimeLayouts) {
        if (courseApis.has(courseId)) continue
        const match = Object.entries(tabsFromLayout(raw)).find(([, descriptor]) =>
          descriptor.kind === 'browser' && descriptor.payload.tabId === tabId)
        if (!match) continue
        const [panelId, descriptor] = match
        if (descriptor.kind !== 'browser') continue
        const layout = structuredClone(raw) as RetainedLayout
        const panel = layout.panels[panelId]!
        panel.params = { ...panel.params, descriptor: { ...descriptor, payload: { ...descriptor.payload, initialUrl: url } } }
        if (title) panel.title = title
        runtimeLayouts.set(courseId, layout)
        // Navigation is decorative: park the latest URL for the next normal
        // save/quit, without starting a write timer for each background event.
        replacePendingSave(courseId, persistentLayout(layout))
      }
    },

    closeTab: (panelId) => {
      const target = api
      const panel = target?.getPanel(panelId)
      if (!target || !panel) return Promise.resolve()
      return requestClose(target, panel, get().activeWindowKey)
    },

    closeTabs: async (panelIds) => {
      const target = api
      const courseId = get().activeWindowKey
      if (!target) return
      for (const id of panelIds) {
        const panel = target.getPanel(id)
        if (panel) await requestClose(target, panel, courseId)
      }
    },

    closeTabsMatching: (descriptor) => {
      // Closes the canonical panel AND every duplicate view of the same tab —
      // closing only tabPanelId(descriptor) leaves ::duplicate:: panels open.
      closeResourceTabs(candidate => JSON.stringify(candidate) === JSON.stringify(descriptor) || tabPanelId(candidate) === tabPanelId(descriptor))
    },

    closeOthers: (panelId, scope = 'group') => {
      const panel = api?.getPanel(panelId)
      if (!panel || !api) return Promise.resolve()
      const panels = scope === 'workspace' ? api.panels : panel.group?.panels ?? api.panels
      return get().closeTabs(panels.filter(entry => entry.id !== panelId).map(entry => entry.id))
    },

    closeActiveTab: () => {
      if (get().surface !== 'course' || get().windowsOverviewOpen) return Promise.resolve()
      const panel = api?.activePanel
      return panel ? get().closeTab(panel.id) : Promise.resolve()
    },

    activateTabAt: (index) => {
      if (get().surface !== 'course' || get().windowsOverviewOpen) return
      if (api === null || index < 0) return
      api.panels[index]?.api.setActive()
    },

    activatePanel: (panelId) => {
      api?.getPanel(panelId)?.api.setActive()
    },

    activateLastTab: () => {
      if (get().surface !== 'course' || get().windowsOverviewOpen) return
      if (api === null) return
      api.panels[api.panels.length - 1]?.api.setActive()
    },

    activateRelativeTab: (delta) => {
      if (get().surface !== 'course' || get().windowsOverviewOpen) return
      if (api === null) return
      const panels = api.panels
      if (panels.length === 0) return
      const current = panels.findIndex(
        (panel) => panel.id === api?.activePanel?.id
      )
      const from = current === -1 ? 0 : current
      const next = (((from + delta) % panels.length) + panels.length) % panels.length
      panels[next]?.api.setActive()
    },

    reopenClosedTab: () => {
      if (get().surface !== 'course' || get().windowsOverviewOpen) return
      if (!api) return
      const index = closedTabs.findLastIndex(tab => tab.courseId === get().activeWindowKey)
      if (index < 0) return
      const [closed] = closedTabs.splice(index, 1)
      if (!closed) return
      const existing = api.getPanel(closed.panelId)
      if (existing) { existing.api.setActive(); return }
      const group = closed.groupId ? api.groups?.find(group => group.id === closed.groupId) : undefined
      api.addPanel({
        id: closed.panelId, component: closed.descriptor.kind, title: closed.title,
        params: closed.params,
        ...(group ? { position: { referenceGroup: group, index: Math.max(0, Math.min(closed.index, group.panels.length)) } } : {})
      })
    },

    activeTabDescriptor: () => {
      if (get().surface !== 'course' || get().windowsOverviewOpen || api === null) return null
      const descriptor = (
        api.activePanel?.params as { descriptor?: unknown } | undefined
      )?.descriptor
      return isTabDescriptor(descriptor) ? descriptor : null
    },

    activePanelSource: () => {
      const panel = api?.activePanel
      if (get().surface !== 'course' || get().windowsOverviewOpen || get().hydration !== 'ready' || !panel || panel.id !== get().activePanelId) return null
      const descriptor = panel.params?.descriptor
      return isTabDescriptor(descriptor) ? { panelId: panel.id, descriptor } : null
    },

    activeBrowserTabId: () => {
      if (get().surface !== 'course' || get().windowsOverviewOpen || api === null) return null
      const descriptor = (
        api.activePanel?.params as { descriptor?: unknown } | undefined
      )?.descriptor
      if (!isTabDescriptor(descriptor) || descriptor.kind !== 'browser') {
        return null
      }
      return descriptor.payload.tabId
    },

    notifyLayoutChanged: () => {
      if (suppressLayoutEvents || api === null) return
      syncActivePanel()
      const { activeWindowKey: activeWorkspaceKey, hydration, openTabs } = get()
      if ((activeWorkspaceKey !== null && discardedCourses.has(activeWorkspaceKey)) || hydration !== 'ready') return

      const layout = api.toJSON()
      const tabs = tabsFromLayout(layout)
      if (!sameTabs(openTabs, tabs)) set({ openTabs: tabs })
      if (activeWorkspaceKey === null) return
      runtimeLayouts.set(activeWorkspaceKey, layout)

      const key = structuralKey(layout)
      if (key === lastStructuralKey) {
        // Decorative churn (focus change). No debounce timer for focus alone,
        // but always park the snapshot so flush (beforeunload / course switch)
        // carries the latest active tab — otherwise quitting after only
        // switching tabs restores the wrong active tab.
        replacePendingSave(activeWorkspaceKey, persistentLayout(layout))
        return
      }
      lastStructuralKey = key
      scheduleSave(activeWorkspaceKey, persistentLayout(layout))
    },

    flushPendingSave: () => {
      const completed = new Promise<void>((resolve, reject) => { saveWaiters.add({ resolve, reject }) })
      // Existing course-switch/beforeunload callers are intentionally best
      // effort; observing their rejection here does not mask it from awaiters.
      void completed.catch(() => {})
      flush()
      return completed
    },

    discardPendingSave: (courseId) => {
      const keys = new Set([courseId, ...runtimeLayouts.keys(), ...courseApis.keys(), ...pendingSaves.map(save => save.courseId)])
      for (const key of keys) if (key !== null && workspaceFromKey(key).courseId === courseId) get().discardWorkspace(workspaceFromKey(key))
    },
    discardWorkspace: (workspace) => {
      const base = workspaceKey(workspace)
      const keys = new Set([base, ...runtimeLayouts.keys(), ...courseApis.keys(), ...(windowCollections.get(base)?.windows.map(window => workspaceWindowKey(base, window.id)) ?? [])])
      for (const key of keys) {
        if (key === null || workspaceWindowFromKey(key).workspaceKey !== base) continue
        discardedCourses.add(key); pendingOpens.delete(key); runtimeLayouts.delete(key); hydratedCourses.delete(key)
        closedTabs = closedTabs.filter(tab => tab.courseId !== key)
        publishWindowRemoved(key)
      }
      windowCollections.delete(base); envelopeWorkspaces.delete(base); requestedWindowSelections.delete(base)
      const previousLength = pendingSaves.length
      pendingSaves = pendingSaves.filter(save => save.courseId !== base)
      if (pendingSaves.length !== previousLength && pendingSaves.length === 0) { clearSaveTimer(); settleSaveWaiters() }
      if (!suppressWorkspacePublish) set({ openTabs: { ...get().openTabs } })
    }
  }
})

/** Test-only: reset the store's imperative internals and state. */
export function resetWorkspaceStoreForTests(): void {
  clearSaveTimer()
  if (activeSave?.retryTimer !== null && activeSave?.retryTimer !== undefined) {
    clearTimeout(activeSave.retryTimer)
  }
  activePanelSubscription?.dispose()
  activePanelSubscription = null
  api = null
  retainedMode = false
  courseApis.clear()
  windowCollections.clear()
  envelopeWorkspaces.clear()
  requestedWindowSelections.clear()
  closingWindows.clear()
  ownedWorkspaceOpens.clear()
  suppressWorkspacePublish = false
  windowRemovedListeners.clear()
  beforeWindowLeave = null
  transitionIntent = 0
  requestedTransitionKey = undefined
  closedTabs = []
  hydratedCourses.clear()
  pendingOpens.clear()
  switchSerial = 0
  suppressLayoutEvents = false
  lastStructuralKey = ''
  pendingSaves = []
  runtimeLayouts.clear()
  discardedCourses.clear()
  activeSave = null
  saveRevision = 0
  for (const waiter of saveWaiters) waiter.resolve()
  saveWaiters.clear()
  useWorkspaceStore.setState({
    surface: 'course',
    activeWorkspaceKey: null,
    activeWindowKey: null,
    activeWindowId: null,
    windows: [],
    workspaceChromeMode: 'all',
    windowsOverviewOpen: false,
    activeWorkspace: null,
    activeCourseId: null,
    activePanelId: null,
    hydration: 'idle',
    openTabs: {}
  })
}

export function retainedTabDescriptors(courseId?: string): TabDescriptor[] {
  const state = useWorkspaceStore.getState()
  const activeIsRetained = state.activeWindowKey === null || !discardedCourses.has(state.activeWindowKey)
  const descriptors = activeIsRetained && (courseId === undefined || state.activeWindowKey === courseId) ? Object.values(state.openTabs) : []
  // Native browser pages outlive the small cache of mounted course Dockviews.
  for (const [id, layout] of runtimeLayouts) {
    if (id === state.activeWindowKey && state.hydration === 'ready' || (courseId !== undefined && id !== courseId)) continue
    descriptors.push(...Object.values(tabsFromLayout(layout)))
  }
  // The temporary no-course canvas has no persisted row, but its pages are live.
  const temporary = courseApis.get(null)
  if (temporary && state.activeWindowKey !== null && courseId === undefined) {
    descriptors.push(...temporary.panels.flatMap(panel => isTabDescriptor(panel.params?.descriptor) ? [panel.params.descriptor] : []))
  }
  for (const open of ownedWorkspaceOpens.values()) if ((courseId === undefined || courseId === open.key) && !discardedCourses.has(open.key) && (!open.shouldOpen || open.shouldOpen())) {
    if (!descriptors.some(tab => tabPanelId(tab) === tabPanelId(open.descriptor))) descriptors.push(open.descriptor)
  }
  return descriptors
}

/** Workspace-level commands address its selected window; captured canvas keys use the exact API below. */
export function workspaceApiForCourse(courseId: string | null): DockviewApi | null {
  return workspaceApiForWindow(courseId === null ? null : selectedWindowKey(courseId))
}

export function workspaceApiForWindow(courseId: string | null): DockviewApi | null {
  return courseApis.get(courseId) ?? (useWorkspaceStore.getState().activeWindowKey === courseId ? api : null)
}

export function isWorkspaceDiscarded(key: string): boolean { return discardedCourses.has(key) }

/** Placement lookup, independent of descriptors' original resource bindings. */
export function workspaceCourseForPanel(panelId: string): string | null {
  for (const [courseId, target] of courseApis) if (target.getPanel(panelId)) return courseId
  for (const [courseId, layout] of runtimeLayouts) if (tabsFromLayout(layout)[panelId]) return courseId
  const staged = ownedWorkspaceOpens.get(panelId) ?? [...ownedWorkspaceOpens.values()].find(open => open.descriptor.kind === 'browser' && tabPanelId(open.descriptor) === panelId)
  if (staged && !discardedCourses.has(staged.key)) return staged.key
  return null
}

export interface WorkspacePanelPlacement {
  courseId: string
  panelId: string
  descriptor: TabDescriptor
}

export function workspacePanelPlacements(): WorkspacePanelPlacement[] {
  const placements: WorkspacePanelPlacement[] = []
  for (const [courseId, layout] of runtimeLayouts) {
    if (discardedCourses.has(courseId)) continue
    const target = workspaceApiForWindow(courseId)
    const tabs = target ? Object.fromEntries(target.panels.flatMap(panel => isTabDescriptor(panel.params?.descriptor) ? [[panel.id, panel.params.descriptor]] : [])) : tabsFromLayout(layout)
    for (const [panelId, descriptor] of Object.entries(tabs)) placements.push({ courseId, panelId, descriptor })
  }
  return placements
}

/** Resource deletion closes every placement, including evicted course layouts. */
export function closeResourceTabs(matches: (descriptor: TabDescriptor) => boolean): void {
  const state = useWorkspaceStore.getState()
  for (const courseId of new Set([...runtimeLayouts.keys(), ...courseApis.keys(), state.activeWindowKey])) {
    if (courseId === null || discardedCourses.has(courseId)) continue
    const target = workspaceApiForWindow(courseId)
    if (target) {
      let changed = false
      for (const panel of [...target.panels]) if (isTabDescriptor(panel.params?.descriptor) && matches(panel.params.descriptor)) {
        panel.api.close(); changed = true
      }
      if (!changed) continue
      if (courseId === state.activeWindowKey) state.notifyLayoutChanged()
      else state.saveRetainedLayout(courseId, target.toJSON())
    } else {
      const raw = runtimeLayouts.get(courseId)
      const ids = Object.entries(tabsFromLayout(raw)).filter(([, descriptor]) => matches(descriptor)).map(([id]) => id)
      if (!ids.length) continue
      const layout = structuredClone(raw) as RetainedLayout
      for (const id of ids) delete layout.panels[id]
      const remaining = validateLayout(layout)?.layout ?? { ...layout, panels: {}, grid: { ...layout.grid, root: { type: 'branch' as const, data: [] } } }
      state.saveRetainedLayout(courseId, remaining)
    }
  }
  closedTabs = closedTabs.filter(tab => !matches(tab.descriptor))
}

/** Flush learning drafts before their project folder changes. No pane closes. */
export async function flushLearningResourcesForPath(courseId: string, from: string): Promise<boolean> {
  const resources = new Map<string, TabDescriptor>()
  for (const { descriptor } of workspacePanelPlacements()) {
    if (descriptor.kind !== 'learning-resource' || descriptor.payload.courseId !== courseId) continue
    const root = descriptor.payload.rootRelPath
    if (root === from || root.startsWith(`${from}/`)) resources.set(tabPanelId(descriptor), descriptor)
  }
  try {
    for (const descriptor of resources.values()) if (!await canCloseTab(descriptor)) return false
    return true
  } catch { return false }
}

/** File operations keep a moved view in its chosen workspace. */
export function reconcileWorkspaceMaterialRename(courseId: string, from: string, to: string): number {
  const state = useWorkspaceStore.getState()
  let changed = 0
  const rewrite = (descriptor: TabDescriptor): TabDescriptor | null => {
    if ((descriptor.kind === 'learning' || descriptor.kind === 'learning-resource') && descriptor.payload.courseId === courseId && descriptor.payload.rootRelPath !== undefined) {
      const path = descriptor.payload.rootRelPath
      if (path !== from && !path.startsWith(`${from}/`)) return null
      return { ...descriptor, payload: { ...descriptor.payload, rootRelPath: `${to}${path.slice(from.length)}` } } as TabDescriptor
    }
    if (!('relPath' in descriptor.payload) || !('courseId' in descriptor.payload) || descriptor.payload.courseId !== courseId) return null
    const path = descriptor.payload.relPath
    if (path !== from && !path.startsWith(`${from}/`) && path !== to && !path.startsWith(`${to}/`)) return null
    const relPath = path === to || path.startsWith(`${to}/`) ? path : `${to}${path.slice(from.length)}`
    return { ...descriptor, payload: { ...descriptor.payload, relPath } } as TabDescriptor
  }
  const placements = new Set([...runtimeLayouts.keys(), ...courseApis.keys(), state.activeWindowKey])
  for (const placementCourse of placements) {
    if (!placementCourse || discardedCourses.has(placementCourse)) continue
    const target = workspaceApiForWindow(placementCourse)
    if (target) {
      let updated = false
      for (const panel of [...target.panels]) {
        if (!isTabDescriptor(panel.params?.descriptor)) continue
        const descriptor = rewrite(panel.params.descriptor)
        if (!descriptor) continue
        let id = panel.id.includes('::duplicate::') ? createDuplicatePanelId(descriptor) : tabPanelId(descriptor)
        if (id === panel.id) continue
        if (target.getPanel(id)) id = createDuplicatePanelId(descriptor)
        const group = panel.group.id, index = panel.group.panels.indexOf(panel), active = panel.api.isActive
        const params = { ...panel.params, descriptor }
        panel.api.close()
        target.addPanel({ id, component: descriptor.kind, title: tabTitle(descriptor), params,
          inactive: !active, ...(target.getGroup(group) ? { position: { referenceGroup: group, index } } : {}) })
        updated = true; changed++
      }
      if (updated) {
        if (placementCourse === state.activeWindowKey) state.notifyLayoutChanged()
        else state.saveRetainedLayout(placementCourse, target.toJSON())
      }
    } else {
      const raw = runtimeLayouts.get(placementCourse)
      if (!raw) continue
      const layout = structuredClone(raw) as RetainedLayout
      const ids = new Map<string, string>()
      for (const [id, saved] of Object.entries(layout.panels)) {
        if (!isTabDescriptor(saved.params?.descriptor)) continue
        const descriptor = rewrite(saved.params.descriptor)
        if (!descriptor) continue
        const nextId = id.includes('::duplicate::') ? createDuplicatePanelId(descriptor) : tabPanelId(descriptor)
        if (nextId === id) continue
        ids.set(id, nextId); delete layout.panels[id]
        layout.panels[nextId] = { ...saved, id: nextId, title: tabTitle(descriptor), params: { ...saved.params, descriptor } }
        changed++
      }
      if (ids.size) {
        const visit = (node: RetainedLayout['grid']['root']): void => {
          if (Array.isArray(node.data)) node.data.forEach(visit)
          else { node.data.views = node.data.views.map(id => ids.get(id) ?? id); if (node.data.activeView) node.data.activeView = ids.get(node.data.activeView) ?? node.data.activeView }
        }
        visit(layout.grid.root)
        state.saveRetainedLayout(placementCourse, layout)
      }
    }
  }
  // Conversation selection and rail preferences outlive mounted layouts. Move
  // their keys even when a project has not been opened since the last restart.
  const remembered = new Set([...placements, ...Object.keys(useWorkspaceAssistantStore.getState().spaces), ...rememberedRightRailScopes()])
  for (const key of remembered) {
    if (!key) continue
    const ref = workspaceFromKey(key)
    if (ref.kind !== 'project' || ref.courseId !== courseId || ref.rootRelPath !== from && !ref.rootRelPath.startsWith(`${from}/`)) continue
    const next: WorkspaceRef = { ...ref, rootRelPath: `${to}${ref.rootRelPath.slice(from.length)}` }
    useWorkspaceAssistantStore.getState().moveWorkspace(ref, next)
    useUiStore.getState().moveRightRailScope(workspaceWindowFromKey(key).workspaceKey, workspaceKey(next))
  }
  const movedBases = new Set<string>()
  for (const key of placements) {
    if (!key || discardedCourses.has(key)) continue
    const base = workspaceWindowFromKey(key).workspaceKey
    if (movedBases.has(base)) continue
    const ref = workspaceFromKey(base)
    if (ref.kind !== 'project' || ref.courseId !== courseId || ref.rootRelPath !== from && !ref.rootRelPath.startsWith(`${from}/`)) continue
    movedBases.add(base)
    const next: WorkspaceRef = { ...ref, rootRelPath: `${to}${ref.rootRelPath.slice(from.length)}` }, nextBase = workspaceKey(next)
    const previousCollection = collectionFor(base)
    const collection: WorkspaceWindows = { ...previousCollection, windows: previousCollection.windows.map(window => {
      const key = workspaceWindowKey(base, window.id)
      return { ...window, layout: workspaceApiForWindow(key)?.toJSON() ?? runtimeLayouts.get(key) ?? window.layout }
    }) }
    const active = state.activeWorkspaceKey === base, wasEnvelope = envelopeWorkspaces.has(base)
    suppressWorkspacePublish = true
    try { state.discardWorkspace(ref) } finally { suppressWorkspacePublish = false }
    windowCollections.set(nextBase, collection)
    if (wasEnvelope) envelopeWorkspaces.add(nextBase)
    for (const window of collection.windows) {
      const nextKey = workspaceWindowKey(nextBase, window.id)
      discardedCourses.delete(nextKey); runtimeLayouts.set(nextKey, window.layout)
    }
    for (const window of collection.windows) state.saveRetainedLayout(workspaceWindowKey(nextBase, window.id), window.layout as RetainedLayout)
    if (active) state.showWorkspaceWindow(next, collection.activeWindowId)
  }
  return changed
}

export interface WorkspacePanelMovePosition {
  groupId?: string
  direction?: 'within' | 'left' | 'right' | 'above' | 'below'
  index?: number
}

/** Transfer presentation only: resources, live content and identities stay intact. */
export async function moveWorkspacePanel(input: {
  sourceCourseId: string | null
  panelId: string
  targetCourseId: string
  position?: WorkspacePanelMovePosition
}): Promise<boolean> {
  const state = useWorkspaceStore.getState()
  if (input.sourceCourseId === input.targetCourseId) return false
  const unavailable = (): false => {
    showToast('창을 옮기지 못했어요. 출발 과목에서 창을 확인한 뒤 다시 시도해 주세요.', 'danger')
    return false
  }
  if ((input.sourceCourseId !== null && discardedCourses.has(input.sourceCourseId)) || discardedCourses.has(input.targetCourseId)) return unavailable()
  const source = workspaceApiForWindow(input.sourceCourseId), target = workspaceApiForWindow(input.targetCourseId)
  const panel = source?.getPanel(input.panelId)
  if (!source || !target || !panel || !hydratedCourses.has(input.targetCourseId) || !isTabDescriptor(panel.params?.descriptor)) return unavailable()
  // Hydration gives colliding saved views unique editor IDs; the original
  // canonical view must still reject a duplicate document in the destination.
  if (target.getPanel(input.panelId) || panel.id === tabPanelId(panel.params.descriptor) && findLogicalPanel(target, panel.params.descriptor)) {
    showToast('이 과목에 같은 창이 이미 열려 있어요. 출발 과목에 창을 그대로 두었어요. 도착 과목의 같은 창을 닫은 후 다시 옮겨 주세요.')
    return false
  }
  const group = input.position?.groupId ? target.getGroup(input.position.groupId) : undefined
  if (input.position?.groupId && !group) return unavailable()
  const direction = input.position?.direction
  const position = group ? { referenceGroup: group.id, direction: direction ?? 'within',
    ...(input.position?.index !== undefined ? { index: input.position.index } : {}) }
    : direction && direction !== 'within' ? { direction } : undefined
  let added: IDockviewPanel | undefined
  suppressLayoutEvents = true
  try {
    const descriptor = panel.params.descriptor
    added = target.addPanel({ id: panel.id, component: descriptor.kind,
      title: panel.title ?? tabTitle(descriptor), params: { ...panel.params },
      ...(position ? { position } : {}) })
    rebindPanelContent(panel.api, added.api, target, input.targetCourseId)
    closeWorkspacePanel(source, panel.id, 'transfer')
    if (descriptor.kind === 'browser') useBrowserGuests.getState().setGuestCourse(descriptor.payload.tabId, workspaceFromKey(input.targetCourseId).courseId)
    // Publish both live ownership snapshots before subscribers (guest reaping).
    if (input.sourceCourseId !== null) runtimeLayouts.set(input.sourceCourseId, source.toJSON())
    runtimeLayouts.set(input.targetCourseId, target.toJSON())
    if (api && state.activeWindowKey) {
      useWorkspaceStore.setState({ openTabs: tabsFromLayout(api.toJSON()), activePanelId: api.activePanel?.id ?? null })
    }
  } catch (error) {
    if (added && source.getPanel(panel.id) === panel) {
      rebindPanelContent(added.api, panel.api, source, input.sourceCourseId)
      target.removePanel(added)
    }
    console.error('[Bandal] 창을 옮기지 못했습니다.', error)
    showToast('창을 옮기지 못했어요. 원래 창에서 다시 시도해 주세요.', 'danger')
    return false
  } finally { suppressLayoutEvents = false }
  state.saveRetainedLayout(input.sourceCourseId, source.toJSON())
  state.saveRetainedLayout(input.targetCourseId, target.toJSON())
  if (state.activeWindowKey === input.targetCourseId) state.notifyLayoutChanged()
  state.flushPendingSave()
  return true
}

/** Resolve ownership independently of whichever course is currently selected. */
export function browserTabWorkspace(tabId: string): WorkspaceRef | null {
  const ownsTab = (descriptor: unknown): boolean =>
    isTabDescriptor(descriptor) && descriptor.kind === 'browser' && descriptor.payload.tabId === tabId
  // A newly adopted popup can mount before its retained layout snapshot updates.
  for (const [courseId, courseApi] of courseApis) {
    if (courseId !== null && discardedCourses.has(courseId)) continue
    if (courseApi.panels.some(panel => ownsTab(panel.params?.descriptor))) return courseId === null ? null : workspaceFromKey(courseId)
  }
  const state = useWorkspaceStore.getState()
  if ((state.activeWindowKey === null || !discardedCourses.has(state.activeWindowKey)) && Object.values(state.openTabs).some(ownsTab)) return state.activeWorkspace
  for (const [courseId, layout] of runtimeLayouts) {
    if (!discardedCourses.has(courseId) && Object.values(tabsFromLayout(layout)).some(ownsTab)) return workspaceFromKey(courseId)
  }
  const staged = ownedWorkspaceOpens.get(`browser:${tabId}`) ?? [...ownedWorkspaceOpens.values()].find(open => ownsTab(open.descriptor))
  if (staged && !discardedCourses.has(staged.key)) return workspaceFromKey(staged.key)
  return null
}

export function browserTabCourseId(tabId: string): string | null { return browserTabWorkspace(tabId)?.courseId ?? null }

/** Site-created pages belong to their opener even while its course is hidden. */
export function openBrowserTabInCourse(descriptor: TabDescriptor, ownerId: string | null | undefined, background: boolean, openerTabId?: string, shouldOpen?: () => boolean): boolean {
  if (shouldOpen && !shouldOpen()) return false
  const state = useWorkspaceStore.getState()
  const openerKey = openerTabId ? workspaceCourseForPanel(`browser:${openerTabId}`) : null
  const pendingOwner = requestedTransitionKey && ownerId && workspaceFromKey(requestedTransitionKey).courseId === ownerId ? requestedTransitionKey : null
  const courseId = openerKey ?? pendingOwner ?? (ownerId !== undefined && ownerId !== null && state.activeCourseId === ownerId ? state.activeWindowKey : ownerId === null || ownerId === undefined ? ownerId : selectedWindowKey(ownerId))
  if (courseId !== undefined && courseId !== null && discardedCourses.has(courseId)) return false
  if (courseId && courseId === requestedTransitionKey && courseId !== state.activeWindowKey) {
    const staged: OwnedWorkspaceOpen = { requestId: tabPanelId(descriptor), key: courseId, descriptor, background,
      followSavedSelection: !openerKey && workspaceWindowFromKey(courseId).windowId === DEFAULT_WORKSPACE_WINDOW_ID && !runtimeLayouts.has(courseId),
      ...(shouldOpen ? { shouldOpen } : {}) }
    ownedWorkspaceOpens.set(staged.requestId, staged)
    void materializeOwnedWorkspaceOpen(staged)
    return true
  }
  const target = courseId === undefined ? undefined : courseApis.get(courseId)
  if (courseId === undefined || courseId === state.activeWindowKey) {
    state.openTab(descriptor, { background, ...(shouldOpen ? { shouldOpen } : {}) })
    return true
  }
  if (!target) {
    // A popup from an evicted course stays with its opener. Never silently
    // route an explicitly owned page into the currently selected course.
    if (courseId === null || !runtimeLayouts.has(courseId)) return false
    const layout = appendRetainedBrowserTab(runtimeLayouts.get(courseId), descriptor)
    state.saveRetainedLayout(courseId, layout)
    return true
  }
  const previous = target.activePanel
  target.addPanel({ id: tabPanelId(descriptor), component: descriptor.kind, title: tabTitle(descriptor), params: { descriptor } })
  previous?.api.setActive()
  const layout = target.toJSON()
  state.saveRetainedLayout(courseId!, layout)
  return true
}

/** Explicit opens survive canceled navigation without mounting a hidden canvas. */
async function materializeOwnedWorkspaceOpen(open: OwnedWorkspaceOpen): Promise<void> {
  const requestId = open.requestId, base = workspaceWindowFromKey(open.key).workspaceKey
  try {
    if (!runtimeLayouts.has(open.key)) {
      const saved = await invoke('layout:get', workspaceLayoutScope(workspaceFromKey(base)))
      const converted = await convertStoredWindows(base, saved.layout)
      if (ownedWorkspaceOpens.get(requestId) !== open || discardedCourses.has(base) || discardedCourses.has(open.key)) return
      if (!loadedWindowCollection(base)) {
        windowCollections.set(base, converted.collection)
        if (isWorkspaceWindows(saved.layout)) envelopeWorkspaces.add(base)
        for (const window of converted.collection.windows) runtimeLayouts.set(workspaceWindowKey(base, window.id), window.layout)
      }
      if (open.followSavedSelection) open.key = workspaceWindowKey(base, collectionFor(base).activeWindowId)
    }
    if (ownedWorkspaceOpens.get(requestId) !== open || discardedCourses.has(open.key) || open.shouldOpen && !open.shouldOpen()) return
    if (!collectionFor(base).windows.some(window => window.id === workspaceWindowFromKey(open.key).windowId)) throw new Error('원래 윈도우가 닫혔습니다.')
    const state = useWorkspaceStore.getState(), target = courseApis.get(open.key)
    const id = open.newInstance && open.descriptor.kind !== 'browser' ? createDuplicatePanelId(open.descriptor) : newPanelId(open.descriptor, open.key)
    if (target && hydratedCourses.has(open.key)) {
      const group = open.groupId ? target.getGroup(open.groupId) : undefined
      if (open.groupId && !group) throw new Error('원래 작업 영역이 닫혔습니다.')
      const existing = open.newInstance ? undefined : findLogicalPanel(target, open.descriptor)
      if (existing) {
        existing.api.updateParameters({ ...existing.params, descriptor: open.descriptor })
        if (!open.background) existing.api.setActive()
      } else {
        const previous = target.activePanel
        target.addPanel({ id, component: open.descriptor.kind, title: tabTitle(open.descriptor), params: { descriptor: open.descriptor }, inactive: open.background,
          ...(group ? { position: { referenceGroup: group.id, index: group.panels.length } } : {}) })
        if (open.background) previous?.api.setActive()
      }
      state.saveRetainedLayout(open.key, target.toJSON())
      if (state.activeWindowKey === open.key) {
        state.notifyLayoutChanged()
        finishMaterialOpen(open.descriptor, open.background)
      }
      open.onOpened?.(existing?.id ?? id)
    } else {
      const raw = runtimeLayouts.get(open.key)
      const layout = appendRetainedTab(raw === null || raw === undefined || typeof raw === 'object' && Object.keys(raw).length === 0 ? emptyWindowLayout() : raw, open.descriptor, id,
        { groupId: open.groupId, background: open.background, newInstance: open.newInstance })
      if (!layout) throw new Error('원래 작업 영역을 읽지 못했습니다.')
      state.saveRetainedLayout(open.key, layout)
      open.onOpened?.(open.newInstance ? id : Object.entries(tabsFromLayout(layout)).find(([, tab]) => tabPanelId(tab) === tabPanelId(open.descriptor))?.[0] ?? id)
    }
  } catch (error) {
    console.error('[workspace] 탭을 원래 공간에 열지 못했습니다.', error)
    showToast('탭을 열지 못했어요. 원래 공간에서 다시 시도해 주세요.', 'danger')
  } finally {
    if (ownedWorkspaceOpens.get(requestId) === open) ownedWorkspaceOpens.delete(requestId)
    const state = useWorkspaceStore.getState()
    useWorkspaceStore.setState({ openTabs: { ...state.openTabs } })
  }
}

type RetainedLayout = ReturnType<DockviewApi['toJSON']>
/** Async work can finish after LRU eviction; keep the captured canvas without mounting it. */
function appendRetainedTab(raw: unknown, descriptor: TabDescriptor, id: string, options: { groupId: string | undefined; background: boolean | undefined; newInstance: boolean | undefined }): RetainedLayout | null {
  const empty = typeof raw === 'object' && raw !== null && 'panels' in raw && typeof raw.panels === 'object' && raw.panels !== null && Object.keys(raw.panels).length === 0 && 'grid' in raw
  const restored = validateLayout(raw)?.layout ?? (empty ? emptyWindowLayout() : null)
  if (!restored) return null
  const layout = structuredClone(restored)
  const groups: Array<{ id: string; views: string[]; activeView?: string }> = []
  const visit = (node: RetainedLayout['grid']['root']): void => {
    if (Array.isArray(node.data)) node.data.forEach(visit)
    else groups.push(node.data)
  }
  visit(layout.grid.root)
  let group = options.groupId ? groups.find(group => group.id === options.groupId) : groups.find(group => group.id === layout.activeGroup) ?? groups[0]
  if (options.groupId && !group) return null
  const existing = options.newInstance ? undefined : Object.entries(tabsFromLayout(layout)).find(([, tab]) => tabPanelId(tab) === tabPanelId(descriptor))?.[0]
  if (existing) {
    id = existing
    const panel = layout.panels[id]!
    layout.panels[id] = { ...panel, params: { ...panel.params, descriptor } }
    group = groups.find(group => group.views.includes(id)) ?? group
  } else {
    layout.panels[id] = { id, contentComponent: descriptor.kind, title: tabTitle(descriptor), params: { descriptor } }
    if (group) group.views.push(id)
    else {
      group = { id: `pane-${crypto.randomUUID()}`, views: [id], activeView: id }
      layout.grid.root = { type: 'branch', data: [{ type: 'leaf', data: group }] }
    }
  }
  if (group && !options.background) { group.activeView = id; layout.activeGroup = group.id }
  return layout
}
function appendRetainedBrowserTab(raw: unknown, descriptor: TabDescriptor): RetainedLayout {
  const restored = validateLayout(raw)?.layout
  const layout: RetainedLayout = restored ? structuredClone(restored) : {
    grid: { root: { type: 'branch', data: [] }, width: 0, height: 0, orientation: 'HORIZONTAL' as RetainedLayout['grid']['orientation'] },
    panels: {}
  }
  const id = tabPanelId(descriptor)
  if (layout.panels[id]) return layout
  layout.panels[id] = { id, contentComponent: descriptor.kind, title: tabTitle(descriptor), params: { descriptor } }
  const groups: Array<{ id: string; views: string[]; activeView?: string }> = []
  const visit = (node: RetainedLayout['grid']['root']): void => {
    if (Array.isArray(node.data)) node.data.forEach(visit)
    else groups.push(node.data)
  }
  visit(layout.grid.root)
  const group = groups.find(group => group.id === layout.activeGroup) ?? groups[0]
  if (group) group.views.push(id)
  else {
    const groupId = `browser-${id}`
    layout.grid.root = { type: 'branch', data: [{ type: 'leaf', data: { id: groupId, views: [id], activeView: id } }] }
    layout.activeGroup = groupId
  }
  return layout
}

export function closeBrowserTab(tabId: string): void {
  const state = useWorkspaceStore.getState()
  const apis = new Set([...courseApis.values(), ...(api ? [api] : [])])
  for (const target of apis) {
    let changed = false
    for (const panel of [...target.panels]) {
      const descriptor = panel.params?.descriptor
      if (isTabDescriptor(descriptor) && descriptor.kind === 'browser' && descriptor.payload.tabId === tabId) {
        panel.api.close()
        changed = true
      }
    }
    if (changed) for (const [courseId, courseApi] of courseApis) {
      if (courseApi === target) {
        if (courseId === state.activeWindowKey) state.notifyLayoutChanged()
        else state.saveRetainedLayout(courseId, target.toJSON())
      }
    }
  }
  // Site-created tabs can close themselves while their course has no Dockview.
  for (const [courseId, raw] of runtimeLayouts) {
    if (courseApis.has(courseId)) continue
    const ids = Object.entries(tabsFromLayout(raw)).filter(([, descriptor]) =>
      descriptor.kind === 'browser' && descriptor.payload.tabId === tabId).map(([id]) => id)
    if (!ids.length) continue
    const layout = structuredClone(raw) as RetainedLayout
    for (const id of ids) delete layout.panels[id]
    const remaining = validateLayout(layout)?.layout ?? {
      ...layout, panels: {}, grid: { ...layout.grid, root: { type: 'branch' as const, data: [] } }
    }
    state.saveRetainedLayout(courseId, remaining)
  }
}

function belongsToLearningSpace(descriptor: TabDescriptor, binding: LearningBinding, standalone: boolean): boolean {
  if (standalone) return true
  if (descriptor.kind === 'learning' || descriptor.kind === 'learning-resource') return descriptor.payload.courseId === binding.courseId && descriptor.payload.rootRelPath === binding.rootRelPath
  if (!binding.rootRelPath || !('courseId' in descriptor.payload) || descriptor.payload.courseId !== binding.courseId || !('relPath' in descriptor.payload)) return false
  return descriptor.payload.relPath === binding.rootRelPath || descriptor.payload.relPath.startsWith(`${binding.rootRelPath}/`)
}

function learningSpaceKey(binding: LearningBinding): string {
  const key = workspaceKey({ kind: 'project', ...binding })
  return windowCollections.has(key) || courseApis.has(key) || runtimeLayouts.has(key) || useWorkspaceStore.getState().activeWorkspaceKey === key ? key : binding.courseId
}

/** Check every window before removing a project, including native pages without a resource owner. */
export async function prepareCloseLearningSpace(binding: LearningBinding, standalone: boolean): Promise<boolean> {
  const base = learningSpaceKey(binding), projectPlacement = base !== binding.courseId
  const descriptors = workspacePanelPlacements().filter(placement => {
    const placementBase = workspaceWindowFromKey(placement.courseId).workspaceKey
    return standalone && workspaceFromKey(placement.courseId).courseId === binding.courseId ||
      projectPlacement && placementBase === base || belongsToLearningSpace(placement.descriptor, binding, standalone && 'courseId' in placement.descriptor.payload && placement.descriptor.payload.courseId === binding.courseId)
  }).map(placement => placement.descriptor)
  try {
    for (const descriptor of descriptors) if (!await canCloseTab(descriptor)) return false
    return true
  } catch {
    showToast('학습 공간의 탭을 닫지 못했어요. 다시 시도해 주세요.', 'danger')
    return false
  }
}

/** Remove already-deleted resources from all mounted, evicted and closed window layouts. */
export async function closeLearningSpace(binding: LearningBinding, standalone: boolean): Promise<boolean> {
  const state = useWorkspaceStore.getState(), base = learningSpaceKey(binding), projectPlacement = base !== binding.courseId
  const matches = (descriptor: TabDescriptor): boolean => standalone
    ? 'courseId' in descriptor.payload && descriptor.payload.courseId === binding.courseId
    : belongsToLearningSpace(descriptor, binding, false)
  const keys = new Set([...runtimeLayouts.keys(), ...courseApis.keys()])
  const removedKeys = [...keys].filter((key): key is string => key !== null && (standalone
    ? workspaceFromKey(key).courseId === binding.courseId : projectPlacement && workspaceWindowFromKey(key).workspaceKey === base))
  const activeRemoved = state.activeWindowKey !== null && removedKeys.includes(state.activeWindowKey)
  if (standalone) state.discardPendingSave(binding.courseId)
  else if (projectPlacement) state.discardWorkspace({ kind: 'project', ...binding })
  closedTabs = closedTabs.filter(tab => !removedKeys.includes(tab.courseId ?? '') && !matches(tab.descriptor))
  suppressLayoutEvents = true
  try { for (const key of removedKeys) courseApis.get(key)?.clear() } finally { suppressLayoutEvents = false }
  closeResourceTabs(matches)
  if (activeRemoved) {
    useWorkspaceStore.setState({ openTabs: {}, activePanelId: null })
    state.showWorkspace(null)
  }
  return true
}
