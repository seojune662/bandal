import { useAgentRuns } from '../browser/AgentRunBanner'
import { CourseActivity } from './courseActivity'
import { flushWorkspaceNotes } from './workspaceNoteFlush'
import { useTemporaryWorkspaceRetention } from './useTemporaryWorkspaceRetention'
/**
 * Dockview host for the tabbed workspace (center region of the shell).
 * Owns: dockview mounting, the custom tab/watermark/header chrome, the
 * store wiring (api attach + layout-change relay + beforeunload flush) and
 * course-switch hydration.
 */

import { lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IWatermarkPanelProps
} from 'dockview'
import 'dockview/dist/styles/dockview.css'
import { Icon } from '../../app/icons'
import { createBrowserTab, createMarkdownTab } from '../../app/tabCommands'
import { BandalMark } from '../../components/BandalMark'
import { Tooltip } from '../../components/Tooltip'
import { useLocale } from '../../i18n'
import { flushLastActiveCoursePersist, useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { useWorkspaceStore, retainedTabDescriptors, isWorkspaceDiscarded, registerBeforeWorkspaceWindowLeave, onWorkspaceWindowRemoved } from '../../stores/workspaceStore'
import { useFileDropTarget } from '../materials/useFileDropTarget'
import { NewTabMenu } from './NewTabMenu'
import { WorkspaceTab } from './WorkspaceTab'
import { openNewTabMenu, useNewTabMenu } from './newTabMenuController'
import { installWorkspaceDragSession, tabDragSession } from './tabDragSession'
import { dockviewComponents, workspacePanelContents } from './tabRegistry'
import { WorkspaceCourseContext, WorkspaceRefContext, WorkspaceWindowContext } from './placementContext'
import { WorkspaceContentLayer, schedulePanelContentLayout } from './panelContentHost'
import { CourseTabMoveOverlay } from './CourseTabMoveOverlay'
import { installWorkspaceCourseMoveNavigation, workspaceCourseMoveRetention } from './courseTabMoveNavigation'
import { focusWorkspaceHeader, headerChromeInset, installAdaptiveTabs, minimumHeaderWidth } from './adaptiveTabs'
import { OpenTabsAction } from './OpenTabsMenu'
import { WorkspaceLayoutMenu } from './WorkspaceLayoutMenu'
import { applyWorkspaceLayout, removeEmptyWorkspaceGroup, splitWorkspaceGroup, type WorkspaceLayoutPreset } from './workspaceLayout'
import { TabKindIcon } from './workspaceIcons'
import './workspace.css'
import { workspaceFromKey } from '../../../../shared/types/workspace'
import { invoke, onPush } from '../../lib/ipc'
import { workspaceWindowFromKey, type WorkspaceChromeMode } from '../../../../shared/workspaceWindows'
import { WorkspaceWindowsOverview } from './WorkspaceWindowsOverview'
import { flushPanelViewStates } from './panelViewState'
import { captureCurrentWindowPreview } from './windowOverviewController'
import { deleteWindowPreview } from './windowPreview'
import { scheduleBrowserAnchorLayout } from './panels/browserAnchor'
import { setNativeHostBlocked } from '../browser/nativeHostVisibility'

const StudyMarketHome = lazy(() => import('../studyMarket/StudyMarketHome'))
const CommunityHome = lazy(() => import('../community/CommunityHome'))

const bandalTheme: DockviewTheme = {
  name: 'bandal',
  className: 'bandal-dockview',
  gap: 8,
  dndOverlayMounting: 'absolute',
  dndPanelOverlay: 'content'
}

// The hit zone stays narrow; the preview shows the space the new split receives.
const workspaceDragEdges = {
  activationSize: { value: 12, type: 'pixels' as const },
  size: { value: 50, type: 'percentage' as const }
}

export function Watermark(props: IWatermarkPanelProps): JSX.Element {
  const ko = useLocale() === 'ko-KR'
  const placementCourseId = useContext(WorkspaceCourseContext)
  const workspace = useContext(WorkspaceRefContext)
  const windowId = useContext(WorkspaceWindowContext)
  const [projectTitle, setProjectTitle] = useState<string | null>(null)
  const rootRelPath = workspace?.kind === 'project' ? workspace.rootRelPath : undefined
  useEffect(() => {
    setProjectTitle(null)
    if (rootRelPath === undefined || placementCourseId === null) return
    let cancelled = false
    const refresh = (): void => { void invoke('learning:get', { binding: { courseId: placementCourseId, rootRelPath } }).then(project => { if (!cancelled) setProjectTitle(project.name) }).catch(() => {}) }
    refresh()
    const stop = onPush('learning:changed', event => { if (event.binding.courseId === placementCourseId && event.binding.rootRelPath === rootRelPath) refresh() })
    return () => { cancelled = true; stop() }
  }, [placementCourseId, rootRelPath])
  const courses = useCoursesStore((state) => state.courses)
  const course =
    courses.find((entry) => entry.id === placementCourseId) ?? null
  const split = useSyncExternalStore(
    listener => {
      const subscription = props.containerApi.onDidLayoutChange(listener)
      return () => subscription.dispose()
    },
    () => props.containerApi.groups.length > 1
  )
  const { isDropActive, dropProps } = useFileDropTarget(course?.id ?? null, rootRelPath ?? '')
  const target = props.group ? { courseId: placementCourseId, workspace, windowId, groupId: props.group.id } : undefined

  // Closing or transferring the last tab preserves its pane. A lone empty
  // pane is still the course home, including layouts saved by older versions.
  if (props.group && split) return <div className="workspace-empty-pane" {...dropProps} data-drop-active={isDropActive || undefined}>
    <BandalMark size={32} />
    <span>{ko ? '이 영역에서 새 탭을 여세요' : 'Open a tab in this pane'}</span>
    <button type="button" className="button" onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (course) openNewTabMenu({ x: rect.left, y: rect.bottom, ...(target ? { target } : {}) })
      else createBrowserTab(undefined, target)
    }}><Icon name="plus" />{ko ? '새 탭 열기' : 'Open new tab'}</button>
    {props.containerApi.groups.length > 1 && <button type="button" className="button" onClick={() => removeEmptyWorkspaceGroup(props.containerApi, props.group!.id)}>{ko ? '빈 영역 닫기' : 'Close empty pane'}</button>}
  </div>

  if (course === null) {
    return (
      <div className="workspace-watermark">
        <BandalMark size={56} className="workspace-watermark__moon" />
      </div>
    )
  }
  return (
    <div
      className="workspace-watermark"
      data-drop-active={isDropActive || undefined}
      {...dropProps}
    >
      <section className="workspace-welcome" aria-label={ko ? '학습 공간' : 'Your workspace'}>
        <BandalMark size={48} className="workspace-watermark__moon" />
        <h1>{projectTitle ?? course.name}</h1>
        <p className="workspace-watermark__hint">{ko ? '읽고, 기록하고, 연결하는 나만의 학습 공간' : 'A space to read, write, and connect your ideas.'}</p>
        <div className="workspace-start-actions" aria-label={ko ? '학습 시작' : 'Start studying'}>
          <button type="button" onClick={() => void createMarkdownTab(undefined, target)}>
            <span className="workspace-start-actions__icon"><TabKindIcon kind="note" /></span>
            <span className="workspace-start-actions__copy"><strong>{ko ? '새 필기' : 'New note'}</strong><span>{ko ? '생각을 기록하세요' : 'Capture an idea'}</span></span>
            <Icon name="chevronRight" className="workspace-start-actions__arrow" />
          </button>
          <button type="button" onClick={() => createBrowserTab(undefined, target)}>
            <span className="workspace-start-actions__icon"><TabKindIcon kind="browser" /></span>
            <span className="workspace-start-actions__copy"><strong>{ko ? '웹 탐색' : 'Browse the web'}</strong><span>{ko ? '자료를 찾아보세요' : 'Find your sources'}</span></span>
            <Icon name="chevronRight" className="workspace-start-actions__arrow" />
          </button>
          <button type="button" onClick={() => useUiStore.getState().showAssistant()}>
            <span className="workspace-start-actions__icon"><TabKindIcon kind="chat" /></span>
            <span className="workspace-start-actions__copy"><strong>{ko ? 'AI와 공부' : 'Study with AI'}</strong><span>{ko ? '질문에서 시작하세요' : 'Start with a question'}</span></span>
            <Icon name="chevronRight" className="workspace-start-actions__arrow" />
          </button>
        </div>
        <button
          type="button"
          className="workspace-watermark__cta"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            openNewTabMenu({ x: rect.left, y: rect.bottom + 8, ...(target ? { target } : {}) })
          }}
        >
          <Icon name="plus" />{ko ? '새 탭 열기' : 'Open new tab'}
        </button>
      </section>
    </div>
  )
}

