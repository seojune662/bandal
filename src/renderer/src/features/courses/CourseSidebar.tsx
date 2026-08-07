import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Course, PickedFolder } from '../../../../shared/types/course'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { openSettingsWindow } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { useUiStore } from '../../stores/uiStore'
import { CanvasSection } from '../canvas/CanvasSection'
import { CourseGroupsSection } from '../group/CourseGroupsSection'
import { TogetherFooter } from '../group/TogetherFooter'
import { UniversityShortcuts } from '../university/UniversityShortcuts'
import { TabKindIcon } from '../workspace/workspaceIcons'
import {
  ArchiveCourseDialog,
  CourseFormDialog,
  DeleteCourseDialog
} from './CourseDialogs'
import { FavoritesSection } from './FavoritesSection'
import {
  persistCollapsedCourseIds,
  readCollapsedCourseIds
} from './courseCollapse'
import { folderProblemMessage } from './folderMessages'
import { normalizeCourseColor } from './courseColors'
import './courses.css'
import { BandalMark } from '../../components/BandalMark'

interface ContextMenuState {
  course: Course
  x: number
  y: number
  placement: 'top' | 'bottom'
}

interface AddMenuState {
  x: number
  y: number
}

/** Closes a floating menu on outside pointerdown, Escape or window blur. */
function useDismissableMenu(
  active: boolean,
  ref: React.RefObject<HTMLElement>,
  dismiss: () => void
): void {
  useEffect(() => {
    if (!active) return
    const frame = window.requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>('button')?.focus()
    })
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) dismiss()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', dismiss)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', dismiss)
    }
  }, [active, dismiss, ref])
}

