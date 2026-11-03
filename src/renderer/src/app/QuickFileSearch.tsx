/**
 * [M6-A] ⌘P quick file search — a small omnibox overlay that searches the
 * SELECTED course's materials (`materials:search`). Enter opens the hit by
 * the same rules as the sidebar (pdf/note → tab, everything else → Finder),
 * Esc closes. Open/close state lives in useQuickSearch (shortcuts.ts).
 *
 * Settings are searchable here too (Orca's Cmd+J settings results): the same
 * catalog and ranker as the settings sidebar; Enter deep-links to the row.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  MaterialKind,
  MaterialSearchHit
} from '../../../shared/types/materials'
import { openMaterialInCourse } from '../features/workspace/openMaterial'
import { isViewableFile } from '../features/file/fileFormats'
import { acquirePointerPassthrough } from '../features/browser/webviewPassthrough'
import { invoke } from '../lib/ipc'
import { useCoursesStore } from '../stores/coursesStore'
import { useUiStore } from '../stores/uiStore'
import { useLocale, useT } from '../i18n'
import { SETTINGS_CATEGORIES, type SettingsPanelId } from '../../../shared/settingsCategories'
import { buildSettingsSearchIndex } from '../features/settings/search/catalog'
import { rankSettingsSearchItems } from '../features/settings/search/settingsSearch'
import { useFocusTrap } from '../components/useFocusTrap'
import { useQuickSearch } from './shortcuts'
import { Icon, type IconName } from './icons'
import './quick-search.css'

const SEARCH_DEBOUNCE_MS = 180
const MAX_RESULTS = 12
const MAX_SETTINGS_RESULTS = 5

interface SettingsHit {
  id: string
  title: string
  category: SettingsPanelId
  sectionId?: string
}

type QuickSearchItem =
  | { type: 'file'; hit: MaterialSearchHit }
  | { type: 'setting'; hit: SettingsHit }

const KIND_ICONS: Record<MaterialKind, IconName> = {
  pdf: 'filePdf',
  note: 'fileText',
  image: 'fileImage',
  video: 'file',
  other: 'file'
}

export function QuickFileSearch(): JSX.Element | null {
  const isOpen = useQuickSearch((state) => state.isOpen)
  const close = useQuickSearch((state) => state.close)
  const courses = useCoursesStore((state) => state.courses)
  const selectedCourseId = useCoursesStore((state) => state.selectedCourseId)
  const course =
    courses.find((entry) => entry.id === selectedCourseId) ?? null

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MaterialSearchHit[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [highlighted, setHighlighted] = useState(0)
  const t = useT()
  const locale = useLocale()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const sequenceRef = useRef(0)

  useFocusTrap(dialogRef, {
    active: isOpen,
    initialFocus: inputRef,
    onEscape: close
  })

  // Reset on every open; keep guests from eating the pointer while up.
  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setHits([])
    setHighlighted(0)
    const release = acquirePointerPassthrough()
    return () => {
      release()
    }
  }, [isOpen, close])

  useEffect(() => {
    const sequence = ++sequenceRef.current
    setHits([])
    setError(null)
    setIsSearching(false)
    if (!isOpen || course === null) return
    const normalized = query.trim()
    if (normalized.length === 0) {
      setHits([])
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const timeout = window.setTimeout(() => {
      void invoke('materials:search', { courseId: course.id, query: normalized })
        .then((results) => {
          if (sequence !== sequenceRef.current) return
          setHits(results.slice(0, MAX_RESULTS))
          setHighlighted(0)
        })
        .catch((cause: unknown) => {
          if (sequence === sequenceRef.current) setError(cause instanceof Error ? cause.message : '파일을 검색하지 못했어요.')
        })
        .finally(() => {
          if (sequence === sequenceRef.current) setIsSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => { window.clearTimeout(timeout); sequenceRef.current += 1 }
  }, [isOpen, course, query, attempt])

  // Category panes first, then individual rows; plugin rows stay in settings.
  const settingsCandidates = useMemo(() => {
    const index = buildSettingsSearchIndex(locale)
    const panes = SETTINGS_CATEGORIES.filter(({ id }) => id !== 'sync' || window.bandal?.syncUi === true).map(({ id }) => ({
      hit: { id: `pane:${id}`, title: index.panes.get(id)?.title ?? id, category: id } satisfies SettingsHit,
      entry: index.panes.get(id)!
    }))
    const rows = [...index.byId.values()].map(entry => ({
      hit: { id: entry.id, title: entry.title, category: entry.category, sectionId: entry.id } satisfies SettingsHit,
      entry
    }))
    return [...panes, ...rows]
  }, [locale])
  const settingsHits = useMemo(
    () => query.trim() === ''
      ? []
      : rankSettingsSearchItems(query, settingsCandidates, candidate => candidate.entry)
        .slice(0, MAX_SETTINGS_RESULTS)
        .map(({ item }) => item.hit),
    [query, settingsCandidates]
  )
  const items: QuickSearchItem[] = [
    ...hits.map(hit => ({ type: 'file' as const, hit })),
    ...settingsHits.map(hit => ({ type: 'setting' as const, hit }))
  ]

  const activate = useCallback(
    (item: QuickSearchItem | undefined): void => {
      if (item === undefined) return
      if (item.type === 'setting') {
        useUiStore.getState().openSettings({
          category: item.hit.category,
          ...(item.hit.sectionId !== undefined ? { sectionId: item.hit.sectionId } : {})
        })
        close()
        return
      }
      if (course === null || isSearching) return
      openMaterialInCourse(course.id, item.hit.kind, item.hit.relPath)
      close()
    },
    [course, close, isSearching]
  )

  if (!isOpen) return null

  const clamped = Math.min(highlighted, Math.max(items.length - 1, 0))
  const showsResults = query.trim().length > 0
  const categoryLabel = (category: SettingsPanelId): string => t(`settings.category.${category}.label`)

  return (
    <div
      className="quick-search-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={dialogRef}
        className="quick-search"
        role="dialog"
        aria-modal="true"
        aria-label="빠른 파일 검색"
      >
        <div className="quick-search__field">
          <Icon name="search" />
          <input
            ref={inputRef}
            type="text"
            placeholder={
              course === null ? t('quickSearch.placeholder.noCourse') : `${course.name}에서 파일 찾기`
            }
            aria-label="파일 검색어"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-activedescendant={items.length > 0 ? `${listId}-${clamped}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlighted((index) => Math.min(index + 1, items.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlighted((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                activate(items[clamped])
              }
            }}
          />
          <kbd className="quick-search__esc" aria-hidden="true">
            esc
          </kbd>
        </div>

        <div className="quick-search__body">
          {!showsResults ? null : error && settingsHits.length === 0 ? (
            <div className="quick-search__hint" role="alert">
              <p>{error}</p>
              <button type="button" className="button button--secondary" onClick={() => setAttempt(value => value + 1)}>다시 시도</button>
            </div>
          ) : isSearching && items.length === 0 ? (
            <p className="quick-search__hint" role="status">
              찾는 중…
            </p>
          ) : items.length === 0 ? (
            <p className="quick-search__hint">결과 없음</p>
          ) : (
            <ul id={listId} className="quick-search__list" role="listbox" aria-label="검색 결과">
              {items.map((item, index) => (
                <li key={`${item.type}:${item.type === 'file' ? item.hit.relPath : item.hit.id}`} role="presentation">
                  {item.type === 'setting' && index === hits.length && (
                    <span className="quick-search__section" aria-hidden="true">{t('quickSearch.settings.heading')}</span>
                  )}
                  <button
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === clamped}
                    data-highlighted={index === clamped}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => activate(item)}
                  >
                    {item.type === 'file' ? (
                      <>
                        <span className="quick-search__icon">
                          <Icon name={KIND_ICONS[item.hit.kind]} />
                        </span>
                        <span className="quick-search__name">{item.hit.name}</span>
                        <span className="quick-search__meta">
                          {item.hit.relPath.includes('/')
                            ? item.hit.relPath.slice(0, item.hit.relPath.lastIndexOf('/'))
                            : item.hit.kind !== 'other' || isViewableFile(item.hit.relPath) ? '탭에서 열기' : '폴더에서 보기'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="quick-search__icon">
                          <Icon name="settings" />
                        </span>
                        <span className="quick-search__name">{item.hit.title}</span>
                        <span className="quick-search__meta">
                          {t('quickSearch.settings.meta', { category: categoryLabel(item.hit.category) })}
                        </span>
                      </>
                    )}
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
