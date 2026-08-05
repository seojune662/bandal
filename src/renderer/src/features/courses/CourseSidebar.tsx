import { useEffect, useMemo, useRef, useState } from 'react'
import type { Course } from '../../../../shared/types/course'
import { Icon } from '../../app/icons'
import { openSettingsWindow } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { CourseFormDialog, DeleteCourseDialog } from './CourseDialogs'
import { normalizeCourseColor, type CourseColor } from './courseColors'
import './courses.css'

interface ContextMenuState {
  course: Course
  x: number
  y: number
  placement: 'top' | 'bottom'
}

export function CourseSidebar(): JSX.Element {
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const isLoading = useCoursesStore((state) => state.isLoading)
  const pendingCourseId = useCoursesStore((state) => state.pendingCourseId)
  const error = useCoursesStore((state) => state.error)
  const loadCourses = useCoursesStore((state) => state.loadCourses)
  const selectCourse = useCoursesStore((state) => state.selectCourse)
  const createCourse = useCoursesStore((state) => state.createCourse)
  const renameCourse = useCoursesStore((state) => state.renameCourse)
  const archiveCourse = useCoursesStore((state) => state.archiveCourse)
  const deleteCourse = useCoursesStore((state) => state.deleteCourse)
  const clearError = useCoursesStore((state) => state.clearError)

  const [query, setQuery] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Course | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const visibleCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (normalizedQuery.length === 0) return courses
    return courses.filter((course) =>
      course.name.toLocaleLowerCase().includes(normalizedQuery)
    )
  }, [courses, query])

  useEffect(() => {
    if (contextMenu === null) return
    const frame = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLElement>('button')?.focus()
    })
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    const closeOnBlur = (): void => setContextMenu(null)
    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeOnBlur)
    }
  }, [contextMenu])

  const handleContextMenu = (
    event: React.MouseEvent,
    course: Course
  ): void => {
    event.preventDefault()
    selectCourse(course.id)
    setContextMenu({
      course,
      x: event.clientX,
      y: event.clientY,
      placement: event.clientY > window.innerHeight / 2 ? 'top' : 'bottom'
    })
  }

  const handleArchive = async (course: Course): Promise<void> => {
    setContextMenu(null)
    try {
      await archiveCourse(course.id)
    } catch {
      // The store exposes a persistent, dismissible error message.
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (deleteTarget === null) return
    try {
      await deleteCourse(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      // Keep the confirmation open so the user can retry or cancel.
    }
  }

  return (
    <aside className="app-rail app-rail--left" aria-label="과목 목록">
      <div className="rail-heading">
        <div>
          <p className="eyebrow">LIBRARY</p>
          <h2>과목</h2>
        </div>
        <button
          type="button"
          className="bare-icon-button"
          aria-label="새 과목 만들기"
          title="새 과목 만들기"
          onClick={() => setCreateDialogOpen(true)}
        >
          <Icon name="plus" />
        </button>
      </div>

      <div className="rail-search">
        <Icon name="search" className="rail-search__icon" />
        <label className="sr-only" htmlFor="course-search">
          과목 검색
        </label>
        <input
          id="course-search"
          type="search"
          placeholder="과목 찾기"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.length > 0 && (
          <button
            type="button"
            className="rail-search__clear"
            aria-label="검색어 지우기"
            onClick={() => setQuery('')}
          >
            <Icon name="x" />
          </button>
        )}
      </div>

      {error !== null && (
        <div className="rail-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="오류 닫기" onClick={clearError}>
            <Icon name="x" />
          </button>
        </div>
      )}

      <div className="app-rail__body course-list-area">
        {isLoading && courses.length === 0 ? (
          <div className="loading-list" aria-label="과목 불러오는 중">
            <span />
            <span />
            <span />
          </div>
        ) : courses.length === 0 ? (
          <div className="empty-state empty-state--courses">
            <span className="empty-state__moon" aria-hidden="true" />
            <p className="empty-state__text">첫 과목을 만들어보세요</p>
            <p className="empty-state__hint">
              자료와 노트를 과목별로 한곳에 모아보세요.
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Icon name="plus" />
              과목 만들기
            </button>
          </div>
        ) : visibleCourses.length === 0 ? (
          <div className="rail-zero-result">
            <p>일치하는 과목이 없습니다</p>
            <button type="button" onClick={() => setQuery('')}>
              검색 지우기
            </button>
          </div>
        ) : (
          <ul className="course-list">
            {visibleCourses.map((course) => {
              const selected = course.id === selectedCourseId
              const pending = course.id === pendingCourseId
              return (
                <li key={course.id}>
                  <button
                    type="button"
                    className="course-row"
                    data-selected={selected}
                    aria-current={selected ? 'page' : undefined}
                    disabled={pending}
                    onClick={() => selectCourse(course.id)}
                    onContextMenu={(event) => handleContextMenu(event, course)}
                  >
                    <span
                      className="course-dot"
                      data-course-color={normalizeCourseColor(course.color)}
                    />
                    <span className="course-row__name">{course.name}</span>
                    <span className="course-row__hint" aria-hidden="true">
                      ···
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <footer className="rail-footer">
        <button
          type="button"
          className="rail-footer__button"
          onClick={() => {
            void openSettingsWindow().catch((settingsError: unknown) => {
              console.error('[Bandal] 설정 창을 열지 못했습니다.', settingsError)
            })
          }}
        >
          <Icon name="settings" />
          <span>설정</span>
        </button>
      </footer>

      {contextMenu !== null && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          role="menu"
          data-placement={contextMenu.placement}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <p className="context-menu__label">{contextMenu.course.name}</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenameTarget(contextMenu.course)
              setContextMenu(null)
            }}
          >
            <Icon name="pencil" />
            이름 변경
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleArchive(contextMenu.course)}
          >
            <Icon name="archive" />
            보관
          </button>
          <span className="context-menu__separator" />
          <button
            type="button"
            role="menuitem"
            className="context-menu__danger"
            onClick={() => {
              clearError()
              setDeleteTarget(contextMenu.course)
              setContextMenu(null)
            }}
          >
            <Icon name="trash" />
            삭제
          </button>
        </div>
      )}

      <CourseFormDialog
        open={createDialogOpen}
        mode="create"
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={async (name, color) => {
          await createCourse({ name, color })
        }}
      />
      <CourseFormDialog
        open={renameTarget !== null}
        mode="rename"
        initialName={renameTarget?.name ?? ''}
        initialColor={normalizeCourseColor(renameTarget?.color ?? 'gold')}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (name) => {
          if (renameTarget !== null) await renameCourse(renameTarget.id, name)
        }}
      />
      <DeleteCourseDialog
        courseName={deleteTarget?.name ?? null}
        pending={deleteTarget?.id === pendingCourseId}
        error={deleteTarget === null ? null : error}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </aside>
  )
}
