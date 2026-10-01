import { useCallback, useEffect, useRef, useState } from 'react'
import { BandalMark } from '../../components/BandalMark'
import { ProviderMark } from '../../components/ProviderMark'
import { LOCALES, setLocale, useLocale, useT } from '../../i18n'
import type { Locale } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { useUpdateStore } from '../../stores/updateStore'
import {
  AGENT_PROVIDERS,
  type AgentAvailability,
  type AgentProvider
} from '../../../../shared/types/agent-events'
import type { Course } from '../../../../shared/types/course'
import type { Settings } from '../../../../shared/types/settings'
import { reopenedOnboarding } from '../onboarding/onboardingModel'
import { SettingsCard, ToggleRow } from './primitives'
import { Icon } from './SettingsIcon'
import { savePreference } from './savePreference'

export { AppearancePanel } from './AppearancePanel'
export { McpServersPanel } from './McpServersPanel'

export function GeneralPanel({ settings }: { settings: Settings | null }): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [onboardingReset, setOnboardingReset] = useState<
    'idle' | 'done' | 'failed'
  >('idle')
  const [tutorialReset, setTutorialReset] = useState<
    'idle' | 'done' | 'failed'
  >('idle')
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

  return (
    <div className="settings-stack">
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
            <span className="setting-row__description">
              {t('settings.general.locale.scope')}
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
            disabled={settings === null}
            onChange={(openAdjacentTab) => {
              void savePreference({ openAdjacentTab })
            }}
          />
          <ToggleRow
            label={t('settings.general.tabs.restore')}
            description={t('settings.general.tabs.restoreDescription')}
            checked={settings?.restoreLastCourse ?? false}
            disabled={settings === null}
            onChange={(restoreLastCourse) => {
              void savePreference({ restoreLastCourse })
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

function ProviderAccountRow({
  availability,
  providerName,
  busy,
  onReauthenticate
}: {
  availability: AgentAvailability
  providerName: string
  busy: boolean
  onReauthenticate: () => void
}): JSX.Element {
  const t = useT()

  return (
    <div className="settings-ai-account">
      <div className="settings-ai-account__copy">
        <strong>{t('settings.ai.account.systemDefault')}</strong>
        <span>
          {t('settings.ai.account.deviceLogin', { provider: providerName })}
        </span>
        {availability.accountEmail !== undefined &&
          availability.accountEmail !== '' && (
          <div className="settings-ai-account__identity">
            <span
              className="settings-ai-account__email"
              title={availability.accountEmail}
            >
              {availability.accountEmail}
            </span>
            <span className="settings-ai-account__badge">
              {t('settings.ai.account.thisDevice')}
            </span>
            <span className="status-pill status-pill--ready">
              <span className="status-pill__dot" />
              {t('settings.ai.account.signedIn')}
            </span>
          </div>
        )}
      </div>
      {availability.loggedIn && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onReauthenticate}
        >
          {t('settings.ai.account.reauthenticate')}
        </button>
      )}
    </div>
  )
}

interface GeminiApiKeyStatus {
  configured: boolean
  hint: string | null
  storageAvailable: boolean
}

function GeminiApiKeyRow({ onRefresh }: { onRefresh: () => void }): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<GeminiApiKeyStatus | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void invoke('agent:geminiApiKey', {}).then(
      (result) => {
        if (active) setStatus(result)
      },
      () => {
        if (active) setErrorKey('settings.ai.apiKey.loadFailed')
      }
    )
    return () => {
      active = false
    }
  }, [])

  const persist = (nextKey: string | null): void => {
    if (saving || status?.storageAvailable !== true) return
    setSaving(true)
    setErrorKey(null)
    void invoke('agent:setGeminiApiKey', { key: nextKey }).then(
      (result) => {
        setStatus({ ...result, storageAvailable: true })
        setKey('')
        setSaving(false)
        onRefresh()
      },
      () => {
        setSaving(false)
        setErrorKey('settings.ai.apiKey.saveFailed')
      }
    )
  }

  const storageAvailable = status?.storageAvailable === true
  const configured = status?.configured === true
  const configuredLabel =
    status?.hint === null || status?.hint === undefined
      ? t('settings.ai.apiKey.configuredNoHint')
      : t('settings.ai.apiKey.configured', { hint: status.hint })

  return (
    <form
      className="settings-ai-api-key"
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = key.trim()
        if (trimmed !== '') persist(trimmed)
      }}
    >
      <div className="setting-row">
        <div className="setting-row__copy">
          <span className="setting-row__label">{t('settings.ai.apiKey.label')}</span>
          <span className="setting-row__description">
            {t('settings.ai.apiKey.description')}{' '}
            <button
              type="button"
              className="settings-ai-api-key__link"
              onClick={() => {
                void invoke('shell:openExternal', {
                  url: 'https://aistudio.google.com/apikey'
                }).catch(() => setErrorKey('settings.ai.apiKey.openFailed'))
              }}
            >
              {t('settings.ai.apiKey.create')}
            </button>
          </span>
          {status?.storageAvailable === false && (
            <span className="setting-row__description">
              {t('settings.ai.apiKey.storageUnavailable')}
            </span>
          )}
        </div>
        <div className="settings-ai-api-key__actions">
          {configured ? (
            <>
              <span className="status-pill status-pill--ready">
                <span className="status-pill__dot" />
                {configuredLabel}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={saving || !storageAvailable}
                onClick={() => persist(null)}
              >
                {t('settings.ai.apiKey.remove')}
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                className="language-select settings-ai-api-key__input"
                value={key}
                autoComplete="off"
                aria-label={t('settings.ai.apiKey.inputLabel')}
                placeholder={t('settings.ai.apiKey.placeholder')}
                disabled={!storageAvailable || saving}
                onChange={(event) => setKey(event.target.value)}
              />
              <button
                type="submit"
                className="secondary-button"
                disabled={!storageAvailable || saving || key.trim() === ''}
              >
                {t('settings.ai.apiKey.save')}
              </button>
            </>
          )}
        </div>
      </div>
      {errorKey !== null && (
        <p className="settings-ai-api-key__error" role="alert">
          {t(errorKey)}
        </p>
      )}
    </form>
  )
}

