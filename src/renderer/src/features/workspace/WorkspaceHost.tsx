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
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useFileDropTarget } from '../materials/useFileDropTarget'
import { NewTabMenu } from './NewTabMenu'
import { openNewTabMenu, useNewTabMenu } from './newTabMenuController'
import { isTabDescriptor } from './tabIdentity'
import { dockviewComponents } from './tabRegistry'
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
  const [title, setTitle] = useState(props.api.title ?? '')
  useEffect(() => {
    const disposable = props.api.onDidTitleChange((event) => {
      setTitle(event.title)
    })
    return () => disposable.dispose()
  }, [props.api])

  const rawDescriptor = (props.params as Record<string, unknown>)['descriptor']
  const descriptor = isTabDescriptor(rawDescriptor) ? rawDescriptor : null

  return (
    <div
      className="workspace-tab"
      title={title}
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
        <div className="workspace-watermark__moon" aria-hidden="true" />
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
      <div className="workspace-watermark__moon" aria-hidden="true" />
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

function HeaderActions(_props: IDockviewHeaderActionsProps): JSX.Element {
  return (
    <div className="workspace-header-actions">
      <button
        type="button"
        className="workspace-add-tab"
        aria-label="새 탭 열기"
        title="새 탭 열기"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          openNewTabMenu({ x: rect.right - 300, y: rect.bottom + 6 })
        }}
      >
        <Icon name="plus" />
      </button>
    </div>
  )
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
        rightHeaderActionsComponent={HeaderActions}
        onReady={onReady}
      />
      {isMenuOpen && course !== null && <NewTabMenu course={course} />}
    </div>
  )
}