function AddTabAction(props: IDockviewHeaderActionsProps): JSX.Element {
  const courseId = useContext(WorkspaceCourseContext)
  const workspace = useContext(WorkspaceRefContext)
  const windowId = useContext(WorkspaceWindowContext)
  return (
    <div className="workspace-tab-actions">
      <Tooltip label="새 탭 열기" placement="bottom">
        <button
          type="button"
          className="workspace-add-tab"
          aria-label="새 탭 열기"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            props.api.setActive()
            const target = { courseId, workspace, windowId, groupId: props.group.id }
            if (courseId === null) createBrowserTab(undefined, target)
            else openNewTabMenu({ x: rect.left, y: rect.bottom, target })
          }}
        >
          <Icon name="plus" />
        </button>
      </Tooltip>
    </div>
  )
}

function HeaderActions(props: IDockviewHeaderActionsProps): JSX.Element {
  const courseId = useContext(WorkspaceCourseContext)
  const workspace = useContext(WorkspaceRefContext)
  const windowId = useContext(WorkspaceWindowContext)
  const ko = useLocale() === 'ko-KR'
  const rightRailOpen = useUiStore(state => state.rightRailOpen)
  useLayoutEffect(() => {
    let frame = 0, previous = -1
    const root = props.group.element.closest<HTMLElement>('.workspace-host')
    const header = props.group.element.querySelector<HTMLElement>(':scope > .dv-tabs-and-actions-container')
    if (!root || !header) return
    const measure = (): void => {
      frame = 0
      const width = root.getBoundingClientRect().width
      if (!width || header.closest('.workspace-course[hidden]')) return
      const minimumWidth = minimumHeaderWidth(headerChromeInset(header), width)
      if (minimumWidth !== previous) { previous = minimumWidth; props.api.setConstraints({ minimumWidth }) }
    }
    const schedule = (): void => { if (!frame) frame = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    resize.observe(root); resize.observe(header)
    for (const element of header.querySelectorAll('.dv-pre-actions-container, .workspace-group-actions')) resize.observe(element)
    const subscription = props.containerApi.onDidLayoutChange(schedule)
    measure()
    return () => { cancelAnimationFrame(frame); resize.disconnect(); subscription.dispose() }
  }, [props.api, props.containerApi, props.group, rightRailOpen])
  const runLayout = (close: () => void, action: () => void): void => {
    close()
    action()
    requestAnimationFrame(() => focusWorkspaceHeader(props.containerApi.activeGroup?.element))
  }
  const presets: [WorkspaceLayoutPreset, string][] = [['single', ko ? '단일 영역' : 'Single pane'], ['columns', ko ? '좌우 2분할' : 'Two columns'], ['rows', ko ? '상하 2분할' : 'Two rows'], ['grid', ko ? '2×2 4분할' : 'Four panes (2×2)']]
  return <div className="workspace-group-actions">
    <OpenTabsAction {...props} menuActions={close => <>
      <button type="button" onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        close(); props.api.setActive()
        const target = { courseId, workspace, windowId, groupId: props.group.id }
        if (courseId === null) createBrowserTab(undefined, target)
        else openNewTabMenu({ x: rect.left, y: rect.bottom, target })
      }}>{ko ? '새 탭 열기' : 'Open new tab'}</button>
      {presets.map(([preset, label]) => <button key={preset} type="button" onClick={() => runLayout(close, () => applyWorkspaceLayout(props.containerApi, preset))}>{label}</button>)}
      <button type="button" onClick={() => runLayout(close, () => { splitWorkspaceGroup(props.containerApi, props.group.id, 'right') })}>{ko ? '이 영역을 좌우로 나누기' : 'Split this pane right'}</button>
      <button type="button" onClick={() => runLayout(close, () => { splitWorkspaceGroup(props.containerApi, props.group.id, 'below') })}>{ko ? '이 영역을 상하로 나누기' : 'Split this pane down'}</button>
      {props.group.panels.length === 0 && props.containerApi.groups.length > 1 && <button type="button" onClick={() => runLayout(close, () => { removeEmptyWorkspaceGroup(props.containerApi, props.group.id) })}>{ko ? '빈 영역 닫기' : 'Close empty pane'}</button>}
    </>} />
    <span className="workspace-header-layout-control"><WorkspaceLayoutMenu {...props} /></span>
  </div>
}

