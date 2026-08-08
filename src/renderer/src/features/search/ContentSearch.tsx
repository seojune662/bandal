import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { SearchHit, SearchHitKind } from '../../../../shared/types/search'
import { Icon, type IconName } from '../../app/icons'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { invoke } from '../../lib/ipc'
import { useCoursesStore } from '../../stores/coursesStore'
import { openContentSearchHit } from './searchNavigation'
import {
  fileNameFromRelPath,
  isContentSearchShortcut,
  searchHitKey,
  snippetSegments
} from './searchUi'
import './content-search.css'

const SEARCH_DEBOUNCE_MS = 180
const MAX_RESULTS = 30

const KIND_ICONS: Record<SearchHitKind, IconName> = {
  note: 'fileText',
  pdf: 'filePdf',
  text: 'fileText'
}

interface ContentSearchState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const useContentSearch = create<ContentSearchState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen }))
}))

function HighlightedSnippet({
  snippet,
  query
}: {
  snippet: string
  query: string
}): JSX.Element {
  return (
    <>
      {snippetSegments(snippet, query).map((segment, index) =>
        segment.matched ? (
          <mark key={index}>{segment.text}</mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  )
}

/**
 * Course-body search overlay. Mount once near AppShell's QuickFileSearch;
 * this component owns the ⇧⌘F listener so the existing ⌘P path stays intact.
 */
export function ContentSearch(): JSX.Element | null {
  const isOpen = useContentSearch((state) => state.isOpen)
  const close = useContentSearch((state) => state.close)
  const toggle = useContentSearch((state) => state.toggle)
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const course =
    courses.find((entry) => entry.id === selectedCourseId) ?? null

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const sequenceRef = useRef(0)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !isContentSearchShortcut({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          isComposing: event.isComposing || event.keyCode === 229
        })
      ) {
        return
      }
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setHits([])
    setHighlighted(0)
    setHasError(false)
    setIsSearching(false)
    const release = acquirePointerPassthrough()
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      sequenceRef.current += 1
      release()
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, close])

  useEffect(() => {
    if (!isOpen || course === null) return
    const normalized = query.trim()
    const sequence = ++sequenceRef.current
    setHasError(false)
    if (normalized.length === 0) {
      setHits([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    const timeout = window.setTimeout(() => {
      void invoke('search:query', {
        courseId: course.id,
        query: normalized,
        limit: MAX_RESULTS
      })
        .then(({ hits: results }) => {
          if (sequence !== sequenceRef.current) return
          setHits(results)
          setHighlighted(0)
        })
        .catch(() => {
          if (sequence !== sequenceRef.current) return
          setHits([])
          setHasError(true)
        })
        .finally(() => {
          if (sequence === sequenceRef.current) setIsSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [isOpen, course, query])

  const activate = useCallback(
    (hit: SearchHit | undefined): void => {
      if (hit === undefined || course === null) return
      openContentSearchHit(course.id, hit)
      close()
    },
    [course, close]
  )

  if (!isOpen) return null

  const clamped = Math.min(highlighted, Math.max(hits.length - 1, 0))
  const hasQuery = course !== null && query.trim().length > 0

  return (
    <div
      className="content-search-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        className="content-search"
        role="dialog"
        aria-modal="true"
        aria-label="자료 본문 검색"
      >
        <div className="content-search__field">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            placeholder={
              course === null
                ? '먼저 과목을 선택해 주세요'
                : `${course.name} 자료에서 내용 찾기`
            }
            aria-label="자료 본문 검색어"
            value={query}
            disabled={course === null}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape') {
                event.preventDefault()
                close()
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlighted((index) =>
                  Math.min(index + 1, Math.max(hits.length - 1, 0))
                )
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlighted((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                activate(hits[clamped])
              }
            }}
          />
          {isSearching && (
            <span className="content-search__progress" role="status">
              찾는 중…
            </span>
          )}
          <kbd className="content-search__esc" aria-hidden="true">
            esc
          </kbd>
        </div>

        <div className="content-search__body">
          {course === null ? (
            <p className="content-search__hint">
              왼쪽에서 과목을 고르면 필기와 자료 본문을 검색할 수 있어요.
            </p>
          ) : !hasQuery ? (
            <p className="content-search__hint">
              기억나는 개념이나 문장을 입력하세요. ⇧⌘F로 다시 열 수 있어요.
            </p>
          ) : hasError ? (
            <p className="content-search__hint" role="alert">
              검색하지 못했어요. 잠시 후 다시 시도해 주세요.
            </p>
          ) : isSearching && hits.length === 0 ? (
            <p className="content-search__hint" role="status">
              자료 본문을 찾는 중…
            </p>
          ) : hits.length === 0 ? (
            <p className="content-search__hint">
              본문에서 일치하는 내용을 찾지 못했어요.
            </p>
          ) : (
            <ul className="content-search__list" role="listbox" aria-label="본문 검색 결과">
              {hits.map((hit, index) => (
                <li key={searchHitKey(hit)} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === clamped}
                    data-highlighted={index === clamped}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(hit)}
                  >
                    <span className="content-search__icon">
                      <Icon name={KIND_ICONS[hit.kind]} />
                    </span>
                    <span className="content-search__result">
                      <span className="content-search__heading">
                        <span className="content-search__name">
                          {fileNameFromRelPath(hit.relPath)}
                        </span>
                        {hit.page !== null && (
                          <span className="content-search__page">{hit.page}쪽</span>
                        )}
                        {hit.relPath.includes('/') && (
                          <span className="content-search__path">
                            {hit.relPath.slice(0, hit.relPath.lastIndexOf('/'))}
                          </span>
                        )}
                      </span>
                      <span className="content-search__snippet">
                        <HighlightedSnippet snippet={hit.snippet} query={query} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
