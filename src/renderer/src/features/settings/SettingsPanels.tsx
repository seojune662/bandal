import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { BandalMark } from '../../components/BandalMark'
import { LOCALES, setLocale, useLocale, useT } from '../../i18n'
import type { Locale } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { useUpdateStore } from '../../stores/updateStore'
import { SYSTEM_THEME } from '../../../../shared/theme'
import type { ThemeId } from '../../../../shared/theme'
import type { AgentAvailability } from '../../../../shared/types/agent-events'
import type { Course } from '../../../../shared/types/course'
import type {
  Settings,
  ThemePreference
} from '../../../../shared/types/settings'
import { reopenedOnboarding } from '../onboarding/onboardingModel'
import { Icon } from './SettingsIcon'

const THEME_OPTIONS: readonly ThemePreference[] = [
  'dark',
  'light',
  'midnight',
  'sepia',
  'high-contrast',
  'graphite',
  'system'
]

const APP_VERSION = '0.1.0'

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

function displayDataRoot(path: string | undefined): string {
  if (path === undefined || path.length === 0 || path.endsWith('/Documents/Bandal')) {
    return '~/Documents/Bandal'
  }
  return path
}

export function GeneralPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [onboardingReset, setOnboardingReset] = useState<
    'idle' | 'done' | 'failed'
  >('idle')

  const handleReopenOnboarding = (): void => {
    void invoke('settings:set', { onboarding: reopenedOnboarding() })
      .then(() => setOnboardingReset('done'))
      .catch(() => setOnboardingReset('failed'))
  }

  return (
    <div className="settings-stack">
      <SettingsCard
        title={t('settings.general.workspace.title')}
        description={t('settings.general.workspace.description')}
      >
        <div
          className="directory-field"
          aria-label={t('settings.general.workspace.directoryLabel')}
        >
          <Icon name="folder" size={17} />
          <input
            type="text"
            value={displayDataRoot(settings?.dataRoot)}
            aria-label={t('settings.general.workspace.pathLabel')}
            readOnly
          />
          <span className="badge">{t('settings.general.comingSoon')}</span>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.general.language.title')}
        description={t('settings.general.language.description')}
      >
        <div className="setting-row">
          <div className="setting-row__copy">
            <span className="setting-row__label">
              {t('settings.general.language.label')}
            </span>
            <span className="setting-row__description">
              {t('settings.general.language.help')}
            </span>
          </div>
          <select
            className="language-select"
            aria-label={t('settings.general.language.selectLabel')}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option}>
                {t(`settings.locale.${option}`)}
              </option>
            ))}
          </select>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.general.tabs.title')}
        description={t('settings.general.tabs.description')}
      >
        <div className="settings-card__rows">
          <ToggleRow
            label={t('settings.general.tabs.openBeside')}
            description={t('settings.general.tabs.openBesideDescription')}
            checked={false}
            disabled
            badge={t('settings.general.preparing')}
          />
          <ToggleRow
            label={t('settings.general.tabs.restore')}
            description={t('settings.general.tabs.restoreDescription')}
            checked={false}
            disabled
            badge={t('settings.general.preparing')}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.general.onboarding.title')}
        description={t('settings.general.onboarding.description')}
      >
        <div className="setting-row">
          <div className="setting-row__copy">
            <div className="setting-row__label-line">
              <span className="setting-row__label">
                {t('settings.general.onboarding.reopen')}
              </span>
            </div>
            <span className="setting-row__description">
              {t(`settings.general.onboarding.${onboardingReset}`)}
            </span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={handleReopenOnboarding}
          >
            {t('settings.general.onboarding.reopen')}
          </button>
        </div>
      </SettingsCard>
    </div>
  )
}

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
    <div
      className="theme-preview"
      style={previewPalette(theme)}
      aria-hidden="true"
    >
      <PreviewBody />
    </div>
  )
}

