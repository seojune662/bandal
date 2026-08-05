import { useEffect, useState } from 'react'
import type { Course } from '../../../../shared/types/course'
import { Icon } from '../../app/icons'
import { useMaterialsStore } from '../../stores/materialsStore'
import { normalizeCourseColor } from '../courses/courseColors'
import { MaterialSearchResults, MaterialTree } from './MaterialTree'
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
  const [query, setQuery] = useState('')
  const [isDebouncing, setIsDebouncing] = useState(false)

  useEffect(() => {
    setQuery('')
    clearSearch()
    if (course === null) {
      clear()
      return
    }
    void loadTree(course.id)
  }, [clear, clearSearch, course?.id, loadTree])

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
    <aside className="app-rail app-rail--right" aria-label="자료">
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
        ) : pendingSearch || (isLoading && !searching) ? (
          <div className="loading-list" aria-label="자료 불러오는 중">
            <span />
            <span />
            <span />
          </div>
        ) : searching ? (
          searchResults.length === 0 ? (
            <div className="rail-zero-result">
              <p>검색 결과가 없습니다</p>
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
            <p className="empty-state__text">자료를 끌어다 놓으세요</p>
            <p className="empty-state__hint">PDF, 노트, 이미지를 한곳에서 찾을 수 있어요.</p>
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
