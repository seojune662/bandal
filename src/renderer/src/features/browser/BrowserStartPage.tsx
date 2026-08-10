import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResolvedService } from '../../../../shared/universities'
import { openSettingsWindow } from '../../lib/ipc'
import { favoriteScopeKey, useFavoritesStore } from '../../stores/favoritesStore'
import { useUniversityStore } from '../../stores/universityStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { openShortcut } from '../university/openService'
import { BrowserIcon } from './browserIcons'
import type { BrowserVisit } from './browserGuestsStore'
import {
  browserFavoriteShortcuts,
  hostnameForUrl,
  initialForUrl,
  toneForUrl,
  type BrowserShortcut
} from './browserStartPageModel'
import { resolveAddressInput } from './urlInput'

interface SiteMarkProps {
  url: string
}

export function BrowserSiteMark({ url }: SiteMarkProps): JSX.Element {
  if (url.length === 0) {
    return (
      <span
        className="browser-site-mark browser-site-mark--empty"
        aria-hidden="true"
      >
        <BrowserIcon name="globe" />
      </span>
    )
  }
  return (
    <span
      className="browser-site-mark"
      data-tone={toneForUrl(url)}
      aria-hidden="true"
    >
      {initialForUrl(url)}
    </span>
  )
}

interface AddressInputProps {
  ariaLabel: string
  mode: 'toolbar' | 'start'
  value: string
  onNavigate: (url: string) => void
}

