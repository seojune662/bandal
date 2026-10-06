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

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
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
import { useWorkspaceStore, retainedTabDescriptors } from '../../stores/workspaceStore'
import { useFileDropTarget } from '../materials/useFileDropTarget'
import { NewTabMenu } from './NewTabMenu'
import { WorkspaceTab } from './WorkspaceTab'
import { openNewTabMenu, useNewTabMenu } from './newTabMenuController'
import { descriptorFor } from './tabIdentity'
import { installWorkspaceDragSession, tabDragSession } from './tabDragSession'
import { dockviewComponents, workspacePanelContents } from './tabRegistry'
import { WorkspaceCourseContext } from './placementContext'
import { WorkspaceContentLayer } from './panelContentHost'
import { CourseTabMoveOverlay } from './CourseTabMoveOverlay'
import { installTabDragScrolling } from './tabDragScroll'
import { installTabStripWheelScrolling } from './tabStripScroll'
import { TabKindIcon } from './workspaceIcons'
import './workspace.css'
import LearningHome from '../learning/LearningHome'

const bandalTheme: DockviewTheme = {
  name: 'bandal',
  className: 'bandal-dockview',
  gap: 0,
  dndOverlayMounting: 'absolute',
  dndPanelOverlay: 'content'
}

// The hit zone stays narrow; the preview shows the space the new split receives.
const workspaceDragEdges = {
  activationSize: { value: 12, type: 'pixels' as const },
  size: { value: 50, type: 'percentage' as const }
}

function Watermark(_props: IWatermarkPanelProps): JSX.Element {
  const ko = useLocale() === 'ko-KR'
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const course =
    courses.find((entry) => entry.id === selectedCourseId) ?? null
  const { isDropActive, dropProps } = useFileDropTarget(course?.id ?? null)

  if (course === null) {
    return (
      <div className="workspace-watermark">
        <ToggleRightRail />
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
      <ToggleRightRail />
      <section className="workspace-welcome" aria-label={ko ? '학습 공간' : 'Your workspace'}>
        <BandalMark size={48} className="workspace-watermark__moon" />
        <h1>{course.name}</h1>
        <p className="workspace-watermark__hint">{ko ? '읽고, 기록하고, 연결하는 나만의 학습 공간' : 'A space to read, write, and connect your ideas.'}</p>
        <div className="workspace-start-actions" aria-label={ko ? '학습 시작' : 'Start studying'}>
          <button type="button" onClick={() => void createMarkdownTab()}>
            <span className="workspace-start-actions__icon"><TabKindIcon kind="note" /></span>
            <span className="workspace-start-actions__copy"><strong>{ko ? '새 필기' : 'New note'}</strong><span>{ko ? '생각을 기록하세요' : 'Capture an idea'}</span></span>
            <Icon name="chevronRight" className="workspace-start-actions__arrow" />
          </button>
          <button type="button" onClick={() => createBrowserTab()}>
            <span className="workspace-start-actions__icon"><TabKindIcon kind="browser" /></span>
            <span className="workspace-start-actions__copy"><strong>{ko ? '웹 탐색' : 'Browse the web'}</strong><span>{ko ? '자료를 찾아보세요' : 'Find your sources'}</span></span>
            <Icon name="chevronRight" className="workspace-start-actions__arrow" />
          </button>
          <button type="button" onClick={() => useWorkspaceStore.getState().openTab(descriptorFor('chat', { courseId: course.id, conversationId: crypto.randomUUID() }))}>
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
            openNewTabMenu({ x: rect.left, y: rect.bottom + 8 })
          }}
        >
          <Icon name="plus" />{ko ? '새 탭 열기' : 'Open new tab'}
        </button>
      </section>
    </div>
  )
}

/** Reserve fixed window controls when the sidebar is closed. */
function ChromeLeft(): JSX.Element | null {
  return <div className="workspace-chrome-spacer" aria-hidden="true" />
}

function AddTabAction(_props: IDockviewHeaderActionsProps): JSX.Element {
  return (
    <div className="workspace-tab-actions">
      <Tooltip label="새 탭 열기" placement="bottom">
        <button
          type="button"
          className="workspace-add-tab"
          aria-label="새 탭 열기"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            openNewTabMenu({ x: rect.left, y: rect.bottom })
          }}
        >
          <Icon name="plus" />
        </button>
      </Tooltip>
    </div>
  )
}

/** Same reasoning as ExpandLeftRail: needed outside the tab bar too. */
function ToggleRightRail(): JSX.Element | null {
  const materialsAvailable = useWorkspaceStore(state => state.surface === 'course' && state.activePanelSource()?.descriptor.kind !== 'learning')
  const rightRailOpen = useUiStore((state) => state.rightRailOpen)
  const toggleRightRail = useUiStore((state) => state.toggleRightRail)
  const label = rightRailOpen ? '자료 사이드바 접기' : '자료 사이드바 펼치기'

  if (!materialsAvailable) return null

  return (
    <div className="workspace-header-actions">
      <Tooltip label={label} placement="bottom">
        <button
          type="button"
          className="titlebar-button"
          aria-label={label}
          aria-pressed={rightRailOpen}
          onClick={toggleRightRail}
        >
          <Icon name="layoutRight" />
        </button>
      </Tooltip>
    </div>
  )
}

function HeaderActions(_props: IDockviewHeaderActionsProps): JSX.Element {
  return <ToggleRightRail />
}

