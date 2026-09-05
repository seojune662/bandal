/**
 * Dockview host for the tabbed workspace (center region of the shell).
 * Owns: dockview mounting, the custom tab/watermark/header chrome, the
 * store wiring (api attach + layout-change relay + beforeunload flush) and
 * course-switch hydration.
 */

import { useEffect, useRef, useState } from 'react'
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IWatermarkPanelProps
} from 'dockview'
import 'dockview/dist/styles/dockview.css'
import { Icon } from '../../app/icons'
import { createBrowserTab, createMarkdownTab } from '../../app/tabCommands'
import { BandalMark } from '../../components/BandalMark'
import { Tooltip } from '../../components/Tooltip'
import { useLocale, useT } from '../../i18n'
import { flushLastActiveCoursePersist, useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useFileDropTarget } from '../materials/useFileDropTarget'
import { NewTabMenu } from './NewTabMenu'
import { TabContextMenu } from './TabContextMenu'
import { openNewTabMenu, useNewTabMenu } from './newTabMenuController'
import { descriptorFor, isTabDescriptor, tabTitle } from './tabIdentity'
import { writeWorkspaceTabDragData } from './tabDrag'
import { dockviewComponents } from './tabRegistry'
import { installTabStripWheelScrolling } from './tabStripScroll'
import { TabKindIcon } from './workspaceIcons'
import './workspace.css'

const bandalTheme: DockviewTheme = {
  name: 'bandal',
  className: 'bandal-dockview',
  gap: 0,
  dndOverlayMounting: 'absolute',
  dndPanelOverlay: 'content'
}

function WorkspaceTab(props: IDockviewPanelHeaderProps): JSX.Element {
  const t = useT()
  const [title, setTitle] = useState(props.api.title ?? '')
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    placement: 'top' | 'bottom'
    align: 'start' | 'end'
    rightPanelIds: string[]
  } | null>(null)
  const tabRef = useRef<HTMLDivElement>(null)
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const course = courses.find((entry) => entry.id === selectedCourseId) ?? null
  useEffect(() => {
    const disposable = props.api.onDidTitleChange((event) => {
      setTitle(event.title)
    })
    return () => disposable.dispose()
  }, [props.api])

  const rawDescriptor = (props.params as Record<string, unknown>)['descriptor']
  const descriptor = isTabDescriptor(rawDescriptor) ? rawDescriptor : null
  const canOpenNewInstance =
    descriptor !== null &&
    descriptor.kind !== 'group-chat' &&
    descriptor.kind !== 'board'

  useEffect(() => {
    const dockviewTab = tabRef.current?.closest('.dv-tab')
    if (!(dockviewTab instanceof HTMLElement) || descriptor === null) return
    const handleDragStart = (event: DragEvent): void => {
      if (event.dataTransfer === null) return
      writeWorkspaceTabDragData(
        event.dataTransfer,
        descriptor,
        tabTitle(descriptor)
      )
    }
    dockviewTab.addEventListener('dragstart', handleDragStart)
    return () => dockviewTab.removeEventListener('dragstart', handleDragStart)
  }, [descriptor])

  return (
    <>
      <Tooltip
        label={
          canOpenNewInstance
            ? t('workspace.tab.newInstanceTooltip', { title })
            : title
        }
        placement="bottom"
      >
        <div
          ref={tabRef}
          className="workspace-tab"
          onContextMenu={(event) => {
            if (descriptor === null || course === null) return
            event.preventDefault()
            event.stopPropagation()
            props.api.setActive()
            const panels = props.api.group.panels
            const index = panels.findIndex((panel) => panel.id === props.api.id)
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              placement:
                event.clientY > window.innerHeight / 2 ? 'top' : 'bottom',
              align: event.clientX > window.innerWidth / 2 ? 'end' : 'start',
              rightPanelIds:
                index < 0
                  ? []
                  : panels.slice(index + 1).map((panel) => panel.id)
            })
          }}
          onMouseDown={(event) => {
            if (event.button === 1) {
              event.preventDefault()
              props.api.close()
            }
          }}
          onClick={(event) => {
            if (
              descriptor === null ||
              !canOpenNewInstance ||
              !(window.bandal?.platform === 'darwin'
                ? event.metaKey
                : event.ctrlKey)
            ) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            useWorkspaceStore
              .getState()
              .openTab(descriptor, { newInstance: true })
          }}
        >
          {descriptor !== null && (
            <TabKindIcon
              kind={descriptor.kind}
              className="workspace-tab__kind"
            />
          )}
          <span className="workspace-tab__title">{title}</span>
          <button
            type="button"
            className="workspace-tab__close"
            aria-label={`${title} 탭 닫기`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              props.api.close()
            }}
          >
            <Icon name="x" />
          </button>
        </div>
      </Tooltip>
      {contextMenu !== null && descriptor !== null && course !== null && (
        <TabContextMenu
          descriptor={descriptor}
          label={title}
          course={course}
          panelId={props.api.id}
          rightPanelIds={contextMenu.rightPanelIds}
          containerApi={props.containerApi}
          x={contextMenu.x}
          y={contextMenu.y}
          placement={contextMenu.placement}
          align={contextMenu.align}
          returnFocus={tabRef.current}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
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
        <ExpandLeftRail />
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
      <ExpandLeftRail />
      <ToggleRightRail />
      <BandalMark size={56} className="workspace-watermark__moon" />
      <p className="eyebrow">CURRENT COURSE</p>
      <h1>{course.name}</h1>
      <p className="workspace-watermark__hint">{ko ? '읽고, 기록하고, 연결하는 나만의 학습 공간' : 'A space to read, write, and connect your ideas.'}</p>
      <div className="workspace-start-actions" aria-label={ko ? '학습 시작' : 'Start studying'}>
        <button type="button" onClick={() => void createMarkdownTab()}>
          <TabKindIcon kind="note" /><strong>{ko ? '새 필기' : 'New note'}</strong>
          <span>{ko ? '생각을 기록하세요' : 'Capture an idea'}</span>
        </button>
        <button type="button" onClick={() => createBrowserTab()}>
          <TabKindIcon kind="browser" /><strong>{ko ? '웹 탐색' : 'Browse the web'}</strong>
          <span>{ko ? '자료를 찾아보세요' : 'Find your sources'}</span>
        </button>
        <button type="button" onClick={() => useWorkspaceStore.getState().openTab(descriptorFor('chat', { courseId: course.id, conversationId: crypto.randomUUID() }))}>
          <TabKindIcon kind="chat" /><strong>{ko ? 'AI와 공부' : 'Study with AI'}</strong>
          <span>{ko ? '질문에서 시작하세요' : 'Start with a question'}</span>
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
    </div>
  )
}