export function CourseSidebar(): JSX.Element {
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const isLoading = useCoursesStore((state) => state.isLoading)
  const pendingCourseId = useCoursesStore((state) => state.pendingCourseId)
  const error = useCoursesStore((state) => state.error)
  const selectCourse = useCoursesStore((state) => state.selectCourse)
  const createCourse = useCoursesStore((state) => state.createCourse)
  const pickFolder = useCoursesStore((state) => state.pickFolder)
  const addCourseFromFolder = useCoursesStore((state) => state.addCourseFromFolder)
  const relinkCourse = useCoursesStore((state) => state.relinkCourse)
  const renameCourse = useCoursesStore((state) => state.renameCourse)
  const archiveCourse = useCoursesStore((state) => state.archiveCourse)
  const deleteCourse = useCoursesStore((state) => state.deleteCourse)
  const clearError = useCoursesStore((state) => state.clearError)
  const loadCourses = useCoursesStore((state) => state.loadCourses)

  const isBoardOverlayOpen = useUiStore((state) => state.isBoardOverlayOpen)
  const toggleBoardOverlay = useUiStore((state) => state.toggleBoardOverlay)
  const toggleLeftRail = useUiStore((state) => state.toggleLeftRail)

  const [query, setQuery] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [linkTarget, setLinkTarget] = useState<PickedFolder | null>(null)
  const [renameTarget, setRenameTarget] = useState<Course | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Course | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null)
  const [collapsedCourseIds, setCollapsedCourseIds] = useState(
    readCollapsedCourseIds
  )
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const refreshAfterSettingsChange = (): void => {
      void loadCourses()
    }
    window.addEventListener('focus', refreshAfterSettingsChange)
    return () => window.removeEventListener('focus', refreshAfterSettingsChange)
  }, [loadCourses])

  const visibleCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (normalizedQuery.length === 0) return courses
    return courses.filter((course) =>
      course.name.toLocaleLowerCase().includes(normalizedQuery)
    )
  }, [courses, query])

  // Stable callbacks: the dismiss effect must not re-arm on every render.
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const closeAddMenu = useCallback(() => setAddMenu(null), [])
  useDismissableMenu(contextMenu !== null, contextMenuRef, closeContextMenu)
  useDismissableMenu(addMenu !== null, addMenuRef, closeAddMenu)

  const setCourseExpanded = useCallback(
    (courseId: string, expanded: boolean): void => {
      setCollapsedCourseIds((current) => {
        const next = new Set(current)
        if (expanded) next.delete(courseId)
        else next.add(courseId)
        persistCollapsedCourseIds(next)
        return next
      })
    },
    []
  )

  const handleContextMenu = (event: React.MouseEvent, course: Course): void => {
    event.preventDefault()
    selectCourse(course.id)
    setContextMenu({
      course,
      x: event.clientX,
      y: event.clientY,
      placement: event.clientY > window.innerHeight / 2 ? 'top' : 'bottom'
    })
  }

  const openAddMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setAddMenu({ x: rect.right, y: rect.bottom })
  }

  /** Native folder picker → link dialog (name prefilled with the basename). */
  const startFolderAdd = async (): Promise<void> => {
    setAddMenu(null)
    try {
      const picked = await pickFolder()
      if (picked !== null) setLinkTarget(picked)
    } catch {
      // The rail shows the store's persistent error message.
    }
  }

  const startRelink = async (course: Course): Promise<void> => {
    setContextMenu(null)
    try {
      const picked = await pickFolder()
      if (picked === null) return
      const result = await relinkCourse(course.id, picked.path)
      if (result.status === 'ok') showToast('폴더를 다시 연결했어요.')
    } catch {
      // The rail shows the store's persistent error message.
    }
  }

  const handleArchive = async (): Promise<void> => {
    if (archiveTarget === null) return
    try {
      await archiveCourse(archiveTarget.id, true)
      showToast(`“${archiveTarget.name}” 과목을 보관했어요.`)
      setArchiveTarget(null)
    } catch {
      showToast('과목을 보관하지 못했어요.', 'danger')
      // Keep the confirmation open so the user can retry or cancel.
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
      <div className="course-sidebar-chrome">
        <span className="course-sidebar-chrome__traffic" aria-hidden="true" />
        <BandalMark size={18} className="course-sidebar-chrome__mark" />
        <span className="course-sidebar-chrome__name">Bandal</span>
        <button
          type="button"
          className="titlebar-button course-sidebar-chrome__toggle"
          aria-label="과목 사이드바 접기"
          aria-pressed={true}
          title="과목 사이드바 접기"
          onClick={toggleLeftRail}
        >
          <Icon name="layoutLeft" />
        </button>
      </div>

      {/* [M8] 학교 학사 사이트 바로가기 — above 과목 because it is the same
          "where do I go" question, answered once per school. */}
      <UniversityShortcuts />

      <div className="rail-heading">
        <div>
          <p className="eyebrow">LIBRARY</p>
          <h2>과목</h2>
        </div>
        <button
          type="button"
          className="bare-icon-button"
          aria-label="과목 추가"
          title="과목 추가"
          aria-haspopup="menu"
          aria-expanded={addMenu !== null}
          onClick={openAddMenu}
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
            <BandalMark size={56} className="empty-state__moon" />
            <p className="empty-state__text">첫 과목을 만들어보세요</p>
            <p className="empty-state__hint">
              공부하던 폴더를 그대로 과목으로 가져올 수 있어요.
            </p>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void startFolderAdd()}
            >
              <Icon name="folderPlus" />
              폴더에서 추가
            </button>
            <button
              type="button"
              className="empty-state__alt"
              onClick={() => setCreateDialogOpen(true)}
            >
              새 과목 만들기
            </button>
          </div>
        ) : visibleCourses.length === 0 ? (
          <div className="rail-zero-result">
            <p>일치하는 과목이 없어요</p>
            <button type="button" onClick={() => setQuery('')}>
              검색 지우기
            </button>
          </div>
        ) : (
          <ul className="course-list">
            {visibleCourses.map((course) => {
              const selected = course.id === selectedCourseId
              const pending = course.id === pendingCourseId
              const expanded = selected && !collapsedCourseIds.has(course.id)
              return (
                <li key={course.id}>
                  <div
                    className="course-row"
                    data-selected={selected}
                    data-missing={course.missing || undefined}
                    onContextMenu={(event) => handleContextMenu(event, course)}
                  >
                    <button
                      type="button"
                      className="course-row__toggle"
                      aria-label={`${course.name} ${expanded ? '접기' : '펼치기'}`}
                      aria-expanded={expanded}
                      disabled={pending}
                      onClick={() => {
                        if (!selected) selectCourse(course.id)
                        setCourseExpanded(course.id, !expanded)
                      }}
                    >
                      <Icon name="chevronRight" />
                    </button>
                    <button
                      type="button"
                      className="course-row__select"
                      aria-current={selected ? 'page' : undefined}
                      disabled={pending}
                      onClick={() => selectCourse(course.id)}
                    >
                      <span
                        className="course-dot"
                        data-course-color={normalizeCourseColor(course.color)}
                      />
                      <span className="course-row__name">{course.name}</span>
                      {course.missing ? (
                        <span className="course-row__badge">연결 끊김</span>
                      ) : (
                        <span className="course-row__hint" aria-hidden="true">
                          ···
                        </span>
                      )}
                    </button>
                  </div>
                  {/* Course-scoped favorites and groups stay under the open
                      course only, preserving the existing collapse model. */}
                  {expanded && (
                    <div className="course-row__children">
                      <FavoritesSection courseId={course.id} />
                      <CanvasSection courseId={course.id} />
                      <CourseGroupsSection courseId={course.id} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <TogetherFooter />

      <footer className="rail-footer">
        <nav className="rail-nav" aria-label="앱 메뉴">
          <button
            type="button"
            className="rail-nav__item"
            data-active={isBoardOverlayOpen || undefined}
            aria-pressed={isBoardOverlayOpen}
            title={isBoardOverlayOpen ? '학업 보드 닫기' : '학업 보드 열기'}
            onClick={toggleBoardOverlay}
          >
            <TabKindIcon kind="board" />
            <span>보드</span>
          </button>
          <button
            type="button"
            className="rail-nav__item"
            onClick={() => {
              void openSettingsWindow().catch((settingsError: unknown) => {
                console.error('[Bandal] 설정 창을 열지 못했습니다.', settingsError)
              })
            }}
          >
            <Icon name="settings" />
            <span>설정</span>
          </button>
        </nav>
      </footer>

      {addMenu !== null && (
        <div
          ref={addMenuRef}
          className="context-menu"
          role="menu"
          aria-label="과목 추가"
          data-placement="bottom"
          data-align="end"
          style={{ left: addMenu.x, top: addMenu.y }}
        >
          <button type="button" role="menuitem" onClick={() => void startFolderAdd()}>
            <Icon name="folderPlus" />
            폴더에서 추가
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAddMenu(null)
              setCreateDialogOpen(true)
            }}
          >
            <Icon name="plus" />새 과목 만들기
          </button>
        </div>
      )}

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
          {contextMenu.course.missing && (
            <button
              type="button"
              role="menuitem"
              onClick={() => void startRelink(contextMenu.course)}
            >
              <Icon name="link" />
              다시 연결
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              clearError()
              setArchiveTarget(contextMenu.course)
              setContextMenu(null)
            }}
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
        open={linkTarget !== null}
        mode="link"
        initialName={linkTarget?.name ?? ''}
        folderPath={linkTarget?.path}
        onClose={() => setLinkTarget(null)}
        onSubmit={async (name, color) => {
          if (linkTarget === null) return
          const result = await addCourseFromFolder({
            folderPath: linkTarget.path,
            name,
            color
          })
          // Thrown messages stay inside the dialog so the user can re-pick.
          if (result.status === 'failed') {
            throw new Error(folderProblemMessage(result.reason))
          }
          if (result.status === 'duplicate') {
            showToast('이미 등록된 폴더예요. 그 과목으로 이동했어요.')
          }
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
      <ArchiveCourseDialog
        courseName={archiveTarget?.name ?? null}
        pending={archiveTarget?.id === pendingCourseId}
        error={archiveTarget === null ? null : error}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
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
