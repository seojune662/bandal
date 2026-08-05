import { useEffect, useState } from 'react'
import type { Course } from '../../../../shared/types/course'
import { Icon } from '../../app/icons'
import { invoke, onPush } from '../../lib/ipc'
import { showToast } from '../../app/toast'
import { useCoursesStore } from '../../stores/coursesStore'
import { useMaterialsStore } from '../../stores/materialsStore'
import { normalizeCourseColor } from '../courses/courseColors'
import { MaterialSearchResults, MaterialTree } from './MaterialTree'
import { useFileDropTarget } from './useFileDropTarget'
import './materials.css'

const SEARCH_DEBOUNCE_MS = 240

interface MaterialsSidebarProps {
  course: Course | null
}

export function MaterialsSidebar({ course }: MaterialsSidebarProps): JSX.Element {
  const tree = useMaterialsStore((state) => state.tree)
  const searchResults = useMaterialsStore((state) => state.searchResults)
  const expandedPaths = useMaterialsStore((state) => state.expandedPaths)
  const isLoading = useMaterialsStore((state) => state.isLoading)
  const isSearching = useMaterialsStore((state) => state.isSearching)
  const error = useMaterialsStore((state) => state.error)
  const loadTree = useMaterialsStore((state) => state.loadTree)
  const search = useMaterialsStore((state) => state.search)
  const clearSearch = useMaterialsStore((state) => state.clearSearch)
  const clear = useMaterialsStore((state) => state.clear)
  const toggleFolder = useMaterialsStore((state) => state.toggleFolder)
  const pickFolder = useCoursesStore((state) => state.pickFolder)
  const relinkCourse = useCoursesStore((state) => state.relinkCourse)
  const [query, setQuery] = useState('')
  const [isDebouncing, setIsDebouncing] = useState(false)
  const [isRelinking, setIsRelinking] = useState(false)
  const { isDropActive, dropProps } = useFileDropTarget(course?.id ?? null)

  /** 연결 끊김 복구: re-pick the folder this course points at. */
  const relink = async (courseId: string): Promise<void> => {
    setIsRelinking(true)
    try {
      const picked = await pickFolder()
      if (picked === null) return
      const result = await relinkCourse(courseId, picked.path)
      if (result.status === 'ok') showToast('폴더를 다시 연결했어요.')
    } catch {
      // The course rail shows the store's persistent error message.
    } finally {
      setIsRelinking(false)
    }
  }

  // Re-runs when the course is re-linked too — folderPath is part of the key.
  useEffect(() => {
    setQuery('')
    clearSearch()
    if (course === null || course.missing) {
      clear()
      return
    }
    void loadTree(course.id)
  }, [clear, clearSearch, course?.id, course?.folderPath, course?.missing, loadTree])

  // [M5] Live tree: watch the course folder, refresh silently on pushes.
  // A 연결 끊김 course has no folder to watch.
  useEffect(() => {
    if (course === null || course.missing) return
    const courseId = course.id
    void invoke('materials:watch', { courseId }).catch((error: unknown) => {
      console.error('[Bandal] 자료 폴더 감시를 시작하지 못했습니다.', error)
    })
    const unsubscribe = onPush('materials:changed', (payload) => {
      if (payload.courseId === courseId) {
        void loadTree(courseId, { silent: true })
      }
    })
    return () => {
      unsubscribe()
      void invoke('materials:unwatch', { courseId }).catch(() => undefined)
    }
  }, [course?.id, course?.folderPath, course?.missing, loadTree])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (course === null || normalizedQuery.length === 0) {
      setIsDebouncing(false)
      clearSearch()
      return
    }

    setIsDebouncing(true)
    const timeout = window.setTimeout(() => {
      setIsDebouncing(false)
      void search(course.id, normalizedQuery)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [clearSearch, course, query, search])

  const searching = query.trim().length > 0
  const pendingSearch = isDebouncing || isSearching

  return (
    <aside
      className="app-rail app-rail--right"
      aria-label="자료"
      data-drop-active={isDropActive || undefined}
      {...dropProps}
    >
      <div className="rail-heading materials-heading">
        <div className="materials-heading__text">
          <p className="eyebrow">MATERIALS</p>
          <h2>자료</h2>
          {course !== null && (
            <span className="materials-heading__course">
              <span
                className="course-dot"
                data-course-color={normalizeCourseColor(course.color)}
              />
              {course.name}
            </span>
          )}
        </div>
        <button
          type="button"
          className="bare-icon-button"
          aria-label="자료 새로고침"
          title="자료 새로고침"
          disabled={course === null || isLoading}
          onClick={() => {
            if (course !== null) void loadTree(course.id)
          }}
        >
          <Icon name="refresh" className={isLoading ? 'is-spinning' : ''} />
        </button>
      </div>

      <div className="rail-search">
        <Icon name="search" className="rail-search__icon" />
        <label className="sr-only" htmlFor="material-search">
          파일 검색
        </label>
        <input
          id="material-search"
          type="search"
          placeholder="Find files"
          value={query}
          disabled={course === null}
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
          <button
            type="button"
            onClick={() => {
              if (course === null) return
              if (searching) void search(course.id, query)
              else void loadTree(course.id)
            }}
          >
            다시 시도
          </button>
        </div>
      )}

      <div className="app-rail__body materials-body">
        {course === null ? (
          <div className="empty-state empty-state--materials">
            <Icon name="folder" className="empty-state__folder" />
            <p className="empty-state__text">과목을 선택하세요</p>
            <p className="empty-state__hint">선택한 과목의 자료가 여기에 표시됩니다.</p>
          </div>
        ) : course.missing ? (
          <div className="empty-state empty-state--materials">
            <Icon name="folder" className="empty-state__folder" />
            <p className="empty-state__text">폴더 연결이 끊겼어요</p>
            <p className="empty-state__hint" title={course.folderPath}>
              {course.folderPath} 을(를) 찾을 수 없어요. 폴더를 옮겼다면 다시
              연결해주세요.
            </p>
            <button
              type="button"
              className="button button--primary"
              disabled={isRelinking}
              onClick={() => void relink(course.id)}
            >
              <Icon name="link" />
              {isRelinking ? '연결 중…' : '다시 연결'}
            </button>
          </div>
        ) : pendingSearch || (isLoading && !searching) ? (
          <div className="loading-list" aria-label="자료 불러오는 중">
            <span />
            <span />
            <span />
          </div>
        ) : searching ? (
          searchResults.length === 0 ? (
            <div className="rail-zero-result">
              <p>일치하는 자료가 없어요</p>
              <button type="button" onClick={() => setQuery('')}>
                전체 자료 보기
              </button>
            </div>
          ) : (
            <MaterialSearchResults results={searchResults} />
          )
        ) : tree.length === 0 ? (
          <div className="empty-state empty-state--materials">
            <Icon name="folder" className="empty-state__folder" />
            <p className="empty-state__text">아직 자료가 없어요</p>
            <p className="empty-state__hint">
              Finder에서 파일을 끌어다 놓으면 PDF, 노트, 이미지가 한곳에 정리돼요.
            </p>
          </div>
        ) : (
          <MaterialTree
            nodes={tree}
            expandedPaths={expandedPaths}
            onToggleFolder={toggleFolder}
          />
        )}
      </div>
    </aside>
  )
}