function AgentConnector({
  provider,
  availability,
  selectedProvider,
  selectedAvailability,
  onRefresh
}: {
  provider: AgentProvider
  availability: AgentAvailability
  selectedProvider: AgentProvider
  selectedAvailability: AgentAvailability | null
  onRefresh: () => void
}): JSX.Element | null {
  const t = useT()
  const [stage, setStage] = useState<ConnectionStage>('idle')
  const [error, setError] = useState<ConnectionError>(null)
  const [command, setCommand] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [loginFailure, setLoginFailure] = useState('')
  const [copied, setCopied] = useState(false)
  const [installCommandCopied, setInstallCommandCopied] = useState(false)
  const logsRef = useRef<HTMLPreElement>(null)
  const installStartedRef = useRef(false)
  const installFinishedRef = useRef(false)
  const continueAfterInstallRef = useRef(false)
  const loginRequestedRef = useRef(false)
  const wasLoggedInRef = useRef(availability.loggedIn)

  const needsUpdate = availability.code === 'version-too-old'
  const needsInstall = !availability.installed || needsUpdate
  const needsLogin =
    availability.installed && !availability.loggedIn && !needsUpdate
  const needsConnection = needsInstall || needsLogin
  const providerKey = provider === 'claude-code' ? 'claude' : provider
  const providerName = t(`settings.ai.${providerKey}.name`)
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

  useEffect(() => {
    if (logsRef.current !== null) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [logs])

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
          setStage(needsConnection ? 'waiting-login' : 'idle')
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
  }, [needsConnection, onRefresh, provider])

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
    const becameConnected = !wasLoggedInRef.current && availability.loggedIn
    wasLoggedInRef.current = availability.loggedIn
    const selectedConnected =
      selectedAvailability?.installed === true && selectedAvailability.loggedIn
    if (!becameConnected || provider === selectedProvider || selectedConnected) return
    void invoke('settings:set', { agentProvider: provider }).catch(() => undefined)
  }, [
    availability.loggedIn,
    provider,
    selectedAvailability,
    selectedProvider
  ])

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
    setInstallCommandCopied(false)
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

  const copyInstallCommand = (): void => {
    const pendingCommand =
      command === ''
        ? invoke('agent:installCommand', { provider }).then((result) => {
            setCommand(result.command)
            return result.command
          })
        : Promise.resolve(command)

    void pendingCommand.then(
      (nextCommand) =>
        navigator.clipboard
          .writeText(nextCommand)
          .then(
            () => setInstallCommandCopied(true),
            () => setInstallCommandCopied(false)
          ),
      () => setInstallCommandCopied(false)
    )
  }

  const accountRow = (
    <ProviderAccountRow
      availability={availability}
      providerName={providerName}
      busy={busy}
      onReauthenticate={openLogin}
    />
  )
  const apiKeyRow =
    provider === 'gemini' ? <GeminiApiKeyRow onRefresh={onRefresh} /> : null

  const errorKey =
    error === 'command'
      ? 'settings.ai.install.commandFailed'
      : error === 'request'
        ? 'settings.ai.install.requestFailed'
        : error === 'login-request'
          ? 'settings.ai.login.requestFailed'
          : 'settings.ai.install.failed'

  if (!needsConnection) {
    return (
      <>
        {accountRow}
        {apiKeyRow}
        {stage === 'error' && (
          <div className="settings-ai-install-error" role="alert">
            <span>{loginFailure || t(errorKey)}</span>
            {loginFailure !== '' && (
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
            )}
          </div>
        )}
      </>
    )
  }

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
    <>
      {accountRow}
      {apiKeyRow}
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
          <button
            type="button"
            className="settings-ai-install-command-copy"
            onClick={copyInstallCommand}
          >
            {t(
              installCommandCopied
                ? 'settings.ai.login.copied'
                : 'settings.ai.account.copyCommand'
            )}
          </button>
        )}

        {stage === 'installing' && (
          <p className="settings-ai-install-feedback" role="status">
            {t('settings.ai.install.installing')}
          </p>
        )}

        {(stage === 'installing' || logs.length > 0) && (
          <pre
            ref={logsRef}
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
    </>
  )
}

