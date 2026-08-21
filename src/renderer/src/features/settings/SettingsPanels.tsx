import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent,
  MutableRefObject,
  ReactNode
} from 'react'
import { BandalMark } from '../../components/BandalMark'
import { LOCALES, setLocale, useLocale, useT } from '../../i18n'
import type { Locale } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { useUpdateStore } from '../../stores/updateStore'
import type { OrbCharmId } from '../../../../shared/orbCharm'
import { SYSTEM_THEME } from '../../../../shared/theme'
import type { PaletteId, ThemeId } from '../../../../shared/theme'
import type {
  AgentAvailability,
  AgentProvider
} from '../../../../shared/types/agent-events'
import type { Course } from '../../../../shared/types/course'
import type {
  Settings,
  ThemePreference
} from '../../../../shared/types/settings'
import { CHARM_OPTIONS, CharmPreview } from '../assistant/charms'
import { reopenedOnboarding } from '../onboarding/onboardingModel'
import { Icon } from './SettingsIcon'

export { McpServersPanel } from './McpServersPanel'

/** Picker order for the *mode* axis — the registry order, then `system`. */
const THEME_OPTIONS: readonly ThemePreference[] = [
  'dark',
  'light',
  'midnight',
  'sepia',
  'high-contrast',
  'graphite',
  'system'
]

/** Picker order for the *palette* axis — mirrors PALETTES in shared/theme.ts. */
const PALETTE_OPTIONS: readonly PaletteId[] = [
  'bandal',
  'ink',
  'lavender',
  'moss'
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

function rejectedMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.trim().length > 0) return error
  return fallback
}

export function GeneralPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [onboardingReset, setOnboardingReset] = useState<
    'idle' | 'done' | 'failed'
  >('idle')
  const [tutorialReset, setTutorialReset] = useState<
    'idle' | 'done' | 'failed'
  >('idle')
  const [pickedDataRoot, setPickedDataRoot] = useState<string | null>(null)
  const [pickingDataRoot, setPickingDataRoot] = useState(false)
  const [dataRootError, setDataRootError] = useState<string | null>(null)

  useEffect(() => setPickedDataRoot(null), [settings?.dataRoot])

  const handleReopenOnboarding = (): void => {
    void invoke('settings:set', { onboarding: reopenedOnboarding() })
      .then(() => setOnboardingReset('done'))
      .catch(() => setOnboardingReset('failed'))
  }

  const handleReplayTutorial = (): void => {
    void invoke('settings:set', {
      tutorial: { seenVersion: 0, activeCourseId: null }
    })
      .then(() => setTutorialReset('done'))
      .catch(() => setTutorialReset('failed'))
  }

  const handlePickDataRoot = (): void => {
    if (pickingDataRoot) return
    setPickingDataRoot(true)
    setDataRootError(null)
    void invoke('settings:pickDataRoot', {})
      .then((result) => {
        if (result !== null) setPickedDataRoot(result.dataRoot)
      })
      .catch((error: unknown) => {
        setDataRootError(
          rejectedMessage(error, t('settings.general.workspace.pickFailed'))
        )
      })
      .finally(() => setPickingDataRoot(false))
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
            value={displayDataRoot(pickedDataRoot ?? settings?.dataRoot)}
            aria-label={t('settings.general.workspace.pathLabel')}
            readOnly
          />
        </div>
        <div className="settings-card__rows">
          <div className="setting-row">
            <span
              className={`setting-row__description${dataRootError === null ? '' : ' settings-feedback--error'}`}
              role={dataRootError === null ? undefined : 'alert'}
            >
              {dataRootError ?? t('settings.general.workspace.moveNotice')}
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={pickingDataRoot}
              onClick={handlePickDataRoot}
            >
              {t(
                pickingDataRoot
                  ? 'settings.general.workspace.picking'
                  : 'settings.general.workspace.change'
              )}
            </button>
          </div>
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
            checked={settings?.openAdjacentTab ?? false}
            onChange={(openAdjacentTab) => {
              void invoke('settings:set', { openAdjacentTab })
            }}
          />
          <ToggleRow
            label={t('settings.general.tabs.restore')}
            description={t('settings.general.tabs.restoreDescription')}
            checked={settings?.restoreLastCourse ?? false}
            onChange={(restoreLastCourse) => {
              void invoke('settings:set', { restoreLastCourse })
            }}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.general.onboarding.title')}
        description={t('settings.general.onboarding.description')}
      >
        <div className="settings-card__rows">
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
          <div className="setting-row">
            <div className="setting-row__copy">
              <div className="setting-row__label-line">
                <span className="setting-row__label">
                  {t('settings.general.tutorial.reopen')}
                </span>
              </div>
              <span className="setting-row__description">
                {t(`settings.general.tutorial.${tutorialReset}`)}
              </span>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={handleReplayTutorial}
            >
              {t('settings.general.tutorial.reopen')}
            </button>
          </div>
        </div>
      </SettingsCard>
    </div>
  )
}

