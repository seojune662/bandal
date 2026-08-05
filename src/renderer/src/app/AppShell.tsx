import { useEffect } from 'react'
import { CourseSidebar } from '../features/courses/CourseSidebar'
import { MaterialsSidebar } from '../features/materials/MaterialsSidebar'
import { useCoursesStore } from '../stores/coursesStore'
import { useUiStore } from '../stores/uiStore'
import { Icon } from './icons'
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

  const selectedCourse =
    courses.find((course) => course.id === selectedCourseId) ?? null

  useEffect(() => {
    void initTheme().catch((error: unknown) => {
      console.error('[Bandal] 테마 설정을 불러오지 못했습니다.', error)
    })
    void loadCourses()
  }, [initTheme, loadCourses])

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
        <div className="workspace-placeholder">
          <div className="workspace-placeholder__moon" aria-hidden="true" />
          {selectedCourse === null ? (
            <>
              <p className="eyebrow">STUDY WORKSPACE</p>
              <h1>오늘의 공부를 시작해볼까요?</h1>
              <p>왼쪽에서 과목을 선택하면 작업 공간이 열립니다.</p>
            </>
          ) : (
            <>
              <p className="eyebrow">CURRENT COURSE</p>
              <h1>{selectedCourse.name}</h1>
              <p>노트와 학습 도구가 이 작업 공간에 열립니다.</p>
            </>
          )}
        </div>
      </main>

      {rightRailOpen && <MaterialsSidebar course={selectedCourse} />}
    </div>
  )
}
