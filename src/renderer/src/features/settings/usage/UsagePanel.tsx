import { useEffect, useState } from 'react'
import { ChartNoAxesColumn } from 'lucide-react'

import { AGENT_PROVIDERS, type AgentProvider } from '../../../../../shared/types/agent-events'
import {
  USAGE_WINDOWS,
  type UsageByProvider,
  type UsageSummary,
  type UsageWindowDays
} from '../../../../../shared/types/usage'
import { ProviderMark } from '../../../components/ProviderMark'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { useLocale, useT } from '../../../i18n'
import { invoke } from '../../../lib/ipc'
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsNotice,
  SettingsSelectRow,
  SettingsStack
} from '../kit/SettingsKit'
import { formatDuration, formatRelative, formatTokens } from './formatUsage'

const CARD = 'rounded-lg border border-border bg-card/60'

function providerNameKey(provider: AgentProvider): string {
  if (provider === 'claude-code') return 'settings.ai.claude.name'
  if (provider === 'codex') return 'settings.ai.codex.name'
  return 'settings.ai.gemini.name'
}

function UsageLoading(): JSX.Element {
  const t = useT()
  return (
    <div className="grid grid-cols-3 gap-3" role="status" aria-label={t('settings.usage.loading')}>
      {[0, 1, 2].map(index => (
        <span key={index} className="h-20 animate-pulse rounded-lg bg-secondary" />
      ))}
    </div>
  )
}

function UsageTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={`${CARD} flex flex-col gap-2 p-4`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="text-xl font-medium text-foreground tabular-nums">{value}</strong>
    </div>
  )
}

function SummaryTiles({ summary }: { summary: UsageSummary }): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const since = summary.since === null ? null : new Date(summary.since)
  const sinceLabel =
    since !== null && Number.isFinite(since.getTime())
      ? t('settings.usage.summary.since', {
          date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(since)
        })
      : null

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3">
        <UsageTile label={t('settings.usage.summary.sessions')} value={formatTokens(summary.totals.sessions)} />
        <UsageTile label={t('settings.usage.summary.agentTime')} value={formatDuration(summary.totals.agentMs, t)} />
        <UsageTile
          label={t('settings.usage.summary.tokens')}
          value={formatTokens(summary.totals.inputTokens + summary.totals.outputTokens)}
        />
      </div>
      {sinceLabel !== null && <p className="px-1 text-right text-xs text-muted-foreground">{sinceLabel}</p>}
    </div>
  )
}

function TokenRows({ usage }: { usage: UsageByProvider }): JSX.Element {
  const t = useT()
  const rows: ReadonlyArray<[string, number]> = [
    ['settings.usage.tokens.input', usage.inputTokens],
    ['settings.usage.tokens.output', usage.outputTokens],
    ['settings.usage.tokens.cacheRead', usage.cacheReadTokens]
  ]
  return (
    <dl className="mt-4 grid gap-2 border-t border-border pt-4">
      {rows.map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-3">
          <dt className="text-xs text-secondary-foreground">{t(key)}</dt>
          <dd className="text-sm font-medium text-foreground tabular-nums">{formatTokens(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function ProviderUsageCard({
  provider,
  usage
}: {
  provider: AgentProvider
  usage: UsageByProvider | undefined
}): JSX.Element {
  const t = useT()
  const hasUsage = usage !== undefined && usage.turns > 0
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex min-w-0 items-center gap-3">
        <ProviderMark provider={provider} size={32} />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-sm font-medium text-foreground">{t(providerNameKey(provider))}</h3>
          <span className="truncate text-xs text-muted-foreground">{usage?.model ?? t('settings.usage.model.none')}</span>
        </div>
      </div>
      {!hasUsage ? (
        <Badge className="mt-4">{t('settings.usage.provider.empty')}</Badge>
      ) : (
        <>
          <TokenRows usage={usage} />
          <div className="mt-3 flex flex-wrap justify-between gap-x-3 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>
              {t('settings.usage.provider.activity', {
                sessions: usage.sessions,
                turns: usage.turns
              })}
            </span>
            {usage.lastUsedAt !== null && (
              <time dateTime={usage.lastUsedAt}>
                {t('settings.usage.provider.lastUsed', {
                  time: formatRelative(usage.lastUsedAt, Date.now(), t)
                })}
              </time>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function UsageContent({ summary }: { summary: UsageSummary }): JSX.Element {
  const t = useT()
  if (summary.totals.turns === 0 && summary.totals.sessions === 0) {
    return (
      <SettingsGroup searchId="usage.summary" bare>
        <SettingsEmptyState
          icon={<ChartNoAxesColumn />}
          title={t('settings.usage.empty.title')}
          description={t('settings.usage.empty.description')}
        />
      </SettingsGroup>
    )
  }
  return (
    <>
      <SettingsGroup searchId="usage.summary" bare>
        <SummaryTiles summary={summary} />
      </SettingsGroup>
      <SettingsGroup searchId="usage.providers" bare>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,var(--rail-right-width)),1fr))] gap-3">
          {AGENT_PROVIDERS.map(provider => (
            <ProviderUsageCard
              key={provider}
              provider={provider}
              usage={summary.byProvider.find(item => item.provider === provider)}
            />
          ))}
        </div>
      </SettingsGroup>
    </>
  )
}

export function UsagePanel(): JSX.Element {
  const t = useT()
  const [windowDays, setWindowDays] = useState<UsageWindowDays>(30)
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setFailed(false)
    void invoke('usage:summary', { windowDays })
      .then(result => {
        if (active) setSummary(result)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [retryKey, windowDays])

  return (
    <SettingsStack>
      <SettingsGroup searchId="usage.period">
        <SettingsSelectRow
          searchId="usage.period.window"
          value={String(windowDays)}
          options={USAGE_WINDOWS.map(days => ({ value: String(days), label: t(`settings.usage.window.${days}`) }))}
          onChange={next => {
            const days = USAGE_WINDOWS.find(option => String(option) === next)
            if (days !== undefined) setWindowDays(days)
          }}
        />
      </SettingsGroup>
      {loading ? (
        <UsageLoading />
      ) : failed || summary === null ? (
        <SettingsNotice
          tone="danger"
          action={
            <Button variant="secondary" size="sm" onClick={() => setRetryKey(current => current + 1)}>
              {t('settings.usage.retry')}
            </Button>
          }
        >
          {t('settings.usage.loadFailed')}
        </SettingsNotice>
      ) : (
        <UsageContent summary={summary} />
      )}
    </SettingsStack>
  )
}