export function BrowserAddressInput({
  ariaLabel,
  mode,
  value,
  onNavigate
}: AddressInputProps): JSX.Element {
  // null mirrors the live URL; a string is an in-progress user edit.
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (): void => {
    const url = resolveAddressInput(draft ?? value)
    if (url === null) return
    setDraft(null)
    inputRef.current?.blur()
    onNavigate(url)
  }

  return (
    <form
      className={`browser-address browser-address--${mode}`}
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <BrowserSiteMark url={value} />
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
        autoComplete="off"
        autoFocus={mode === 'start'}
        aria-label={ariaLabel}
        placeholder="검색어 또는 주소를 입력하세요"
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          if (!event.currentTarget.form?.contains(event.relatedTarget)) {
            setDraft(null)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
      {mode === 'start' && (
        <button type="submit" className="browser-address__submit">
          검색 또는 이동
        </button>
      )}
    </form>
  )
}

function ShortcutTile({
  shortcut,
  onOpen,
  meta
}: {
  shortcut: BrowserShortcut
  onOpen: (url: string) => void
  meta?: string
}): JSX.Element {
  return (
    <button
      type="button"
      className="browser-shortcut-tile"
      title={`${shortcut.label} — ${hostnameForUrl(shortcut.url)}`}
      onClick={() => onOpen(shortcut.url)}
    >
      <BrowserSiteMark url={shortcut.url} />
      <span className="browser-shortcut-tile__copy">
        <span className="browser-shortcut-tile__label">{shortcut.label}</span>
        <span className="browser-shortcut-tile__meta">
          {meta ?? hostnameForUrl(shortcut.url)}
        </span>
      </span>
    </button>
  )
}

function UniversityTile({
  service,
  onNavigate
}: {
  service: ResolvedService
  onNavigate: (url: string) => void
}): JSX.Element {
  const shortcut = { id: service.id, label: service.label, url: service.url }
  return (
    <ShortcutTile
      shortcut={shortcut}
      {...(service.opensExternally
        ? { meta: '기본 브라우저에서 열기' }
        : {})}
      onOpen={() => {
        if (service.opensExternally) {
          openShortcut({ url: service.url, opensExternally: true })
        } else {
          onNavigate(service.url)
        }
      }}
    />
  )
}

export function useBrowserFavoriteShortcuts(): {
  favorites: BrowserShortcut[]
  loading: boolean
  hasCourse: boolean
} {
  const courseId = useWorkspaceStore((state) => state.activeCourseId)
  const key = favoriteScopeKey(courseId)
  const stored = useFavoritesStore((state) => state.byCourse[key])
  const loading = useFavoritesStore(
    (state) => state.loadingByCourse[key] === true
  )
  const load = useFavoritesStore((state) => state.load)

  useEffect(() => {
    if (courseId !== null && stored === undefined && !loading) {
      void load(courseId)
    }
  }, [courseId, load, loading, stored])

  return {
    favorites: useMemo(() => browserFavoriteShortcuts(stored), [stored]),
    loading,
    hasCourse: courseId !== null
  }
}

interface BookmarksBarProps {
  favorites: readonly BrowserShortcut[]
  loading: boolean
  hasCourse: boolean
  onNavigate: (url: string) => void
}

export function BrowserBookmarksBar({
  favorites,
  loading,
  hasCourse,
  onNavigate
}: BookmarksBarProps): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const emptyCopy = !hasCourse
    ? '과목을 선택하면 바로가기가 표시됩니다.'
    : loading
      ? '바로가기를 불러오는 중…'
      : '브라우저 즐겨찾기가 없습니다.'

  return (
    <nav className="browser-bookmarks" aria-label="즐겨찾기 바로가기">
      <button
        type="button"
        className="browser-bookmarks__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? '바로가기 접기' : '바로가기 펼치기'}
      </button>
      {expanded && (
        <div className="browser-bookmarks__items">
          {favorites.length === 0 ? (
            <span className="browser-bookmarks__empty">{emptyCopy}</span>
          ) : (
            favorites.map((favorite) => (
              <button
                key={favorite.id}
                type="button"
                className="browser-bookmark"
                title={`${favorite.label} — ${hostnameForUrl(favorite.url)}`}
                onClick={() => onNavigate(favorite.url)}
              >
                <BrowserSiteMark url={favorite.url} />
                <span>{favorite.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </nav>
  )
}

interface BrowserStartPageProps {
  favorites: readonly BrowserShortcut[]
  favoritesLoading: boolean
  hasCourse: boolean
  recent: readonly BrowserVisit[]
  onNavigate: (url: string) => void
}

export function BrowserStartPage({
  favorites,
  favoritesLoading,
  hasCourse,
  recent,
  onNavigate
}: BrowserStartPageProps): JSX.Element {
  const loaded = useUniversityStore((state) => state.loaded)
  const university = useUniversityStore((state) => state.university)
  const services = useUniversityStore((state) => state.services)
  const favoriteEmptyCopy = !hasCourse
    ? '과목을 선택하면 즐겨찾기가 표시됩니다.'
    : favoritesLoading
      ? '즐겨찾기를 불러오는 중…'
      : '이 과목에 저장된 브라우저 즐겨찾기가 없습니다.'

  return (
    <main className="browser-start" aria-label="브라우저 시작 화면">
      <div className="browser-start__hero">
        <p className="browser-start__eyebrow">BANDAL BROWSER</p>
        <h1>어디로 갈까요?</h1>
        <BrowserAddressInput
          ariaLabel="시작 화면 검색 또는 주소"
          mode="start"
          value=""
          onNavigate={onNavigate}
        />
      </div>

      <div className="browser-start__sections">
        <section
          className="browser-start__section"
          aria-labelledby="browser-school-heading"
        >
          <div className="browser-start__heading">
            <h2 id="browser-school-heading">학교 바로가기</h2>
            {university !== null && <span>{university.nameKo}</span>}
          </div>
          {!loaded ? (
            <p className="browser-start__empty">학교 정보를 불러오는 중…</p>
          ) : university === null ? (
            <div className="browser-start__empty browser-start__empty--action">
              <p>학교를 고르면 포털과 강의 사이트가 여기에 표시됩니다.</p>
              <button
                type="button"
                onClick={() => {
                  void openSettingsWindow().catch((error: unknown) => {
                    console.error('[Bandal] 설정 창을 열지 못했습니다.', error)
                  })
                }}
              >
                학교 고르기
              </button>
            </div>
          ) : services.length === 0 ? (
            <p className="browser-start__empty">
              설정에서 학교 서비스를 추가할 수 있습니다.
            </p>
          ) : (
            <div className="browser-shortcut-grid">
              {services.map((service) => (
                <UniversityTile
                  key={service.id}
                  service={service}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </section>

        <section
          className="browser-start__section"
          aria-labelledby="browser-favorites-heading"
        >
          <div className="browser-start__heading">
            <h2 id="browser-favorites-heading">즐겨찾기</h2>
            <span>이 과목</span>
          </div>
          {favorites.length === 0 ? (
            <p className="browser-start__empty">{favoriteEmptyCopy}</p>
          ) : (
            <div className="browser-shortcut-grid">
              {favorites.map((favorite) => (
                <ShortcutTile
                  key={favorite.id}
                  shortcut={favorite}
                  onOpen={onNavigate}
                />
              ))}
            </div>
          )}
        </section>

        <section
          className="browser-start__section"
          aria-labelledby="browser-recent-heading"
        >
          <div className="browser-start__heading">
            <h2 id="browser-recent-heading">최근 방문</h2>
            <span>현재 탭에서만</span>
          </div>
          {recent.length === 0 ? (
            <p className="browser-start__empty">
              이 탭에서 방문한 페이지가 아직 없습니다.
            </p>
          ) : (
            <div className="browser-shortcut-grid">
              {recent.map((visit) => (
                <ShortcutTile
                  key={visit.url}
                  shortcut={{
                    id: visit.url,
                    label: visit.title,
                    url: visit.url
                  }}
                  onOpen={onNavigate}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
