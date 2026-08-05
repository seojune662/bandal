import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './SettingsIcon'
import type { AgentAvailability } from '../../../../shared/types/agent-events'
import type { Course } from '../../../../shared/types/course'
import type {
  Settings,
  ThemePreference
} from '../../../../shared/types/settings'
import { invoke, onPush } from '../../lib/ipc'
import './settings-app.css'
import './settings-panels.css'

type CategoryId = 'general' | 'appearance' | 'ai' | 'courses' | 'about'
interface Category {
  id: CategoryId
  group: 'Settings' | 'Workspace' | 'Info'
  label: string
  description: string
  keywords: string
}

const CATEGORIES: Category[] = [
  {
    id: 'general',
    group: 'Settings',
    label: 'General',
    description: '워크스페이스와 기본 동작을 관리합니다.',
    keywords: '일반 워크스페이스 디렉토리 폴더 탭'
  },
  {
    id: 'appearance',
    group: 'Settings',
    label: 'Appearance',
    description: '반달이 보이는 방식을 선택합니다.',
    keywords: '화면 모양 테마 다크 라이트 시스템'
  },
  {
    id: 'ai',
    group: 'Workspace',
    label: 'AI',
    description: '학습을 도와줄 AI 도구의 연결 상태를 확인합니다.',
    keywords: '에이전트 claude code codex 로그인 구독'
  },
  {
    id: 'courses',
    group: 'Workspace',
    label: 'Courses',
    description: '반달에 등록된 과목을 한눈에 확인합니다.',
    keywords: '과목 수업 보관 아카이브'
  },
  {
    id: 'about',
    group: 'Info',
    label: 'About',
    description: '반달의 버전과 제품 정보를 확인합니다.',
    keywords: '정보 버전 앱 제품'
  }
]

const THEME_OPTIONS: Array<{
  value: ThemePreference
  label: string
  description: string
}> = [
  { value: 'dark', label: '다크', description: '밤하늘처럼 차분하게' },
  { value: 'light', label: '라이트', description: '종이처럼 편안하게' },
  { value: 'system', label: '시스템', description: '기기 설정에 맞추기' }
]

const APP_VERSION = '0.1.0'

function resolveTheme(theme: ThemePreference): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  }
  return theme
}

function applyTheme(theme: ThemePreference): void {
  document.documentElement.dataset['theme'] = resolveTheme(theme)
}

function displayDataRoot(path: string | undefined): string {
  if (path === undefined || path.length === 0 || path.endsWith('/Documents/Bandal')) {
    return '~/Documents/Bandal'
  }
  return path
}

