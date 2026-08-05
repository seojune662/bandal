import { useEffect } from 'react'
import { BoardOverlay } from '../features/board/BoardPanel'
import { BrowserWebviewLayer } from '../features/browser/BrowserWebviewLayer'
import { CourseSidebar } from '../features/courses/CourseSidebar'
import { MaterialsSidebar } from '../features/materials/MaterialsSidebar'
import { TabKindIcon } from '../features/workspace/workspaceIcons'
import { WorkspaceHost } from '../features/workspace/WorkspaceHost'
import { useCoursesStore } from '../stores/coursesStore'
import { useUiStore } from '../stores/uiStore'
import { Icon } from './icons'
import { ToastHost } from './toast'
import './app-shell.css'

export function AppShell(): JSX.Element {
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const loadCourses = useCoursesStore((state) => state.loadCourses)
  const initTheme = useUiStore((state) => state.initTheme)
  const leftRailOpen = useUiStore((state) => state.leftRailOpen)
  const rightRailOpen = useUiStore((state) => state.rightRailOpen)
  const toggleLeftRail = useUiStore((state) => state.toggleLeftRail)
  const toggleRightRail = useUiStore((state) => state.toggleRightRail)
  const isBoardOverlayOpen = useUiStore((state) => state.isBoardOverlayOpen)
  const toggleBoardOverlay = useUiStore((state) => state.toggleBoardOverlay)
  const closeBoardOverlay = useUiStore((state) => state.closeBoardOverlay)

  const selectedCourse =
    courses.find((course) => course.id === selectedCourseId) ?? null

  useEffect(() => {
    void initTheme().catch((error: unknown) => {
      console.error('[Bandal] 테마 설정을 불러오지 못했습니다.', error)
    })
    void loadCourses()
  }, [initTheme, loadCourses])

  // [M5] A file dropped outside a drop target must never navigate the window.
  useEffect(() => {
    const prevent = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  return (
    <div
      className="app-shell"
      data-left-rail={leftRailOpen ? 'open' : 'closed'}
      data-right-rail={rightRailOpen ? 'open' : 'closed'}
    >
      <header className="app-titlebar titlebar-drag">
        <div className="app-titlebar__actions app-titlebar__actions--left">
          <button
            type="button"
            className="titlebar-button"
            aria-label={leftRailOpen ? '과목 사이드바 접기' : '과목 사이드바 펼치기'}
            aria-pressed={leftRailOpen}
            title={leftRailOpen ? '과목 사이드바 접기' : '과목 사이드바 펼치기'}
            onClick={toggleLeftRail}
          >
            <Icon name="layoutLeft" />
          </button>
        </div>

        <div className="app-titlebar__brand" aria-label="반달">
          <span className="brand-half-moon" aria-hidden="true" />
          <span>반달</span>
        </div>

        <div className="app-titlebar__actions app-titlebar__actions--right">
          <button
            type="button"
            className="titlebar-button titlebar-button--labeled"
            aria-label={isBoardOverlayOpen ? '학업 보드 닫기' : '학업 보드 열기'}
            aria-pressed={isBoardOverlayOpen}
            title={isBoardOverlayOpen ? '학업 보드 닫기' : '학업 보드 열기'}
            onClick={toggleBoardOverlay}
          >
            <TabKindIcon kind="board" />
            보드
          </button>
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
      </header>

      {leftRailOpen && <CourseSidebar />}

      <main className="app-workspace" aria-label="작업 공간">
        <WorkspaceHost />
      </main>

      {rightRailOpen && <MaterialsSidebar course={selectedCourse} />}

      <BrowserWebviewLayer />
      {isBoardOverlayOpen && <BoardOverlay onClose={closeBoardOverlay} />}
      <ToastHost />
    </div>
  )
}