function ProviderCard({
  provider,
  availability,
  selectedProvider,
  selectedAvailability,
  loading,
  error,
  onRetry
}: {
  provider: AgentProvider
  availability: AgentAvailability | null
  selectedProvider: AgentProvider
  selectedAvailability: AgentAvailability | null
  loading: boolean
  error: string | null
  onRetry: () => void
}): JSX.Element {
  const t = useT()
  const providerKey = provider === 'claude-code' ? 'claude' : provider
  const installed = availability?.installed === true
  const connected =
    installed &&
    availability?.loggedIn === true &&
    availability.code !== 'version-too-old'
  const providerName = t(`settings.ai.${providerKey}.name`)
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
        <ProviderMark provider={provider} size={32} />
        <div className="integration-card__title">
          <h2>{providerName}</h2>
          <p>{t(`settings.ai.${providerKey}.description`)}</p>
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
          aria-label={t(`settings.ai.${providerKey}.checkingLabel`)}
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
            selectedProvider={selectedProvider}
            selectedAvailability={selectedAvailability}
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


export function AiPanel({
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

  return (
    <div className="settings-stack">
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
            {AGENT_PROVIDERS.map((option) => {
              const optionKey = option === 'claude-code' ? 'claude' : option
              return (
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
                  <ProviderMark provider={option} size={20} />
                  <span>{t(`settings.ai.${optionKey}.name`)}</span>
                </button>
              )
            })}
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

      {AGENT_PROVIDERS.map((option) => (
        <ProviderCard
          key={option}
          provider={option}
          availability={availability[option]}
          selectedProvider={provider}
          selectedAvailability={availability[provider]}
          loading={loading[option]}
          error={error[option]}
          onRetry={() => onRetry(option)}
        />
      ))}
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
  const status = useUpdateStore((state) => state.status)
  const init = useUpdateStore((state) => state.init)

  useEffect(() => {
    init()
  }, [init])

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
            {t('settings.about.version', {
              version: status?.currentVersion ?? '—'
            })}
          </span>
        </div>
      </SettingsCard>
      <UpdateCard />
      <p className="about-footer">{t('settings.about.footer')}</p>
    </div>
  )
}