function SettingsCard({
  title,
  description,
  children,
  className = ''
}: {
  title?: string
  description?: string
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={`settings-card ${className}`.trim()}>
      {(title !== undefined || description !== undefined) && (
        <div className="settings-card__header">
          {title !== undefined && <h2>{title}</h2>}
          {description !== undefined && <p>{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
  badge
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange?: (next: boolean) => void
  badge?: string
}): JSX.Element {
  return (
    <div className={`setting-row${disabled ? ' setting-row--disabled' : ''}`}>
      <div className="setting-row__copy">
        <div className="setting-row__label-line">
          <span className="setting-row__label">{label}</span>
          {badge !== undefined && <span className="badge">{badge}</span>}
        </div>
        <span className="setting-row__description">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        className={`toggle${checked ? ' toggle--checked' : ''}`}
        onClick={() => onChange?.(!checked)}
      >
        <span className="toggle__thumb" />
      </button>
    </div>
  )
}

function ThemePreview({ theme }: { theme: ThemePreference }): JSX.Element {
  if (theme === 'system') {
    return (
      <div className="theme-preview theme-preview--system" aria-hidden="true">
        <span className="theme-preview__system-half theme-preview__system-half--dark" />
        <span className="theme-preview__system-half theme-preview__system-half--light" />
        <span className="theme-preview__sidebar" />
        <span className="theme-preview__topline" />
        <span className="theme-preview__card" />
      </div>
    )
  }

  return (
    <div className={`theme-preview theme-preview--${theme}`} aria-hidden="true">
      <span className="theme-preview__sidebar" />
      <span className="theme-preview__topline" />
      <span className="theme-preview__card" />
      <span className="theme-preview__line theme-preview__line--long" />
      <span className="theme-preview__line theme-preview__line--short" />
    </div>
  )
}

function GeneralPanel({ settings }: { settings: Settings | null }): JSX.Element {
  return (
    <div className="settings-stack">
      <SettingsCard
        title="워크스페이스"
        description="과목과 학습 자료가 저장되는 기본 위치입니다."
      >
        <div className="directory-field" aria-label="워크스페이스 디렉토리">
          <Icon name="folder" size={17} />
          <input
            type="text"
            value={displayDataRoot(settings?.dataRoot)}
            aria-label="워크스페이스 디렉토리 경로"
            readOnly
          />
          <span className="badge">추후 변경 예정</span>
        </div>
      </SettingsCard>

      <SettingsCard
        title="탭 동작"
        description="학습 화면에서 탭을 여는 방식을 설정합니다."
      >
        <div className="settings-card__rows">
          <ToggleRow
            label="새 자료를 옆 탭에서 열기"
            description="현재 탭을 유지하고 새 탭에서 자료를 엽니다."
            checked={false}
            disabled
            badge="준비 중"
          />
          <ToggleRow
            label="마지막 탭 복원"
            description="앱을 다시 열 때 이전 탭 구성을 복원합니다."
            checked={false}
            disabled
            badge="준비 중"
          />
        </div>
      </SettingsCard>
    </div>
  )
}

function AppearancePanel({
  theme,
  saving,
  error,
  onSelect
}: {
  theme: ThemePreference
  saving: boolean
  error: string | null
  onSelect: (theme: ThemePreference) => void
}): JSX.Element {
  return (
    <div className="settings-stack">
      <SettingsCard
        title="테마"
        description="선택한 테마는 모든 반달 창에 바로 적용됩니다."
      >
        <div className="theme-grid" role="radiogroup" aria-label="테마 선택">
          {THEME_OPTIONS.map((option) => {
            const selected = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving}
                className={`theme-choice${selected ? ' theme-choice--selected' : ''}`}
                onClick={() => onSelect(option.value)}
              >
                <ThemePreview theme={option.value} />
                <span className="theme-choice__copy">
                  <span className="theme-choice__label">
                    {option.label}
                    <span className="theme-choice__check">
                      {selected && <Icon name="check" size={14} />}
                    </span>
                  </span>
                  <span className="theme-choice__description">{option.description}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className={`settings-feedback${error !== null ? ' settings-feedback--error' : ''}`} aria-live="polite">
          {error ?? (saving ? '테마를 저장하는 중…' : '변경 사항은 자동으로 저장됩니다.')}
        </p>
      </SettingsCard>
    </div>
  )
}

function AvailabilityRows({ availability }: { availability: AgentAvailability }): JSX.Element {
  return (
    <dl className="detail-list">
      <div>
        <dt>설치</dt>
        <dd>{availability.installed ? '설치됨' : '미설치'}</dd>
      </div>
      <div>
        <dt>버전</dt>
        <dd>{availability.version ?? '확인되지 않음'}</dd>
      </div>
      <div>
        <dt>로그인</dt>
        <dd>
          {availability.installed
            ? availability.loggedIn
              ? '연결됨'
              : '로그인 필요'
            : '—'}
        </dd>
      </div>
      <div>
        <dt>구독</dt>
        <dd>{availability.subscriptionType ?? '확인되지 않음'}</dd>
      </div>
    </dl>
  )
}

function AiPanel({
  availability,
  loading,
  error,
  onRetry
}: {
  availability: AgentAvailability | null
  loading: boolean
  error: string | null
  onRetry: () => void
}): JSX.Element {
  const installed = availability?.installed === true
  const statusLabel = loading
    ? '확인 중'
    : error !== null
      ? '확인 실패'
      : installed
        ? '연결 가능'
        : '미설치'

  return (
    <div className="settings-stack">
      <SettingsCard className="integration-card">
        <div className="integration-card__heading">
          <div className="provider-mark provider-mark--claude" aria-hidden="true">
            C
          </div>
          <div className="integration-card__title">
            <h2>Claude Code</h2>
            <p>과목 컨텍스트를 활용하는 기본 AI 에이전트</p>
          </div>
          <span
            className={`status-pill status-pill--${
              loading ? 'loading' : error !== null ? 'muted' : installed ? 'ready' : 'muted'
            }`}
          >
            <span className="status-pill__dot" />
            {statusLabel}
          </span>
        </div>

        {loading ? (
          <div className="availability-skeleton" aria-label="Claude Code 상태 확인 중">
            <span />
            <span />
            <span />
          </div>
        ) : error !== null ? (
          <div className="inline-notice">
            <div>
              <strong>연결 상태를 확인하지 못했습니다.</strong>
              <span>잠시 후 다시 시도해 주세요.</span>
            </div>
            <button type="button" className="secondary-button" onClick={onRetry}>
              다시 확인
            </button>
          </div>
        ) : availability !== null ? (
          <>
            <AvailabilityRows availability={availability} />
            {!availability.installed && (
              <div className="inline-notice inline-notice--guidance">
                <Icon name="sparkles" size={18} />
                <div>
                  <strong>Claude Code가 아직 설치되지 않았습니다.</strong>
                  <span>설치를 마친 뒤 이 페이지를 다시 열면 자동으로 연결 상태를 확인합니다.</span>
                </div>
              </div>
            )}
          </>
        ) : null}
      </SettingsCard>

      <SettingsCard className="integration-card integration-card--upcoming">
        <div className="integration-card__heading">
          <div className="provider-mark" aria-hidden="true">
            ◐
          </div>
          <div className="integration-card__title">
            <h2>Codex</h2>
            <p>Codex CLI 기반 학습 에이전트</p>
          </div>
          <span className="badge">지원 예정</span>
        </div>
        <p className="integration-card__body-copy">
          더 다양한 AI 도구를 반달 안에서 선택할 수 있도록 준비하고 있습니다.
        </p>
      </SettingsCard>
    </div>
  )
}

function CoursesPanel({
  courses,
  loading,
  error,
  includeArchived,
  onIncludeArchivedChange,
  onRetry
}: {
  courses: Course[]
  loading: boolean
  error: string | null
  includeArchived: boolean
  onIncludeArchivedChange: (next: boolean) => void
  onRetry: () => void
}): JSX.Element {
  return (
    <div className="settings-stack">
      <SettingsCard>
        <div className="course-card-heading">
          <div>
            <h2>내 과목</h2>
            <p>현재 워크스페이스에 등록된 과목입니다.</p>
          </div>
          {!loading && error === null && (
            <span className="count-badge">{courses.length}</span>
          )}
        </div>

        <div className="course-list" aria-live="polite">
          {loading ? (
            <div className="course-loading" aria-label="과목 불러오는 중">
              <span />
              <span />
              <span />
            </div>
          ) : error !== null ? (
            <div className="empty-state">
              <div className="empty-state__icon"><Icon name="courses" /></div>
              <strong>과목을 불러오지 못했습니다.</strong>
              <span>워크스페이스 연결을 확인한 뒤 다시 시도해 주세요.</span>
              <button type="button" className="secondary-button" onClick={onRetry}>
                다시 불러오기
              </button>
            </div>
          ) : courses.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon"><Icon name="courses" /></div>
              <strong>아직 등록된 과목이 없습니다.</strong>
              <span>앱으로 돌아가 첫 과목을 만들면 여기에 표시됩니다.</span>
            </div>
          ) : (
            courses.map((course) => (
              <div className="course-item" key={course.id}>
                <div className="course-item__icon"><Icon name="courses" size={17} /></div>
                <div className="course-item__copy">
                  <strong>{course.name}</strong>
                  <span>{course.slug}</span>
                </div>
                {course.archived && <span className="badge">보관됨</span>}
              </div>
            ))
          )}
        </div>

        <div className="settings-card__footer-row">
          <ToggleRow
            label="보관된 과목 표시"
            description="목록에 보관 처리한 과목도 함께 표시합니다."
            checked={includeArchived}
            onChange={onIncludeArchivedChange}
          />
        </div>
      </SettingsCard>
    </div>
  )
}

function AboutPanel(): JSX.Element {
  return (
    <div className="settings-stack">
      <SettingsCard className="about-card">
        <div className="about-card__mark" aria-hidden="true">
          <span>◐</span>
        </div>
        <div className="about-card__copy">
          <h2>반달</h2>
          <p>수업 자료와 노트, AI 학습 도구를 한곳에 모은 대학생을 위한 학습 IDE.</p>
          <span className="version-label">버전 {APP_VERSION}</span>
        </div>
      </SettingsCard>
      <p className="about-footer">달이 차오르듯, 배움도 조금씩.</p>
    </div>
  )
}

export function SettingsApp(): JSX.Element {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('general')
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [theme, setTheme] = useState<ThemePreference>('dark')
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeError, setThemeError] = useState<string | null>(null)
  const [availability, setAvailability] = useState<AgentAvailability | null>(null)
  const [availabilityLoading, setAvailabilityLoading] = useState(true)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  const mountedRef = useRef(true)

  const active = CATEGORIES.find((category) => category.id === activeCategory) ?? CATEGORIES[0]!

  const filteredCategories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (normalized.length === 0) return CATEGORIES
    return CATEGORIES.filter((category) =>
      `${category.label} ${category.description} ${category.keywords}`
        .toLocaleLowerCase()
        .includes(normalized)
    )
  }, [query])

  const loadAvailability = (): void => {
    setAvailabilityLoading(true)
    setAvailabilityError(null)
    void invoke('agent:availability', { provider: 'claude-code' })
      .then((result) => {
        if (mountedRef.current) setAvailability(result)
      })
      .catch(() => {
        if (mountedRef.current) setAvailabilityError('availability-failed')
      })
      .finally(() => {
        if (mountedRef.current) setAvailabilityLoading(false)
      })
  }

  const loadCourses = (showArchived: boolean): void => {
    setCoursesLoading(true)
    setCoursesError(null)
    void invoke('courses:list', { includeArchived: showArchived })
      .then((result) => {
        if (mountedRef.current) setCourses(result)
      })
      .catch(() => {
        if (mountedRef.current) setCoursesError('courses-failed')
      })
      .finally(() => {
        if (mountedRef.current) setCoursesLoading(false)
      })
  }

  useEffect(() => {
    mountedRef.current = true
    const unsubscribe = onPush('settings:changed', ({ settings: next }) => {
      setSettings(next)
      setTheme(next.theme)
      applyTheme(next.theme)
    })

    void invoke('settings:get', {})
      .then((result) => {
        if (!mountedRef.current) return
        setSettings(result)
        setTheme(result.theme)
        applyTheme(result.theme)
      })
      .catch(() => {
        if (mountedRef.current) setThemeError('저장된 설정을 불러오지 못했습니다.')
      })

    loadAvailability()
    loadCourses(false)

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = (): void => {
      if (theme === 'system') applyTheme('system')
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  const handleThemeSelect = (nextTheme: ThemePreference): void => {
    if (nextTheme === theme || themeSaving) return
    const previousTheme = theme
    setTheme(nextTheme)
    applyTheme(nextTheme)
    setThemeSaving(true)
    setThemeError(null)

    void invoke('settings:set', { theme: nextTheme })
      .then((nextSettings) => {
        if (!mountedRef.current) return
        setSettings(nextSettings)
        setTheme(nextSettings.theme)
        applyTheme(nextSettings.theme)
      })
      .catch(() => {
        if (!mountedRef.current) return
        setTheme(previousTheme)
        applyTheme(previousTheme)
        setThemeError('테마를 저장하지 못했습니다. 다시 시도해 주세요.')
      })
      .finally(() => {
        if (mountedRef.current) setThemeSaving(false)
      })
  }

  const handleArchivedChange = (next: boolean): void => {
    setIncludeArchived(next)
    loadCourses(next)
  }

  const panel = {
    general: <GeneralPanel settings={settings} />,
    appearance: (
      <AppearancePanel
        theme={theme}
        saving={themeSaving}
        error={themeError}
        onSelect={handleThemeSelect}
      />
    ),
    ai: (
      <AiPanel
        availability={availability}
        loading={availabilityLoading}
        error={availabilityError}
        onRetry={loadAvailability}
      />
    ),
    courses: (
      <CoursesPanel
        courses={courses}
        loading={coursesLoading}
        error={coursesError}
        includeArchived={includeArchived}
        onIncludeArchivedChange={handleArchivedChange}
        onRetry={() => loadCourses(includeArchived)}
      />
    ),
    about: <AboutPanel />
  } satisfies Record<CategoryId, ReactNode>

  const groups: Category['group'][] = ['Settings', 'Workspace', 'Info']

  return (
    <div className="settings-app">
      <header className="settings-titlebar titlebar-drag">
        <div className="settings-titlebar__brand">
          <span className="settings-titlebar__moon" aria-hidden="true">◐</span>
          <span>반달</span>
        </div>
        <span className="settings-titlebar__divider" aria-hidden="true" />
        <span className="settings-titlebar__label">설정</span>
      </header>

      <div className="settings-layout">
        <aside className="settings-sidebar" aria-label="설정 탐색">
          <button type="button" className="back-button" onClick={() => window.close()}>
            <Icon name="arrow-left" size={17} />
            <span>Back to app</span>
          </button>

          <label className="settings-search">
            <span className="visually-hidden">설정 검색</span>
            <Icon name="search" size={16} />
            <input
              type="search"
              value={query}
              placeholder="설정 검색"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('')
              }}
            />
          </label>

          <nav className="settings-nav">
            {groups.map((group) => {
              const categories = filteredCategories.filter((category) => category.group === group)
              if (categories.length === 0) return null
              return (
                <div className="settings-nav__group" key={group}>
                  <span className="settings-nav__group-label">{group}</span>
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={`settings-nav__item${activeCategory === category.id ? ' settings-nav__item--active' : ''}`}
                      aria-current={activeCategory === category.id ? 'page' : undefined}
                      onClick={() => setActiveCategory(category.id)}
                    >
                      <Icon name={category.id} />
                      <span>{category.label}</span>
                    </button>
                  ))}
                </div>
              )
            })}
            {filteredCategories.length === 0 && (
              <div className="settings-nav__empty">
                <Icon name="search" size={17} />
                <span>검색 결과가 없습니다.</span>
              </div>
            )}
          </nav>

          <div className="settings-sidebar__footer">
            <span className="settings-sidebar__footer-moon" aria-hidden="true">◐</span>
            <span>Study at your rhythm.</span>
          </div>
        </aside>

        <main className="settings-content" tabIndex={-1}>
          <div className="settings-content__inner">
            <header className="content-heading">
              <span className="content-heading__eyebrow">Bandal settings</span>
              <h1>{active.label}</h1>
              <p>{active.description}</p>
            </header>
            <div className="settings-panel" key={active.id}>
              {panel[active.id]}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