function CourseWorkspace({ courseId, active, chromeMode }: { courseId: string | null; active: boolean; chromeMode: WorkspaceChromeMode }): JSX.Element {
  const windowId = courseId === null ? 'main' : workspaceWindowFromKey(courseId).windowId
  const apiRef = useRef<import('dockview').DockviewApi | null>(null)
  const applyChrome = (): void => {
    const api = apiRef.current
    if (!api || !active) return
    let changed = false
    for (const group of api.groups) {
      const hidden = chromeMode !== 'all'
      if (group.header.hidden !== hidden) { group.header.hidden = hidden; changed = true }
    }
    if (changed && rootRef.current) api.layout(rootRef.current.clientWidth, rootRef.current.clientHeight, true)
    schedulePanelContentLayout(); scheduleBrowserAnchorLayout()
  }
  const applyChromeRef = useRef(applyChrome)
  applyChromeRef.current = applyChrome
  useLayoutEffect(() => applyChromeRef.current(), [active, chromeMode])
  const workspace = courseId === null ? null : workspaceFromKey(courseId)
  const ownerId = workspace?.courseId ?? null
  const ko = useLocale() === 'ko-KR'
  const failed = useWorkspaceStore(state => active && state.hydration === 'error')
  const rootRef = useRef<HTMLDivElement>(null)
  const layoutSubscription = useRef<{ dispose: () => void } | null>(null)
  const frame = useRef<number | null>(null)
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    layoutSubscription.current?.dispose()
    useWorkspaceStore.getState().detachWindowApi(courseId)
  }, [courseId])
  const onReady = (event: DockviewReadyEvent): void => {
    apiRef.current = event.api
    useWorkspaceStore.getState().attachWindowApi(courseId, event.api)
    const layout = event.api.onDidLayoutChange(() => {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        applyChromeRef.current()
        const store = useWorkspaceStore.getState()
        if (store.activeWindowKey === courseId) store.notifyLayoutChanged()
      })
    })
    const overlay = event.api.onWillShowOverlay((event) => {
      const source = tabDragSession.getSource()
      if (useWorkspaceStore.getState().activeWindowKey !== courseId || source) {
        event.preventDefault()
        return
      }
      if (rootRef.current) rootRef.current.dataset.dropKind = event.kind
    })
    const drop = event.api.onWillDrop(event => {
      const root = rootRef.current
      const bounds = root?.getBoundingClientRect()
      const native = event.nativeEvent
      if (native.type !== 'drop' || tabDragSession.getSource() || useWorkspaceStore.getState().activeWindowKey !== courseId ||
        !bounds || native.clientX < bounds.left || native.clientX > bounds.right || native.clientY < bounds.top || native.clientY > bounds.bottom) event.preventDefault()
    })
    layoutSubscription.current = { dispose: () => { layout.dispose(); overlay.dispose(); drop.dispose() } }
  }
  return <WorkspaceWindowContext.Provider value={windowId}><WorkspaceRefContext.Provider value={workspace}><WorkspaceCourseContext.Provider value={ownerId}><CourseActivity.Provider value={active}>
    <div ref={rootRef} className="workspace-course" hidden={!active} aria-hidden={!active || failed} {...{ inert: !active || failed ? '' : undefined }} data-workspace-course={ownerId ?? ''} data-workspace-key={workspaceWindowFromKey(courseId ?? '').workspaceKey} data-workspace-window={windowId} data-window-key={courseId ?? ''} data-drop-language={ko ? 'ko' : 'en'}>
      <DockviewReact
        theme={bandalTheme}
        dndEdges={workspaceDragEdges}
        scrollbars="native"
        disableTabsOverflowList
        components={dockviewComponents}
        defaultRenderer="always"
        defaultTabComponent={WorkspaceTab}
        watermarkComponent={Watermark}
        leftHeaderActionsComponent={AddTabAction}
        rightHeaderActionsComponent={HeaderActions}
        onReady={onReady}
      />
    </div>
  </CourseActivity.Provider></WorkspaceCourseContext.Provider></WorkspaceRefContext.Provider></WorkspaceWindowContext.Provider>
}

