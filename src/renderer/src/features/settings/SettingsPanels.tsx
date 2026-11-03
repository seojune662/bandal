import { useEffect, useState } from 'react'
import { ProviderMark } from '../../components/ProviderMark'
import { Badge, type BadgeVariant } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { useT } from '../../i18n'
import type { MessageKey } from '../../i18n/messages/ko-KR'
import { invoke } from '../../lib/ipc'
import { isAgentConnectionBusy, isAgentConnectionReady, refreshAgentConnectionAfterMutation, seedAgentAvailability, startAgentLogin, useAgentConnectionStore } from '../chat/agentConnectionStore'
import { AgentConnectionControls } from '../chat/AgentConnectionControls'
import {
  AGENT_PROVIDERS,
  type AgentAvailability,
  type AgentProvider
} from '../../../../shared/types/agent-events'
import { SettingsGroup, SettingsRow, SettingsSegmentedRow, SettingsStack } from './kit/SettingsKit'

export { AppearancePanel } from './AppearancePanel'
export { GeneralPanel } from './general/GeneralPanel'
export { CoursesPanel } from './courses/CoursesPanel'
export { AboutPanel } from './about/AboutPanel'

type ProviderKey = 'claude' | 'codex' | 'gemini'

function providerKey(provider: AgentProvider): ProviderKey {
  return provider === 'claude-code' ? 'claude' : provider
}

function AvailabilityList({ availability }: { availability: AgentAvailability }): JSX.Element {
  const t = useT()
  const items: [MessageKey, string][] = [
    ['settings.ai.install', t(availability.installed ? 'settings.ai.installed' : 'settings.ai.notInstalled')],
    ['settings.ai.version', availability.version ?? t('settings.ai.unknown')],
    [
      'settings.ai.login',
      availability.installed
        ? t(availability.loggedIn ? 'settings.ai.connected' : 'settings.ai.loginRequired')
        : '—'
    ],
    ['settings.ai.subscription', availability.subscriptionType ?? t('settings.ai.unknown')]
  ]
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{t(label)}</dt>
          <dd className="min-w-0 text-foreground select-text [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  )
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
  const email = availability.accountEmail
  return (
    <SettingsRow
      label={t('settings.ai.account.systemDefault')}
      description={t('settings.ai.account.deviceLogin', { provider: providerName })}
      {...(availability.loggedIn
        ? {
            control: (
              <Button variant="secondary" size="sm" disabled={busy} onClick={onReauthenticate}>
                {t('settings.ai.account.reauthenticate')}
              </Button>
            )
          }
        : {})}
      {...(email !== undefined && email !== ''
        ? {
            footer: (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-xs text-foreground select-text" title={email}>
                  {email}
                </span>
                <Badge variant="outline">{t('settings.ai.account.thisDevice')}</Badge>
                <Badge variant="success">{t('settings.ai.account.signedIn')}</Badge>
              </div>
            )
          }
        : {})}
    />
  )
}

interface GeminiApiKeyStatus {
  configured: boolean
  hint: string | null
  storageAvailable: boolean
}

/**
 * A secret, so unlike SettingsTextRow it never autosaves on blur: the key is
 * stored only on an explicit submit (Enter or Save) and cleared with Remove.
 */
function GeminiApiKeyRow({ onRefresh }: { onRefresh: () => void }): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<GeminiApiKeyStatus | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null)

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
        void refreshAgentConnectionAfterMutation('gemini')
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
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = key.trim()
        if (trimmed !== '') persist(trimmed)
      }}
    >
      <SettingsRow
        searchId="ai.gemini.apiKey"
        description={
          <>
            {t('settings.ai.apiKey.description')}{' '}
            <button
              type="button"
              className="font-medium text-foreground [text-decoration-line:underline] underline-offset-2 hover:text-primary"
              onClick={() => {
                void invoke('shell:openExternal', {
                  url: 'https://aistudio.google.com/apikey'
                }).catch(() => setErrorKey('settings.ai.apiKey.openFailed'))
              }}
            >
              {t('settings.ai.apiKey.create')}
            </button>
          </>
        }
        disabled={status?.storageAvailable === false}
        disabledReason={t('settings.ai.apiKey.storageUnavailable')}
        control={
          configured ? (
            <>
              <Badge variant="success">{configuredLabel}</Badge>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving || !storageAvailable}
                onClick={() => persist(null)}
              >
                {t('settings.ai.apiKey.remove')}
              </Button>
            </>
          ) : (
            <>
              <Input
                type="password"
                className="w-52"
                value={key}
                autoComplete="off"
                spellCheck={false}
                aria-label={t('settings.ai.apiKey.inputLabel')}
                aria-invalid={errorKey === 'settings.ai.apiKey.saveFailed' || undefined}
                placeholder={t('settings.ai.apiKey.placeholder')}
                disabled={!storageAvailable || saving}
                onChange={(event) => setKey(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!storageAvailable || saving || key.trim() === ''}
              >
                {t('settings.ai.apiKey.save')}
              </Button>
            </>
          )
        }
        {...(errorKey !== null
          ? {
              footer: (
                <p role="alert" className="text-xs text-destructive">
                  {t(errorKey)}
                </p>
              )
            }
          : {})}
      />
    </form>
  )
}