export function AppearancePanel({
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
  const t = useT()
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, THEME_OPTIONS.indexOf(theme))

  const moveTo = (index: number): void => {
    const count = THEME_OPTIONS.length
    const next = ((index % count) + count) % count
    optionRefs.current[next]?.focus()
    onSelect(THEME_OPTIONS[next]!)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = THEME_OPTIONS.indexOf(theme)
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
        title={t('settings.appearance.theme.title')}
        description={t('settings.appearance.theme.description')}
      >
        <div
          className="theme-grid"
          role="radiogroup"
          aria-label={t('settings.appearance.theme.selectLabel')}
          aria-busy={saving}
          onKeyDown={handleKeyDown}
        >
          {THEME_OPTIONS.map((option, index) => {
            const selected = theme === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                ref={(node) => {
                  optionRefs.current[index] = node
                }}
                aria-checked={selected}
                tabIndex={index === selectedIndex ? 0 : -1}
                className={`theme-choice${selected ? ' theme-choice--selected' : ''}`}
                onClick={() => onSelect(option)}
              >
                <ThemePreview theme={option} />
                <span className="theme-choice__copy">
                  <span className="theme-choice__label">
                    {t(`settings.appearance.theme.${option}.label`)}
                    <span className="theme-choice__check">
                      {selected && <Icon name="check" size={14} />}
                    </span>
                  </span>
                  <span className="theme-choice__description">
                    {t(`settings.appearance.theme.${option}.description`)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <p
          className={`settings-feedback${error !== null ? ' settings-feedback--error' : ''}`}
          aria-live="polite"
        >
          {error ??
            (saving
              ? t('settings.appearance.saving')
              : t('settings.appearance.saved'))}
        </p>
      </SettingsCard>
    </div>
  )
}

function AvailabilityRows({
  availability
}: {
  availability: AgentAvailability
}): JSX.Element {
  const t = useT()
  return (
    <dl className="detail-list">
      <div>
        <dt>{t('settings.ai.install')}</dt>
        <dd>
          {t(availability.installed ? 'settings.ai.installed' : 'settings.ai.notInstalled')}
        </dd>
      </div>
      <div>
        <dt>{t('settings.ai.version')}</dt>
        <dd>{availability.version ?? t('settings.ai.unknown')}</dd>
      </div>
      <div>
        <dt>{t('settings.ai.login')}</dt>
        <dd>
          {availability.installed
            ? t(availability.loggedIn ? 'settings.ai.connected' : 'settings.ai.loginRequired')
            : '—'}
        </dd>
      </div>
      <div>
        <dt>{t('settings.ai.subscription')}</dt>
        <dd>{availability.subscriptionType ?? t('settings.ai.unknown')}</dd>
      </div>
    </dl>
  )
}

export function AiPanel({
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
  const t = useT()
  const installed = availability?.installed === true
  const statusLabel = loading
    ? t('settings.ai.checking')
    : error !== null
      ? t('settings.ai.checkFailed')
      : installed
        ? t('settings.ai.available')
        : t('settings.ai.notInstalled')

  return (
    <div className="settings-stack">
      <SettingsCard className="integration-card">
        <div className="integration-card__heading">
          <div className="provider-mark provider-mark--claude" aria-hidden="true">
            C
          </div>
          <div className="integration-card__title">
            <h2>Claude Code</h2>
            <p>{t('settings.ai.claude.description')}</p>
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
          <div
            className="availability-skeleton"
            aria-label={t('settings.ai.claude.checkingLabel')}
          >
            <span />
            <span />
            <span />
          </div>
        ) : error !== null ? (
          <div className="inline-notice">
            <div>
              <strong>{t('settings.ai.connectionFailed')}</strong>
              <span>{t('settings.ai.tryAgainLater')}</span>
            </div>
            <button type="button" className="secondary-button" onClick={onRetry}>
              {t('settings.ai.retry')}
            </button>
          </div>
        ) : availability !== null ? (
          <>
            <AvailabilityRows availability={availability} />
            {!availability.installed && (
              <div className="inline-notice inline-notice--guidance">
                <Icon name="sparkles" size={18} />
                <div>
                  <strong>{t('settings.ai.claude.notInstalledTitle')}</strong>
                  <span>{t('settings.ai.claude.notInstalledHelp')}</span>
                </div>
              </div>
            )}
          </>
        ) : null}
      </SettingsCard>

      <SettingsCard className="integration-card integration-card--upcoming">
        <div className="integration-card__heading">
          <div className="provider-mark" aria-hidden="true">
            <Icon name="sparkles" size={18} />
          </div>
          <div className="integration-card__title">
            <h2>Codex</h2>
            <p>{t('settings.ai.codex.description')}</p>
          </div>
          <span className="badge">{t('settings.ai.upcoming')}</span>
        </div>
        <p className="integration-card__body-copy">
          {t('settings.ai.upcomingHelp')}
        </p>
      </SettingsCard>
    </div>
  )
}

export function CoursesPanel({
  courses,
  loading,
  error,
  includeArchived,
  pendingCourseId,
  onIncludeArchivedChange,
  onRestore,
  onRetry
}: {
  courses: Course[]
  loading: boolean
  error: string | null
  includeArchived: boolean
  pendingCourseId: string | null
  onIncludeArchivedChange: (next: boolean) => void
  onRestore: (course: Course) => void
  onRetry: () => void
}): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const courseCount = new Intl.NumberFormat(locale).format(courses.length)
  const restoreLabel = locale === 'ko-KR' ? '복원' : 'Restore'
  const restoringLabel = locale === 'ko-KR' ? '복원 중…' : 'Restoring…'

  return (
    <div className="settings-stack">
      <SettingsCard>
        <div className="course-card-heading">
          <div>
            <h2>{t('settings.courses.title')}</h2>
            <p>{t('settings.courses.description')}</p>
          </div>
          {!loading && error === null && (
            <span className="count-badge">{courseCount}</span>
          )}
        </div>

        <div
          className="course-list"
          aria-live="polite"
          aria-busy={pendingCourseId !== null}
        >
          {loading ? (
            <div className="course-loading" aria-label={t('settings.courses.loading')}>
              <span />
              <span />
              <span />
            </div>
          ) : error !== null ? (
            <div className="empty-state">
              <div className="empty-state__icon">
                <Icon name="courses" />
              </div>
              <strong>{t('settings.courses.loadFailed')}</strong>
              <span>{t('settings.courses.loadFailedHelp')}</span>
              <button type="button" className="secondary-button" onClick={onRetry}>
                {t('settings.courses.reload')}
              </button>
            </div>
          ) : courses.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">
                <Icon name="courses" />
              </div>
              <strong>{t('settings.courses.empty')}</strong>
              <span>{t('settings.courses.emptyHelp')}</span>
            </div>
          ) : (
            courses.map((course) => (
              <div className="course-item" key={course.id}>
                <div className="course-item__icon">
                  <Icon name="courses" size={17} />
                </div>
                <div className="course-item__copy">
                  <strong>{course.name}</strong>
                  <span>{course.slug}</span>
                </div>
                {course.archived && (
                  <div className="course-item__actions">
                    <span className="badge">{t('settings.courses.archived')}</span>
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`${course.name} ${restoreLabel}`}
                      disabled={pendingCourseId !== null}
                      onClick={() => onRestore(course)}
                    >
                      {pendingCourseId === course.id
                        ? restoringLabel
                        : restoreLabel}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="settings-card__footer-row">
          <ToggleRow
            label={t('settings.courses.showArchived')}
            description={t('settings.courses.showArchivedHelp')}
            checked={includeArchived}
            onChange={onIncludeArchivedChange}
          />
        </div>
      </SettingsCard>
    </div>
  )
}

function UpdateCard(): JSX.Element | null {
  const t = useT()
  const locale = useLocale()
  const status = useUpdateStore((state) => state.status)
  const init = useUpdateStore((state) => state.init)
  const check = useUpdateStore((state) => state.check)
  const download = useUpdateStore((state) => state.download)
  const install = useUpdateStore((state) => state.install)

  useEffect(() => {
    init()
  }, [init])

  if (status === null || status.phase === 'unsupported') return null

  const busy = status.phase === 'checking' || status.phase === 'downloading'
  const statusLabel =
    status.phase === 'checking'
      ? t('settings.update.checking')
      : status.phase === 'downloading'
        ? t('settings.update.downloading', { percent: status.percent })
        : status.phase === 'available'
          ? t('settings.update.available')
          : status.phase === 'ready'
            ? t('settings.update.ready')
            : status.phase === 'error'
              ? t('settings.update.failed')
              : t('settings.update.current')

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
          <h2>{t('settings.update.title')}</h2>
          <p>{t('settings.update.description')}</p>
        </div>
        <span className={`status-pill status-pill--${pillTone}`}>
          <span className="status-pill__dot" />
          {statusLabel}
        </span>
      </div>

      {status.phase === 'available' && (
        <div className="inline-notice">
          <div>
            <strong>{t('settings.update.availableTitle', { version: status.version })}</strong>
            <span>{t('settings.update.availableHelp')}</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void download()}
          >
            {t('settings.update.download')}
          </button>
        </div>
      )}

      {status.phase === 'ready' && (
        <div className="inline-notice">
          <div>
            <strong>{t('settings.update.readyTitle', { version: status.version })}</strong>
            <span>{t('settings.update.readyHelp')}</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void install()}
          >
            {t('settings.update.restart')}
          </button>
        </div>
      )}

      {status.phase === 'error' && (
        <div className="inline-notice">
          <div>
            <strong>{t('settings.update.errorTitle')}</strong>
            <span>{status.message}</span>
          </div>
        </div>
      )}

      {(status.phase === 'idle' || status.phase === 'checking') && (
        <div className="inline-notice">
          <div>
            <strong>
              {t('settings.update.currentVersion', { version: status.currentVersion })}
            </strong>
            <span>
              {status.phase === 'idle' && status.lastCheckedAt !== null
                ? t('settings.update.lastChecked', {
                    time: new Intl.DateTimeFormat(locale, {
                      timeStyle: 'short'
                    }).format(new Date(status.lastCheckedAt))
                  })
                : t('settings.update.automatic')}
            </span>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void check()}
          >
            {t(busy ? 'settings.update.checkingButton' : 'settings.update.check')}
          </button>
        </div>
      )}
    </SettingsCard>
  )
}

export function AboutPanel(): JSX.Element {
  const t = useT()
  return (
    <div className="settings-stack">
      <SettingsCard className="about-card">
        <div className="about-card__mark">
          <BandalMark size={62} title={t('settings.app.name')} />
        </div>
        <div className="about-card__copy">
          <h2>{t('settings.app.name')}</h2>
          <p>{t('settings.about.description')}</p>
          <span className="version-label">
            {t('settings.about.version', { version: APP_VERSION })}
          </span>
        </div>
      </SettingsCard>
      <UpdateCard />
      <p className="about-footer">{t('settings.about.footer')}</p>
    </div>
  )
}