export function WorkspaceHost(): JSX.Element {
  const ko = useLocale() === 'ko-KR'
  const surface = useWorkspaceStore(state => state.surface)
  const hydration = useWorkspaceStore(state => state.hydration)
  const retryHydration = useWorkspaceStore(state => state.retryHydration)
  const courses = useCoursesStore(state => state.courses)
  const selectedCourseId = useCoursesStore(state => state.selectedCourseId)
  const workspace = useWorkspaceStore(state => state.activeWorkspace)
  const course = courses.find(entry => entry.id === workspace?.courseId) ?? null
  const courseId = useWorkspaceStore(state => state.activeWindowKey)
  const chromeMode = useWorkspaceStore(state => state.workspaceChromeMode)
  const overviewOpen = useWorkspaceStore(state => state.windowsOverviewOpen)
  const [retained, setRetained] = useState<string[]>([])
  const retainEmpty = useTemporaryWorkspaceRetention()
  const dragSource = useSyncExternalStore(tabDragSession.subscribe, tabDragSession.getSource)
  const pendingMoves = useSyncExternalStore(workspaceCourseMoveRetention.subscribe, workspaceCourseMoveRetention.getSnapshot)
  const dragCourseId = dragSource?.courseId
  const alive = retained.filter(id => !isWorkspaceDiscarded(id) && courses.some(course => course.id === workspaceFromKey(id).courseId))
  const ids = [...new Set([...alive.filter(id => id !== courseId), ...(courseId ? [courseId] : []),
    ...(dragCourseId && courses.some(course => course.id === workspaceFromKey(dragCourseId).courseId) ? [dragCourseId] : []),
    ...pendingMoves.flatMap(source => source.courseId && courses.some(course => course.id === workspaceFromKey(source.courseId!).courseId) ? [source.courseId] : [])])]
  const isMenuOpen = useNewTabMenu(state => state.isOpen)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => registerBeforeWorkspaceWindowLeave(captureCurrentWindowPreview), [])
  useEffect(() => onWorkspaceWindowRemoved((workspaceKey, windowId) => {
    void deleteWindowPreview(workspaceKey, windowId).catch(() => {})
  }), [])
  useLayoutEffect(() => {
    setNativeHostBlocked('window-overview', overviewOpen)
    return () => setNativeHostBlocked('window-overview', false)
  }, [overviewOpen])
  useLayoutEffect(() => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && (focused.closest('[data-workspace-toolbar]') && chromeMode === 'all-hidden' || focused.closest('.dv-tabs-and-actions-container') && chromeMode !== 'all')) hostRef.current?.focus({ preventScroll: true })
    schedulePanelContentLayout(); scheduleBrowserAnchorLayout()
  }, [chromeMode])

  useEffect(() => {
    if (surface === 'course' || surface === 'learning-home') return
    const focus = (): boolean => {
      const heading = hostRef.current?.querySelector<HTMLElement>(surface === 'community' ? '.community h1' : surface === 'study-market' ? '.study-market h1' : '.learning-global-home h1')
      if (!heading || heading.closest('[inert], [hidden]')) return false
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
      return document.activeElement === heading
    }
    if (focus()) return
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect() })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['inert', 'hidden'] })
    return () => observer.disconnect()
  }, [surface])

  useLayoutEffect(() => {
    const state = useWorkspaceStore.getState()
    if (state.activeWorkspace === null && selectedCourseId !== null) state.setActiveCourse(selectedCourseId)
    useNewTabMenu.getState().close()
  }, [courseId, selectedCourseId])

  useEffect(() => {
    let cancelled = false
    setRetained(ids)
    const trim = async (): Promise<void> => {
      const keep = [...ids]
      const scopes = new Map<string, string[]>()
      for (const id of ids) {
        const base = workspaceWindowFromKey(id).workspaceKey
        scopes.set(base, [...(scopes.get(base) ?? []), id])
      }
      for (const [base, candidates] of scopes) {
        // The retention budget counts courses/projects. Evict a whole inactive
        // workspace together, keeping all canvases of the selected one alive.
        if (scopes.size <= 3) break
        const protectedScope = candidates.some(candidate => candidate === courseId || candidate === dragSource?.courseId ||
          pendingMoves.some(source => source.courseId === candidate) || retainedTabDescriptors(candidate).some(tab =>
            tab.kind === 'browser' && useAgentRuns.getState().byTab[tab.payload.tabId] !== undefined))
        if (protectedScope) continue
        let saved = true
        for (const candidate of candidates) if (!await flushWorkspaceNotes(candidate)) { saved = false; break }
        if (cancelled) return
        if (!saved) continue
        for (const candidate of candidates) keep.splice(keep.indexOf(candidate), 1)
        scopes.delete(base)
      }
      if (!cancelled && keep.length !== ids.length) setRetained(keep)
    }
    void trim()
    return () => { cancelled = true }
  }, [courseId, courses, dragSource, pendingMoves])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const stopTabs = installAdaptiveTabs(host)
    const stopNavigation = installWorkspaceCourseMoveNavigation()
    const stopSession = installWorkspaceDragSession(host)
    const flush = (): void => {
      flushPanelViewStates()
      useWorkspaceStore.getState().notifyLayoutChanged()
      useWorkspaceStore.getState().flushPendingSave()
      flushLastActiveCoursePersist()
    }
    window.addEventListener('beforeunload', flush)
    return () => { stopTabs(); stopSession(); stopNavigation(); window.removeEventListener('beforeunload', flush); flush() }
  }, [])

  return <div ref={hostRef} className="workspace-host" tabIndex={-1} data-tour="tab-strip" data-workspace-chrome={chromeMode} data-windows-overview={overviewOpen || undefined}>
    {[...ids].sort().map(id => <CourseWorkspace key={id} courseId={id} active={surface === 'course' && id === courseId && !overviewOpen} chromeMode={chromeMode} />)}
    {(retainEmpty || courseId === null || dragSource?.courseId === null || pendingMoves.some(source => source.courseId === null)) && <CourseWorkspace key="empty" courseId={null} active={surface === 'course' && courseId === null && !overviewOpen} chromeMode={chromeMode} />}
    <WorkspaceContentLayer components={workspacePanelContents} activeCourseId={courseId} active={surface === 'course' && hydration !== 'error' && !overviewOpen} />
    <CourseTabMoveOverlay />
    {overviewOpen && surface === 'course' && <WorkspaceWindowsOverview />}
    {surface === 'course' && hydration === 'error' && <div className="workspace-recovery" role="alert">
      <strong>{ko ? '작업 공간을 불러오지 못했어요.' : 'Could not load your workspace.'}</strong>
      <p>{ko ? '저장된 탭은 그대로 보존되어 있어요. 다시 불러와 주세요.' : 'Your saved tabs are preserved. Try loading them again.'}</p>
      <button type="button" className="button button--primary" onClick={retryHydration}>{ko ? '다시 불러오기' : 'Try again'}</button>
    </div>}
    {surface === 'learning-home' && <div className="workspace-watermark"><BandalMark size={56} /><p>프로젝트를 선택하세요.</p></div>}
    {surface === 'community' && <Suspense fallback={<div role="status">커뮤니티 불러오는 중…</div>}><CommunityHome /></Suspense>}
    {surface === 'study-market' && <Suspense fallback={<div role="status">마켓플레이스 불러오는 중…</div>}><StudyMarketHome /></Suspense>}
    {surface === 'course' && !overviewOpen && isMenuOpen && course !== null && <NewTabMenu course={course} />}
  </div>
}