/**
 * Points a preview card at one (palette, mode) cell of the swatch table that
 * `styles/palettes/*.css` exports. Both axes are needed because a palette
 * re-cuts the surfaces of the tinted modes — a mode card has no single color
 * until you know which family is active.
 */
function swatchVars(palette: PaletteId, mode: ThemeId): CSSProperties {
  const cell = `--swatch-${palette}-${mode}`
  return {
    '--preview-bg': `var(${cell}-bg)`,
    '--preview-surface': `var(${cell}-surface)`,
    '--preview-text': `var(${cell}-text)`,
    '--preview-accent': `var(${cell}-accent)`
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

function ThemePreview({
  theme,
  palette
}: {
  theme: ThemePreference
  palette: PaletteId
}): JSX.Element {
  if (theme === 'system') {
    return (
      <div className="theme-preview theme-preview--system" aria-hidden="true">
        <span
          className="theme-preview__half"
          style={swatchVars(palette, SYSTEM_THEME.dark)}
        >
          <PreviewBody />
        </span>
        <span
          className="theme-preview__half"
          style={swatchVars(palette, SYSTEM_THEME.light)}
        >
          <PreviewBody />
        </span>
      </div>
    )
  }

  return (
    <div
      className="theme-preview"
      style={swatchVars(palette, theme)}
      aria-hidden="true"
    >
      <PreviewBody />
    </div>
  )
}

/**
 * Roving-tabindex keyboard model shared by both appearance radiogroups:
 * arrows move *and* select (the preview is the feedback), Home/End jump.
 */
function useRovingRadios<T extends string>(
  options: readonly T[],
  value: T,
  onSelect: (next: T) => void
): {
  refs: MutableRefObject<Array<HTMLButtonElement | null>>
  selectedIndex: number
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
} {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, options.indexOf(value))

  const moveTo = (index: number): void => {
    const count = options.length
    const next = ((index % count) + count) % count
    refs.current[next]?.focus()
    onSelect(options[next]!)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = options.indexOf(value)
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
        moveTo(options.length - 1)
        break
      default:
        break
    }
  }

  return { refs, selectedIndex, handleKeyDown }
}

/**
 * Appearance is two independent axes (see src/shared/theme.ts): the *mode*
 * owns the surface ladder, the *palette* owns the color family. Two grids
 * rather than one 24-cell grid — the cross product is what the tokens
 * compose, not something the student should have to scan.
 */