/**
 * The way back to a collapsed course sidebar. It has to appear everywhere the
 * sidebar can be collapsed from, which is why it is not simply a tab-bar
 * action: dockview renders the tab bar only when a group exists, so with no
 * tabs open there was no button anywhere and the sidebar could only be
 * recovered by restarting the app.
 */
function ExpandLeftRail(): JSX.Element | null {
  const leftRailOpen = useUiStore((state) => state.leftRailOpen)
  const toggleLeftRail = useUiStore((state) => state.toggleLeftRail)

  if (leftRailOpen) return null

  return (
    <div className="workspace-chrome">
      {/* Keeps the button clear of the macOS window controls. */}
      <span className="workspace-chrome__traffic" aria-hidden="true" />
      <Tooltip label="과목 사이드바 펼치기" placement="bottom">
        <button
          type="button"
          className="titlebar-button"
          aria-label="과목 사이드바 펼치기"
          aria-pressed={false}
          onClick={toggleLeftRail}
        >
          <Icon name="layoutLeft" />
        </button>
      </Tooltip>
    </div>
  )
}

function ChromeLeft(_props: IDockviewHeaderActionsProps): JSX.Element | null {
  return <ExpandLeftRail />
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
function ToggleRightRail(): JSX.Element {
  const rightRailOpen = useUiStore((state) => state.rightRailOpen)
  const toggleRightRail = useUiStore((state) => state.toggleRightRail)
  const label = rightRailOpen ? '자료 사이드바 접기' : '자료 사이드바 펼치기'

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

export function WorkspaceHost(): JSX.Element {
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const course =
    courses.find((entry) => entry.id === selectedCourseId) ?? null
  const courseId = course?.id ?? null

  const setActiveCourse = useWorkspaceStore((state) => state.setActiveCourse)
  const isMenuOpen = useNewTabMenu((state) => state.isOpen)
  const closeMenu = useNewTabMenu((state) => state.close)
  const layoutSubscription = useRef<{ dispose: () => void } | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActiveCourse(courseId)
    closeMenu()
  }, [courseId, setActiveCourse, closeMenu])

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    return installTabStripWheelScrolling(host)
  }, [])

  useEffect(() => {
    const flush = (): void => {
      useWorkspaceStore.getState().flushPendingSave()
      flushLastActiveCoursePersist()
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      layoutSubscription.current?.dispose()
      layoutSubscription.current = null
      useWorkspaceStore.getState().detachApi()
    }
  }, [])

  const onReady = (event: DockviewReadyEvent): void => {
    layoutSubscription.current?.dispose()
    layoutSubscription.current = event.api.onDidLayoutChange(() => {
      useWorkspaceStore.getState().notifyLayoutChanged()
    })
    useWorkspaceStore.getState().attachApi(event.api)
  }

  return (
    <div ref={hostRef} className="workspace-host" data-tour="tab-strip">
      <DockviewReact
        theme={bandalTheme}
        scrollbars="native"
        components={dockviewComponents}
        defaultTabComponent={WorkspaceTab}
        watermarkComponent={Watermark}
        prefixHeaderActionsComponent={ChromeLeft}
        leftHeaderActionsComponent={AddTabAction}
        rightHeaderActionsComponent={HeaderActions}
        onReady={onReady}
      />
      {isMenuOpen && course !== null && <NewTabMenu course={course} />}
    </div>
  )
}