function CourseWorkspace({ courseId, active }: { courseId: string | null; active: boolean }): JSX.Element {
  const ko = useLocale() === 'ko-KR'
  const failed = useWorkspaceStore(state => active && state.hydration === 'error')
  const rootRef = useRef<HTMLDivElement>(null)
  const layoutSubscription = useRef<{ dispose: () => void } | null>(null)
  const frame = useRef<number | null>(null)
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    layoutSubscription.current?.dispose()
    useWorkspaceStore.getState().detachCourseApi(courseId)
  }, [courseId])
  const onReady = (event: DockviewReadyEvent): void => {
    useWorkspaceStore.getState().attachCourseApi(courseId, event.api)
    const layout = event.api.onDidLayoutChange(() => {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        const store = useWorkspaceStore.getState()
        if (store.activeCourseId === courseId) store.notifyLayoutChanged()
      })
    })
    const overlay = event.api.onWillShowOverlay((event) => {
      if (rootRef.current) rootRef.current.dataset.dropKind = event.kind
    })
    layoutSubscription.current = { dispose: () => { layout.dispose(); overlay.dispose() } }
  }
  return <WorkspaceCourseContext.Provider value={courseId}><CourseActivity.Provider value={active}>
    <div ref={rootRef} className="workspace-course" hidden={!active} aria-hidden={!active || failed} {...{ inert: !active || failed ? '' : undefined }} data-workspace-course={courseId ?? ''} data-drop-language={ko ? 'ko' : 'en'}>
      <DockviewReact
        theme={bandalTheme}
        dndEdges={workspaceDragEdges}
        scrollbars="native"
        components={dockviewComponents}
        defaultRenderer="always"
        defaultTabComponent={WorkspaceTab}
        watermarkComponent={Watermark}
        prefixHeaderActionsComponent={ChromeLeft}
        leftHeaderActionsComponent={AddTabAction}
        rightHeaderActionsComponent={HeaderActions}
        onReady={onReady}
      />
    </div>
  </CourseActivity.Provider></WorkspaceCourseContext.Provider>
}

export function WorkspaceHost(): JSX.Element {
  const ko = useLocale() === 'ko-KR'
  const surface = useWorkspaceStore(state => state.surface)
  const hydration = useWorkspaceStore(state => state.hydration)
  const retryHydration = useWorkspaceStore(state => state.retryHydration)
  const courses = useCoursesStore(state => state.courses)
  const selectedCourseId = useCoursesStore(state => state.selectedCourseId)
  const course = courses.find(entry => entry.id === selectedCourseId) ?? null
  const courseId = course?.id ?? null
  const [retained, setRetained] = useState<string[]>([])
  const retainEmpty = useTemporaryWorkspaceRetention()
  const dragSource = useSyncExternalStore(tabDragSession.subscribe, tabDragSession.getSource)
  const dragCourseId = dragSource?.courseId
  const alive = retained.filter(id => courses.some(course => course.id === id))
  const ids = [...new Set([...alive.filter(id => id !== courseId), ...(courseId ? [courseId] : []),
    ...(dragCourseId && courses.some(course => course.id === dragCourseId) ? [dragCourseId] : [])])]
  const isMenuOpen = useNewTabMenu(state => state.isOpen)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (surface !== 'learning-home') return
    const focus = (): boolean => {
      const heading = hostRef.current?.querySelector<HTMLElement>('.learning-global-home h1')
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
    useWorkspaceStore.getState().setActiveCourse(courseId)
    useNewTabMenu.getState().close()
  }, [courseId])

  useEffect(() => {
    let cancelled = false
    setRetained(ids)
    const trim = async (): Promise<void> => {
      const keep = [...ids]
      for (const candidate of ids) {
        if (keep.length <= 3) break
        const running = retainedTabDescriptors(candidate).some(tab => tab.kind === 'browser' && useAgentRuns.getState().byTab[tab.payload.tabId] !== undefined)
        if (candidate === courseId || candidate === dragSource?.courseId || running || !await flushWorkspaceNotes(candidate)) continue
        if (cancelled) return
        keep.splice(keep.indexOf(candidate), 1)
      }
      if (!cancelled && keep.length !== ids.length) setRetained(keep)
    }
    void trim()
    return () => { cancelled = true }
  }, [courseId, courses, dragSource])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const stopWheel = installTabStripWheelScrolling(host)
    const stopSession = installWorkspaceDragSession(host)
    const stopDrag = installTabDragScrolling(host)
    const flush = (): void => {
      useWorkspaceStore.getState().notifyLayoutChanged()
      useWorkspaceStore.getState().flushPendingSave()
      flushLastActiveCoursePersist()
    }
    window.addEventListener('beforeunload', flush)
    return () => { stopWheel(); stopDrag(); stopSession(); window.removeEventListener('beforeunload', flush); flush() }
  }, [])

  return <div ref={hostRef} className="workspace-host" data-tour="tab-strip">
    {[...ids].sort().map(id => <CourseWorkspace key={id} courseId={id} active={surface === 'course' && id === courseId} />)}
    {(retainEmpty || courseId === null || dragSource?.courseId === null) && <CourseWorkspace key="empty" courseId={null} active={surface === 'course' && courseId === null} />}
    <WorkspaceContentLayer components={workspacePanelContents} activeCourseId={courseId} active={surface === 'course' && hydration !== 'error'} />
    <CourseTabMoveOverlay />
    {surface === 'course' && hydration === 'error' && <div className="workspace-recovery" role="alert">
      <strong>{ko ? '작업 공간을 불러오지 못했어요.' : 'Could not load your workspace.'}</strong>
      <p>{ko ? '저장된 탭은 그대로 보존되어 있어요. 다시 불러와 주세요.' : 'Your saved tabs are preserved. Try loading them again.'}</p>
      <button type="button" className="button button--primary" onClick={retryHydration}>{ko ? '다시 불러오기' : 'Try again'}</button>
    </div>}
    {surface === 'learning-home' && <LearningHome />}
    {surface === 'course' && isMenuOpen && course !== null && <NewTabMenu course={course} />}
  </div>
}
