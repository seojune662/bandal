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
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useFileDropTarget } from '../materials/useFileDropTarget'
import { NewTabMenu } from './NewTabMenu'
import { TabContextMenu } from './TabContextMenu'
import { openNewTabMenu, useNewTabMenu } from './newTabMenuController'
import { isTabDescriptor, tabTitle } from './tabIdentity'
import { writeWorkspaceTabDragData } from './tabDrag'
import { dockviewComponents } from './tabRegistry'
import { TabKindIcon } from './workspaceIcons'
import './workspace.css'
import { BandalMark } from '../../components/BandalMark'

const bandalTheme: DockviewTheme = {
  name: 'bandal',
  className: 'bandal-dockview',
  gap: 0,
  dndOverlayMounting: 'absolute',
  dndPanelOverlay: 'content'
}

function WorkspaceTab(props: IDockviewPanelHeaderProps): JSX.Element {
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
      <div
        ref={tabRef}
        className="workspace-tab"
        title={title}
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
            placement: event.clientY > window.innerHeight / 2 ? 'top' : 'bottom',
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
      >
        {descriptor !== null && (
          <TabKindIcon kind={descriptor.kind} className="workspace-tab__kind" />
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
        <p className="eyebrow">STUDY WORKSPACE</p>
        <h1>오늘의 공부를 시작해볼까요?</h1>
        <p className="workspace-watermark__hint">
          왼쪽에서 과목을 고르면 그 과목의 작업 공간이 열려요.
          <br />
          아직 과목이 없다면 + 버튼으로 첫 과목을 만들어보세요.
        </p>
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
      <p className="workspace-watermark__hint">
        필기, PDF, 브라우저, AI 튜터를 탭으로 열 수 있어요.
        <br />
        Finder에서 파일을 끌어다 놓으면 자료로 가져와요.
      </p>
      <button
        type="button"
        className="workspace-watermark__cta"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          openNewTabMenu({ x: rect.left, y: rect.bottom + 8 })
        }}
      >
        <Icon name="plus" />새 탭 열기
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
      <button
        type="button"
        className="titlebar-button"
        aria-label="과목 사이드바 펼치기"
        aria-pressed={false}
        title="과목 사이드바 펼치기"
        onClick={toggleLeftRail}
      >
        <Icon name="layoutLeft" />
      </button>
    </div>
  )
}

function ChromeLeft(_props: IDockviewHeaderActionsProps): JSX.Element | null {
  return <ExpandLeftRail />
}

function AddTabAction(_props: IDockviewHeaderActionsProps): JSX.Element {
  return (
    <div className="workspace-tab-actions">
      <button
        type="button"
        className="workspace-add-tab"
        aria-label="새 탭 열기"
        title="새 탭 열기"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          openNewTabMenu({ x: rect.left, y: rect.bottom })
        }}
      >
        <Icon name="plus" />
      </button>
    </div>
  )
}

/** Same reasoning as ExpandLeftRail: needed outside the tab bar too. */
function ToggleRightRail(): JSX.Element {
  const rightRailOpen = useUiStore((state) => state.rightRailOpen)
  const toggleRightRail = useUiStore((state) => state.toggleRightRail)

  return (
    <div className="workspace-header-actions">
      <button
        type="button"
        className="titlebar-button"
        aria-label={rightRailOpen ? '자료 사이드바 접기' : '자료 사이드바 펼치기'}
        aria-pressed={rightRailOpen}
        title={rightRailOpen ? '자료 사이드바 접기' : '자료 사이드바 펼치기'}
        onClick={toggleRightRail}
      >
        <Icon name="layoutRight" />
      </button>
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

  useEffect(() => {
    setActiveCourse(courseId)
    closeMenu()
  }, [courseId, setActiveCourse, closeMenu])

  useEffect(() => {
    const flush = (): void => {
      useWorkspaceStore.getState().flushPendingSave()
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
    <div className="workspace-host">
      <DockviewReact
        theme={bandalTheme}
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
