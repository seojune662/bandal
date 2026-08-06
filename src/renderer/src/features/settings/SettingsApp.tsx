import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { Icon } from './SettingsIcon'
import { BandalMark } from '../../components/BandalMark'
import { SYSTEM_THEME, THEMES } from '../../../../shared/theme'
import type { ResolvedTheme, ThemeId } from '../../../../shared/theme'
import type { AgentAvailability } from '../../../../shared/types/agent-events'
import type { Course } from '../../../../shared/types/course'
import type {
  Settings,
  ThemePreference
} from '../../../../shared/types/settings'
import { invoke, onPush } from '../../lib/ipc'
import { useUpdateStore } from '../../stores/updateStore'
import { reopenedOnboarding } from '../onboarding/onboardingModel'
import { UniversitySettingsPanel } from './UniversitySettingsPanel'
import './settings-app.css'
import './settings-panels.css'

type CategoryId =
  | 'general'
  | 'appearance'
  | 'ai'
  | 'university'
  | 'courses'
  | 'about'
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
    keywords: '화면 모양 테마 다크 라이트 시스템 자정 세피아 고대비 흑연 야간 oled 접근성 눈부심'
  },
  {
    id: 'ai',
    group: 'Workspace',
    label: 'AI',
    description: '학습을 도와줄 AI 도구의 연결 상태를 확인합니다.',
    keywords: '에이전트 claude code codex 로그인 구독'
  },
  {
    id: 'university',
    group: 'Workspace',
    label: 'University',
    description: '학교 학사 사이트 바로가기를 관리합니다.',
    keywords:
      '학교 대학 학사 포털 lms 강의실 도서관 수강신청 바로가기 etl 캠퍼스 university'
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
    description: '반달의 버전을 확인하고 업데이트합니다.',
    keywords: '정보 버전 앱 제품 업데이트 최신 새버전 update'
  }
]

interface ThemeOption {
  value: ThemePreference
  label: string
  description: string
}

/** Built from the registry (src/shared/theme.ts) — adding a theme adds a card
 * here with no edit. `시스템` is appended last and is not a theme id. */
const THEME_OPTIONS: readonly ThemeOption[] = [
  ...THEMES.map((theme) => ({
    value: theme.id,
    label: theme.name,
    description: theme.description
  })),
  {
    value: 'system',
    label: '시스템',
    description: '기기 설정에 따라 반달 다크와 라이트를 오갑니다.'
  }
]

const APP_VERSION = '0.1.0'

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? SYSTEM_THEME.light
      : SYSTEM_THEME.dark
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

/**
 * Each theme file exports its palette as `--preview-<id>-{bg,surface,text,
 * accent}` on `:root`, so a card can paint another theme's colors while a
 * different theme is active. This maps those into the generic names the
 * preview CSS uses — no per-theme CSS rule anywhere.
 */
function previewPalette(id: ThemeId): CSSProperties {
  return {
    '--preview-bg': `var(--preview-${id}-bg)`,
    '--preview-surface': `var(--preview-${id}-surface)`,
    '--preview-text': `var(--preview-${id}-text)`,
    '--preview-accent': `var(--preview-${id}-accent)`
  } as CSSProperties
}

function PreviewBody(): JSX.Element {
  return (
    <>
      <span className="theme-preview__sidebar" />
      <span className="theme-preview__accent" />
      <span className="theme-preview__line theme-preview__line--long" />
      <span className="theme-preview__line theme-preview__line--short" />
    </>
  )
}

function ThemePreview({ theme }: { theme: ThemePreference }): JSX.Element {
  if (theme === 'system') {
    // Split card: the pair `system` actually switches between.
    return (
      <div className="theme-preview theme-preview--system" aria-hidden="true">
        <span
          className="theme-preview__half"
          style={previewPalette(SYSTEM_THEME.dark)}
        >
          <PreviewBody />
        </span>
        <span
          className="theme-preview__half"
          style={previewPalette(SYSTEM_THEME.light)}
        >
          <PreviewBody />
        </span>
      </div>
    )
  }

  return (
    <div className="theme-preview" style={previewPalette(theme)} aria-hidden="true">
      <PreviewBody />
    </div>
  )
}

function GeneralPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const [onboardingReset, setOnboardingReset] = useState<
    'idle' | 'done' | 'failed'
  >('idle')

  const handleReopenOnboarding = (): void => {
    // Resetting the persisted state broadcasts settings:changed; the main
    // window reacts by re-opening the wizard (features/onboarding).
    void invoke('settings:set', { onboarding: reopenedOnboarding() })
      .then(() => setOnboardingReset('done'))
      .catch(() => setOnboardingReset('failed'))
  }

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

      <SettingsCard
        title="시작 안내"
        description="반달을 처음 열었을 때의 3단계 안내를 다시 볼 수 있습니다."
      >
        <div className="setting-row">
          <div className="setting-row__copy">
            <div className="setting-row__label-line">
              <span className="setting-row__label">온보딩 다시 보기</span>
            </div>
            <span className="setting-row__description">
              {onboardingReset === 'done'
                ? '준비됐어요 — 메인 창에서 온보딩이 다시 열립니다.'
                : onboardingReset === 'failed'
                  ? '온보딩을 다시 열지 못했습니다. 잠시 후 다시 시도해 주세요.'
                  : '과목 만들기와 AI 연결 단계를 처음부터 안내합니다.'}
            </span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={handleReopenOnboarding}
          >
            온보딩 다시 보기
          </button>
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
  // WAI-ARIA radiogroup: one tab stop for the whole grid, arrows move and
  // select. Without this, N themes means N tab stops.
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(
    0,
    THEME_OPTIONS.findIndex((option) => option.value === theme)
  )

  const moveTo = (index: number): void => {
    const count = THEME_OPTIONS.length
    const next = ((index % count) + count) % count
    optionRefs.current[next]?.focus()
    onSelect(THEME_OPTIONS[next]!.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = THEME_OPTIONS.findIndex((option) => option.value === theme)
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveTo(current + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveTo(current - 1)
        break
      case 'Home':
        event.preventDefault()
        moveTo(0)
        break
      case 'End':
        event.preventDefault()
        moveTo(THEME_OPTIONS.length - 1)
        break
      default:
        break
    }
  }

  return (
    <div className="settings-stack">
      <SettingsCard
        title="테마"
        description="선택한 테마는 모든 반달 창에 바로 적용됩니다. 각 카드는 그 테마의 실제 색을 미리 보여줍니다."
      >
        {/* Not `disabled` while saving: disabling the focused radio drops
            focus out of the group and kills arrow navigation. The write is
            serialized in handleThemeSelect instead. */}
        <div
          className="theme-grid"
          role="radiogroup"
          aria-label="테마 선택"
          aria-busy={saving}
          onKeyDown={handleKeyDown}
        >
          {THEME_OPTIONS.map((option, index) => {
            const selected = theme === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                aria-checked={selected}
                tabIndex={index === selectedIndex ? 0 : -1}
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
          {/* Not the 반달 mark — a provider tile. The half-moon now belongs
              to the product alone (BandalMark). */}
          <div className="provider-mark" aria-hidden="true">
            <Icon name="sparkles" size={18} />
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

/**
 * The durable home for update state.
 *
 * The workspace toast only fires on the two phases worth interrupting for
 * (`available`, `ready`); everything else — "checking", download percentage,
 * "already up to date", the last error — is shown here, where the student came
 * looking for it.
 */
function UpdateCard(): JSX.Element | null {
  const status = useUpdateStore((state) => state.status)
  const init = useUpdateStore((state) => state.init)
  const check = useUpdateStore((state) => state.check)
  const download = useUpdateStore((state) => state.download)
  const install = useUpdateStore((state) => state.install)

  useEffect(() => {
    init()
  }, [init])

  if (status === null) return null
  // Unpackaged build: there is no update feed, so a "check" button could only
  // ever fail. Hide the whole card rather than explain a dev-only condition.
  if (status.phase === 'unsupported') return null

  const busy = status.phase === 'checking' || status.phase === 'downloading'

  const statusLabel =
    status.phase === 'checking'
      ? '확인 중'
      : status.phase === 'downloading'
        ? `내려받는 중 ${status.percent}%`
        : status.phase === 'available'
          ? '업데이트 있음'
          : status.phase === 'ready'
            ? '재시작 대기'
            : status.phase === 'error'
              ? '확인 실패'
              : '최신 버전'

  const pillTone =
    status.phase === 'checking' || status.phase === 'downloading'
      ? 'loading'
      : status.phase === 'available' || status.phase === 'ready'
        ? 'ready'
        : 'muted'

  return (
    <SettingsCard className="integration-card">
      <div className="integration-card__heading">
        <div className="integration-card__title">
          <h2>업데이트</h2>
          <p>새 버전이 나오면 반달이 알려 드립니다.</p>
        </div>
        <span className={`status-pill status-pill--${pillTone}`}>
          <span className="status-pill__dot" />
          {statusLabel}
        </span>
      </div>

      {status.phase === 'available' && (
        <div className="inline-notice">
          <div>
            <strong>버전 {status.version} 을 사용할 수 있습니다.</strong>
            <span>지금 내려받고 다음 재시작에 적용할 수 있습니다.</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void download()}
          >
            내려받기
          </button>
        </div>
      )}

      {status.phase === 'ready' && (
        <div className="inline-notice">
          <div>
            <strong>버전 {status.version} 준비 완료.</strong>
            <span>재시작하면 적용됩니다.</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void install()}
          >
            지금 재시작
          </button>
        </div>
      )}

      {status.phase === 'error' && (
        <div className="inline-notice">
          <div>
            <strong>업데이트를 확인하지 못했습니다.</strong>
            <span>{status.message}</span>
          </div>
        </div>
      )}

      {(status.phase === 'idle' || status.phase === 'checking') && (
        <div className="inline-notice">
          <div>
            <strong>현재 버전 {status.currentVersion}</strong>
            <span>
              {status.phase === 'idle' && status.lastCheckedAt !== null
                ? `마지막 확인 ${new Date(status.lastCheckedAt).toLocaleTimeString('ko-KR')}`
                : '자동으로 6시간마다 확인합니다.'}
            </span>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void check()}
          >
            {busy ? '확인 중…' : '업데이트 확인'}
          </button>
        </div>
      )}
    </SettingsCard>
  )
}

function AboutPanel(): JSX.Element {
  return (
    <div className="settings-stack">
      <SettingsCard className="about-card">
        <div className="about-card__mark">
          <BandalMark size={62} title="반달" />
        </div>
        <div className="about-card__copy">
          <h2>반달</h2>
          <p>수업 자료와 노트, AI 학습 도구를 한곳에 모은 대학생을 위한 학습 IDE.</p>
          <span className="version-label">버전 {APP_VERSION}</span>
        </div>
      </SettingsCard>
      <UpdateCard />
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
    university: <UniversitySettingsPanel />,
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
          <BandalMark size={17} className="settings-titlebar__moon" />
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
            <BandalMark size={14} className="settings-sidebar__footer-moon" />
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