export function AppearancePanel({
  theme,
  palette,
  orbCharm,
  saving,
  error,
  onSelect,
  onSelectPalette,
  onSelectCharm
}: {
  theme: ThemePreference
  palette: PaletteId
  orbCharm: OrbCharmId
  saving: boolean
  error: string | null
  onSelect: (theme: ThemePreference) => void
  onSelectPalette: (palette: PaletteId) => void
  onSelectCharm: (orbCharm: OrbCharmId) => void
}): JSX.Element {
  const t = useT()
  const modes = useRovingRadios(THEME_OPTIONS, theme, onSelect)
  const palettes = useRovingRadios(PALETTE_OPTIONS, palette, onSelectPalette)
  const charms = useRovingRadios(CHARM_OPTIONS, orbCharm, onSelectCharm)

  return (
    <div className="settings-stack">
      <SettingsCard
        title={t('settings.appearance.palette.title')}
        description={t('settings.appearance.palette.description')}
      >
        <div
          className="theme-grid theme-grid--palette"
          role="radiogroup"
          aria-label={t('settings.appearance.palette.selectLabel')}
          aria-busy={saving}
          onKeyDown={palettes.handleKeyDown}
        >
          {PALETTE_OPTIONS.map((option, index) => {
            const selected = palette === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                ref={(node) => {
                  palettes.refs.current[index] = node
                }}
                aria-checked={selected}
                tabIndex={index === palettes.selectedIndex ? 0 : -1}
                className={`theme-choice${selected ? ' theme-choice--selected' : ''}`}
                onClick={() => onSelectPalette(option)}
              >
                <ThemePreview theme={theme} palette={option} />
                <span className="theme-choice__copy">
                  <span className="theme-choice__label">
                    {t(`settings.appearance.palette.${option}.label`)}
                    <span className="theme-choice__check">
                      {selected && <Icon name="check" size={14} />}
                    </span>
                  </span>
                  <span className="theme-choice__description">
                    {t(`settings.appearance.palette.${option}.description`)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.appearance.theme.title')}
        description={t('settings.appearance.theme.description')}
      >
        <div
          className="theme-grid"
          role="radiogroup"
          aria-label={t('settings.appearance.theme.selectLabel')}
          aria-busy={saving}
          onKeyDown={modes.handleKeyDown}
        >
          {THEME_OPTIONS.map((option, index) => {
            const selected = theme === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                ref={(node) => {
                  modes.refs.current[index] = node
                }}
                aria-checked={selected}
                tabIndex={index === modes.selectedIndex ? 0 : -1}
                className={`theme-choice${selected ? ' theme-choice--selected' : ''}`}
                onClick={() => onSelect(option)}
              >
                <ThemePreview theme={option} palette={palette} />
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

      <SettingsCard
        title={t('settings.appearance.charm.title')}
        description={t('settings.appearance.charm.description')}
      >
        <div
          className="theme-grid theme-grid--charm"
          role="radiogroup"
          aria-label={t('settings.appearance.charm.selectLabel')}
          onKeyDown={charms.handleKeyDown}
        >
          {CHARM_OPTIONS.map((option, index) => {
            const selected = orbCharm === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                ref={(node) => {
                  charms.refs.current[index] = node
                }}
                aria-checked={selected}
                tabIndex={index === charms.selectedIndex ? 0 : -1}
                className={`theme-choice${selected ? ' theme-choice--selected' : ''}`}
                onClick={() => onSelectCharm(option)}
              >
                <CharmPreview id={option} />
                <span className="theme-choice__copy">
                  <span className="theme-choice__label">
                    {t(`settings.appearance.charm.${option}.label`)}
                    <span className="theme-choice__check">
                      {selected && <Icon name="check" size={14} />}
                    </span>
                  </span>
                  <span className="theme-choice__description">
                    {t(`settings.appearance.charm.${option}.description`)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
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

type ConnectionStage =
  | 'idle'
  | 'installing'
  | 'checking-install'
  | 'opening-login'
  | 'waiting-login'
  | 'error'

type ConnectionError = 'command' | 'request' | 'failed' | 'login-request' | null

function loginCommandFromMessage(message: string): string {
  const match = /직접 실행해 주세요:\s*(.+)$/u.exec(message)
  return match?.[1]?.trim() || message
}

function AgentConnector({
  provider,
  availability,
  onRefresh
}: {
  provider: AgentProvider
  availability: AgentAvailability
  onRefresh: () => void
}): JSX.Element | null {
  const t = useT()
  const [stage, setStage] = useState<ConnectionStage>('idle')
  const [error, setError] = useState<ConnectionError>(null)
  const [command, setCommand] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [loginFailure, setLoginFailure] = useState('')
  const [copied, setCopied] = useState(false)
  const installStartedRef = useRef(false)
  const installFinishedRef = useRef(false)
  const continueAfterInstallRef = useRef(false)
  const loginRequestedRef = useRef(false)

  const needsUpdate = availability.code === 'version-too-old'
  const needsInstall = !availability.installed || needsUpdate
  const needsLogin =
    availability.installed && !availability.loggedIn && !needsUpdate
  const needsConnection = needsInstall || needsLogin
  const providerName = t(
    provider === 'codex' ? 'settings.ai.codex.name' : 'settings.ai.claude.name'
  )
  const busy =
    stage === 'installing' ||
    stage === 'checking-install' ||
    stage === 'opening-login'

  const finishInstallation = useCallback(
    (ok: boolean, failure: ConnectionError = 'failed') => {
      if (installFinishedRef.current) return
      installFinishedRef.current = true
      installStartedRef.current = false
      continueAfterInstallRef.current = ok
      setStage(ok ? 'checking-install' : 'error')
      setError(ok ? null : failure)
      onRefresh()
    },
    [onRefresh]
  )

  useEffect(() => {
    if (!needsInstall) return
    let active = true
    void invoke('agent:installCommand', { provider }).then(
      (result) => {
        if (active) setCommand(result.command)
      },
      () => undefined
    )
    return () => {
      active = false
    }
  }, [needsInstall, provider])

  useEffect(() => {
    if (!needsConnection) return
    const interval = window.setInterval(onRefresh, 3_000)
    return () => window.clearInterval(interval)
  }, [needsConnection, onRefresh])

  useEffect(
    () =>
      onPush('agent:install-progress', (progress) => {
        if (progress.provider !== provider) return
        if (installStartedRef.current && progress.line !== '') {
          setLogs((current) => [...current.slice(-119), progress.line])
        }
        if (!progress.done) return
        if (installStartedRef.current) {
          finishInstallation(progress.ok)
        } else {
          onRefresh()
        }
      }),
    [finishInstallation, onRefresh, provider]
  )

  const openLogin = useCallback(() => {
    if (loginRequestedRef.current) return
    loginRequestedRef.current = true
    setStage('opening-login')
    setError(null)
    setLoginFailure('')
    setCopied(false)
    void invoke('agent:login', { provider }).then(
      (result) => {
        loginRequestedRef.current = false
        if (result.ok) {
          setStage('waiting-login')
          onRefresh()
          return
        }
        setStage('error')
        setLoginFailure(result.message)
      },
      () => {
        loginRequestedRef.current = false
        setStage('error')
        setError('login-request')
      }
    )
  }, [onRefresh, provider])

  useEffect(() => {
    if (!continueAfterInstallRef.current || needsInstall) return
    continueAfterInstallRef.current = false
    if (availability.loggedIn) {
      setStage('idle')
      return
    }
    openLogin()
  }, [availability.loggedIn, needsInstall, openLogin])

  useEffect(() => {
    if (needsConnection) return
    setStage('idle')
    setError(null)
    setLoginFailure('')
    installStartedRef.current = false
    installFinishedRef.current = false
    continueAfterInstallRef.current = false
    loginRequestedRef.current = false
  }, [needsConnection])

  const install = (): void => {
    if (busy) return
    installStartedRef.current = true
    installFinishedRef.current = false
    continueAfterInstallRef.current = false
    setLogs([])
    setError(null)
    setLoginFailure('')
    setStage('installing')

    const commandReady =
      command !== ''
        ? Promise.resolve()
        : invoke('agent:installCommand', { provider }).then((result) => {
            setCommand(result.command)
          })

    void commandReady.then(
      () =>
        invoke('agent:install', { provider }).then(
          (result) => finishInstallation(result.ok),
          () => {
            finishInstallation(false, 'request')
          }
        ),
      () => {
        installStartedRef.current = false
        setStage('error')
        setError('command')
      }
    )
  }

  const copyLoginCommand = (): void => {
    void navigator.clipboard
      .writeText(loginCommandFromMessage(loginFailure))
      .then(() => setCopied(true), () => setCopied(false))
  }

  if (!needsConnection) return null

  const errorKey =
    error === 'command'
      ? 'settings.ai.install.commandFailed'
      : error === 'request'
        ? 'settings.ai.install.requestFailed'
        : error === 'login-request'
          ? 'settings.ai.login.requestFailed'
          : 'settings.ai.install.failed'
  const actionLabel = needsUpdate
    ? stage === 'installing'
      ? t('settings.ai.action.updating')
      : stage === 'checking-install'
        ? t('settings.ai.action.checkingUpdate')
        : t('settings.ai.action.update')
    : needsInstall
      ? stage === 'installing'
        ? t('settings.ai.action.connecting')
        : stage === 'checking-install'
          ? t('settings.ai.action.checkingInstall')
          : t('settings.ai.action.connect')
      : stage === 'opening-login'
        ? t('settings.ai.action.openingLogin')
        : t('settings.ai.action.login')

  return (
    <div className="settings-ai-installer">
      <div className="settings-ai-installer__copy">
        <strong>
          {t(
            needsUpdate
              ? 'settings.ai.setup.updateTitle'
              : needsInstall
                ? 'settings.ai.setup.connectTitle'
                : 'settings.ai.setup.loginTitle',
            { provider: providerName }
          )}
        </strong>
        <span>
          {needsUpdate
            ? t('settings.ai.setup.updateHelp', {
                version: availability.version ?? t('settings.ai.unknown')
              })
            : needsInstall
              ? t('settings.ai.setup.connectHelp')
              : t('settings.ai.setup.loginHelp')}
        </span>
      </div>

      <button
        type="button"
        className="secondary-button"
        data-settings-connect-action="true"
        disabled={busy}
        onClick={needsInstall ? install : openLogin}
      >
        {actionLabel}
      </button>

      {needsInstall && command !== '' && (
        <details className="settings-ai-install-command">
          <summary>{t('settings.ai.install.commandSummary')}</summary>
          <code>{command}</code>
        </details>
      )}

      {stage === 'installing' && (
        <p className="settings-ai-install-feedback" role="status">
          {t('settings.ai.install.installing')}
        </p>
      )}

      {logs.length > 0 && (
        <pre
          className="settings-ai-install-logs"
          aria-label={t('settings.ai.install.logsLabel')}
          aria-live="polite"
        >
          {logs.join('\n')}
        </pre>
      )}

      {(stage === 'checking-install' || stage === 'waiting-login') && (
        <p
          className="settings-ai-install-feedback settings-ai-install-feedback--success"
          role="status"
        >
          {t(
            stage === 'waiting-login'
              ? 'settings.ai.login.waiting'
              : 'settings.ai.install.checkingAgain'
          )}
        </p>
      )}

      {stage === 'error' && loginFailure === '' && (
        <div className="settings-ai-install-error" role="alert">
          <span>{t(errorKey)}</span>
        </div>
      )}

      {loginFailure !== '' && (
        <div className="settings-ai-install-error" role="alert">
          <span>{loginFailure}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={copyLoginCommand}
          >
            {t(
              copied
                ? 'settings.ai.login.copied'
                : 'settings.ai.login.copyCommand'
            )}
          </button>
        </div>
      )}
    </div>
  )
}

function ProviderCard({
  provider,
  availability,
  loading,
  error,
  onRetry
}: {
  provider: AgentProvider
  availability: AgentAvailability | null
  loading: boolean
  error: string | null
  onRetry: () => void
}): JSX.Element {
  const t = useT()
  const codex = provider === 'codex'
  const installed = availability?.installed === true
  const connected =
    installed &&
    availability?.loggedIn === true &&
    availability.code !== 'version-too-old'
  const providerName = t(
    codex ? 'settings.ai.codex.name' : 'settings.ai.claude.name'
  )
  const statusLabel = loading
    ? t('settings.ai.checking')
    : error !== null
      ? t('settings.ai.checkFailed')
      : availability?.code === 'version-too-old'
        ? t('settings.ai.updateRequired')
        : connected
          ? t('settings.ai.available')
          : installed
            ? t('settings.ai.loginRequired')
            : t('settings.ai.notInstalled')

  return (
    <SettingsCard className="integration-card">
      <div
        id={`settings-ai-provider-${provider}`}
        className="integration-card__heading"
      >
        <div
          className={`provider-mark provider-mark--${codex ? 'codex' : 'claude'}`}
          aria-hidden="true"
        >
          {codex ? 'X' : 'C'}
        </div>
        <div className="integration-card__title">
          <h2>{providerName}</h2>
          <p>
            {t(
              codex
                ? 'settings.ai.codex.description'
                : 'settings.ai.claude.description'
            )}
          </p>
        </div>
        <span
          className={`status-pill status-pill--${
            loading
              ? 'loading'
              : error !== null
                ? 'muted'
                : connected
                  ? 'ready'
                  : 'muted'
          }`}
        >
          <span className="status-pill__dot" />
          {statusLabel}
        </span>
      </div>

      {loading && availability === null ? (
        <div
          className="availability-skeleton"
          aria-label={t(
            codex
              ? 'settings.ai.codex.checkingLabel'
              : 'settings.ai.claude.checkingLabel'
          )}
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
          <AgentConnector
            provider={provider}
            availability={availability}
            onRefresh={onRetry}
          />
        </>
      ) : null}
      {availability?.reason !== undefined && availability.reason !== '' && (
        <p className="settings-ai-install-feedback">{availability.reason}</p>
      )}
    </SettingsCard>
  )
}

export function DesktopPermissionsSlot(
  _props: { settings: Settings }
): JSX.Element | null {
  return null
}

export function AiPanel({
  settings,
  provider,
  providerReady,
  providerSaving,
  providerFeedback,
  providerFeedbackError,
  availability,
  loading,
  error,
  onProviderSelect,
  onRetry
}: {
  settings: Settings | null
  provider: AgentProvider
  providerReady: boolean
  providerSaving: boolean
  providerFeedback: string | null
  providerFeedbackError: boolean
  availability: Record<AgentProvider, AgentAvailability | null>
  loading: Record<AgentProvider, boolean>
  error: Record<AgentProvider, string | null>
  onProviderSelect: (provider: AgentProvider) => void
  onRetry: (provider: AgentProvider) => void
}): JSX.Element {
  const t = useT()
  const refreshClaude = useCallback(() => onRetry('claude-code'), [onRetry])
  const refreshCodex = useCallback(() => onRetry('codex'), [onRetry])

  const selectAssistantMode = (assistantMode: Settings['assistantMode']): void => {
    if (settings === null || settings.assistantMode === assistantMode) return
    void invoke('settings:set', { assistantMode }).catch(() => {
      // settings:changed is the only source of visible state.
    })
  }

  const toggleDesktopKeepAlive = (keepAliveOnClose: boolean): void => {
    if (settings === null) return
    void invoke('settings:set', {
      desktopOrb: { ...settings.desktopOrb, keepAliveOnClose }
    }).catch(() => {
      // settings:changed is the only source of visible state.
    })
  }

  return (
    <div className="settings-stack">
      <SettingsCard
        title={t('settings.ai.orb.title')}
        description={t('settings.ai.orb.description')}
      >
        <div className="settings-ai-orb">
          <div className="setting-row settings-ai-orb__mode">
            <div className="setting-row__copy">
              <div
                className="settings-ai-engine__segments"
                role="radiogroup"
                aria-label={t('settings.ai.orb.mode.selectLabel')}
              >
                {(['in-app', 'desktop'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={settings?.assistantMode === option}
                    disabled={settings === null}
                    className={`settings-ai-engine__segment${
                      settings?.assistantMode === option
                        ? ' settings-ai-engine__segment--selected'
                        : ''
                    }`}
                    onClick={() => selectAssistantMode(option)}
                  >
                    {t(`settings.ai.orb.mode.${option === 'in-app' ? 'inApp' : 'desktop'}`)}
                  </button>
                ))}
              </div>
              <span className="setting-row__description">
                {t('settings.ai.orb.mode.desktopDescription')}
              </span>
            </div>
          </div>
          <ToggleRow
            label={t('settings.ai.orb.keepAlive')}
            description={t('settings.ai.orb.keepAliveDescription')}
            checked={settings?.desktopOrb.keepAliveOnClose ?? false}
            disabled={settings?.assistantMode !== 'desktop'}
            onChange={toggleDesktopKeepAlive}
          />
          {settings !== null && <DesktopPermissionsSlot settings={settings} />}
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.ai.engine.title')}
        description={t('settings.ai.engine.description')}
      >
        <div className="settings-ai-engine">
          <div
            className="settings-ai-engine__segments"
            role="radiogroup"
            aria-label={t('settings.ai.engine.selectLabel')}
            aria-busy={providerSaving}
          >
            {(['claude-code', 'codex'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={provider === option}
                disabled={!providerReady || providerSaving}
                className={`settings-ai-engine__segment${
                  provider === option
                    ? ' settings-ai-engine__segment--selected'
                    : ''
                }`}
                onClick={() => onProviderSelect(option)}
              >
                {t(
                  option === 'codex'
                    ? 'settings.ai.codex.name'
                    : 'settings.ai.claude.name'
                )}
              </button>
            ))}
          </div>


          <p
            className={`settings-ai-engine__feedback${
              providerFeedbackError
                ? ' settings-ai-engine__feedback--error'
                : ''
            }`}
            aria-live="polite"
          >
            {providerFeedback ?? ''}
          </p>
        </div>
      </SettingsCard>

      <ProviderCard
        provider="claude-code"
        availability={availability['claude-code']}
        loading={loading['claude-code']}
        error={error['claude-code']}
        onRetry={refreshClaude}
      />

      <ProviderCard
        provider="codex"
        availability={availability.codex}
        loading={loading.codex}
        error={error.codex}
        onRetry={refreshCodex}
      />
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
          className="settings-course-list"
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
            <div className="settings-empty-state">
              <div className="settings-empty-state__icon">
                <Icon name="courses" />
              </div>
              <strong>{t('settings.courses.loadFailed')}</strong>
              <span>{t('settings.courses.loadFailedHelp')}</span>
              <button type="button" className="secondary-button" onClick={onRetry}>
                {t('settings.courses.reload')}
              </button>
            </div>
          ) : courses.length === 0 ? (
            <div className="settings-empty-state">
              <div className="settings-empty-state__icon">
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