function AgentConnector({
  provider,
  availability,
  onRefresh
}: {
  provider: AgentProvider
  availability: AgentAvailability
  onRefresh: () => void
}): JSX.Element {
  const t = useT()
  const connection = useAgentConnectionStore(state => state.connections[provider])
  const current = connection.availability ?? availability
  const providerName = t(`settings.ai.${providerKey(provider)}.name`)
  useEffect(() => { seedAgentAvailability(provider, availability) }, [provider, availability])
  return <>
    {isAgentConnectionReady(current) && <ProviderAccountRow availability={current} providerName={providerName} busy={isAgentConnectionBusy(connection.stage)} onReauthenticate={() => { void startAgentLogin(provider) }} />}
    <div className="px-4 py-3.5">
      <AgentConnectionControls provider={provider} availability={availability} />
    </div>
    {provider === 'gemini' && <GeminiApiKeyRow onRefresh={onRefresh} />}
  </>
}

interface ProviderCardProps {
  provider: AgentProvider
  availability: AgentAvailability | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

function ProviderCard({
  searchId,
  provider,
  availability,
  loading,
  error,
  onRetry
}: ProviderCardProps & { searchId: string }): JSX.Element {
  const t = useT()
  const key = providerKey(provider)
  const installed = availability?.installed === true
  const connected = isAgentConnectionReady(availability)
  const providerName = t(`settings.ai.${key}.name`)
  const [statusKey, statusVariant]: [MessageKey, BadgeVariant] = loading
    ? ['settings.ai.checking', 'info']
    : error !== null
      ? ['settings.ai.checkFailed', 'destructive']
      : availability?.code === 'version-too-old'
        ? ['settings.ai.updateRequired', 'warning']
        : connected
          ? ['settings.ai.available', 'success']
          : installed
            ? ['settings.ai.loginRequired', 'warning']
            : ['settings.ai.notInstalled', 'default']

  return (
    <SettingsGroup
      searchId={searchId}
      title={
        <span id={`settings-ai-provider-${provider}`} className="inline-flex items-center gap-2">
          <ProviderMark provider={provider} size={24} />
          {providerName}
        </span>
      }
      action={<Badge variant={statusVariant}>{t(statusKey)}</Badge>}
    >
      {availability === null && (loading || error === null) ? (
        <div
          role="status"
          aria-label={t(`settings.ai.${key}.checkingLabel`)}
          className="space-y-2 px-4 py-4"
        >
          <span className="block h-3 w-2/5 animate-pulse rounded-sm bg-muted" />
          <span className="block h-3 w-3/5 animate-pulse rounded-sm bg-muted" />
          <span className="block h-3 w-1/3 animate-pulse rounded-sm bg-muted" />
        </div>
      ) : error !== null ? (
        <SettingsRow
          label={t('settings.ai.connectionFailed')}
          description={t('settings.ai.tryAgainLater')}
          control={
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('settings.ai.retry')}
            </Button>
          }
        />
      ) : availability !== null ? (
        <>
          <AgentConnector provider={provider} availability={availability} onRefresh={onRetry} />
          <details className="px-4 py-3">
            <summary className="cursor-pointer text-xs font-medium text-secondary-foreground select-none hover:text-foreground">
              {t('settings.ai.connectionDetails')}
            </summary>
            <AvailabilityList availability={availability} />
          </details>
        </>
      ) : null}
    </SettingsGroup>
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
  const card = (option: AgentProvider): ProviderCardProps => ({
    provider: option,
    availability: availability[option],
    loading: loading[option],
    error: error[option],
    onRetry: () => onRetry(option)
  })
  // Literal searchIds (the catalog test scans for them), in AGENT_PROVIDERS order.
  const cards: Record<AgentProvider, JSX.Element> = {
    'claude-code': <ProviderCard key="claude-code" searchId="ai.claude" {...card('claude-code')} />,
    codex: <ProviderCard key="codex" searchId="ai.codex" {...card('codex')} />,
    gemini: <ProviderCard key="gemini" searchId="ai.gemini" {...card('gemini')} />
  }

  return (
    <SettingsStack>
      <SettingsGroup searchId="ai.engine">
        <SettingsSegmentedRow
          searchId="ai.engine.provider"
          value={provider}
          options={AGENT_PROVIDERS.map(option => ({
            value: option,
            label: (
              <>
                <ProviderMark provider={option} size={16} />
                {t(`settings.ai.${providerKey(option)}.name`)}
              </>
            )
          }))}
          onChange={onProviderSelect}
          disabled={!providerReady || providerSaving}
          {...(!providerReady ? { disabledReason: t('settings.ai.engine.loading') } : {})}
          {...(providerFeedback !== null && providerFeedback !== ''
            ? {
                footer: (
                  <p
                    role={providerFeedbackError ? 'alert' : 'status'}
                    className={providerFeedbackError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
                  >
                    {providerFeedback}
                  </p>
                )
              }
            : {})}
        />
      </SettingsGroup>

      {AGENT_PROVIDERS.map(option => cards[option])}
    </SettingsStack>
  )
}
