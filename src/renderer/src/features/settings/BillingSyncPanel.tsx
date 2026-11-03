import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { BillingState, RuntimeSyncState, RuntimeSyncConflict, SyncConflictVersion } from '../../../../shared/types/subscription'
import { Button } from '../../components/ui/button'
import { useConfirm } from '../../components/ui/confirm-dialog-context'
import { useT } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { SettingsGroup, SettingsNotice, SettingsRow, SettingsSwitchRow } from './kit/SettingsKit'

type Translate = ReturnType<typeof useT>

const REASON_KEY: Record<string, string> = {
  subscription_required: 'settings.account.billing.reason.subscription', sync_subscription_required: 'settings.account.billing.reason.subscription',
  quota_exceeded: 'settings.account.billing.reason.quota', sync_quota_exceeded: 'settings.account.billing.reason.quota',
  authentication_required: 'settings.account.billing.reason.auth', auth_required: 'settings.account.billing.reason.auth',
  permission_denied: 'settings.account.billing.reason.permission',
  network: 'settings.account.billing.reason.network'
}
const gib = (bytes: number | undefined): string => `${((bytes ?? 0) / 1073741824).toFixed(2)} GiB`
const validBilling = (value: BillingState): boolean => Boolean(value?.subscription && Array.isArray(value.subscription.sources) && value.sync)
const dateLabel = (value?: string): string | null => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : null
const copy = 'text-xs leading-relaxed text-muted-foreground select-text'

function ConflictVersion({ name, version }: { name: string; version: SyncConflictVersion }): JSX.Element {
  const t = useT()
  const updated = dateLabel(version.updatedAt)
  const summary = [
    !version.exists ? t('settings.account.billing.version.none') : version.deleted ? t('settings.account.billing.version.deleted') : t('settings.account.billing.version.kept'),
    ...(version.page !== undefined ? [t('settings.account.billing.version.page', { page: version.page })] : []),
    ...(version.objects !== undefined ? [t('settings.account.billing.version.objects', { count: version.objects })] : [])
  ].join(' · ')
  return (
    <div className="min-w-0 space-y-1 rounded-md border border-border bg-background p-3">
      <strong className="text-xs font-medium text-foreground">{name}</strong>
      <p className={copy}>{summary}</p>
      {version.title && <p className={copy}>{version.title}</p>}
      {updated && <p className={copy}>{t('settings.account.billing.version.updatedAt', { date: updated })}</p>}
      {version.text && <p className="text-xs whitespace-pre-wrap text-foreground [overflow-wrap:anywhere] select-text">{version.text}</p>}
    </div>
  )
}

function Block({ children }: { children: ReactNode }): JSX.Element {
  return <div className="space-y-2 px-4 py-3.5">{children}</div>
}

const conflictCopy = (t: Translate, conflict: RuntimeSyncConflict, choice: 'local' | 'remote'): { action: string; explanation: string } => {
  const suffix = `${conflict.kind === 'pending-ink' ? 'ink' : 'copy'}${choice === 'local' ? 'Local' : 'Remote'}`
  return { action: t(`settings.account.billing.action.${suffix}`), explanation: t(`settings.account.billing.confirm.${suffix}`) }
}

/** Retired Supabase account sync + Paddle billing. Renders only when main enables the legacy flag. */
export function BillingSyncPanel(): JSX.Element | null {
  const t = useT()
  const confirm = useConfirm()
  const [billing, setBilling] = useState<BillingState | null>(null)
  const [sync, setSync] = useState<RuntimeSyncState | null>(null)
  const [conflicts, setConflicts] = useState<RuntimeSyncConflict[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)
  const refresh = useCallback(async () => {
    const nextSync = await invoke('runtime:syncState', {}).catch(() => null)
    if (nextSync) setSync(nextSync)
    if (nextSync?.available !== true) return
    const nextBilling = await invoke('billing:getState', {}).catch(() => null)
    if (nextBilling && validBilling(nextBilling)) setBilling(nextBilling)
    else setMessage(t('settings.account.billing.statusFailed'))
  }, [t])
  useEffect(() => {
    let active = true
    void refresh()
    const timer = window.setInterval(() => { if (active) void invoke('runtime:syncState', {}).then(setSync).catch(() => {}) }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [refresh])
  useEffect(() => {
    let active = true
    if (sync?.conflicts) void invoke('runtime:syncConflicts', {}).then(items => { if (active) setConflicts(items) }).catch(() => {
      if (active) setMessage(t('settings.account.billing.conflictsFailed'))
    })
    else setConflicts([])
    return () => { active = false }
  }, [sync])
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action(); await refresh() } catch (error) { setMessage(error instanceof Error ? error.message : t('settings.account.billing.genericError')) }
    finally { setBusy(false) }
  }
  const external = (url: string) => invoke('shell:openExternal', { url })
  const feedback = message ? <SettingsNotice>{message}</SettingsNotice> : null

  const recovery = <>
    {(sync?.conflicts ?? 0) > conflicts.length && (
      <Block><p className={copy}>{t('settings.account.billing.conflict.partial', { total: sync?.conflicts ?? 0, shown: conflicts.length })}</p></Block>
    )}
    {conflicts.map(conflict => {
      const created = dateLabel(conflict.createdAt)
      return (
        <Block key={conflict.id}>
          <strong className="text-sm font-medium text-foreground">
            {conflict.kind === 'pending-ink' ? t('settings.account.billing.conflict.pendingInk') : t('settings.account.billing.conflict.copy')}
          </strong>
          <p className="text-xs text-foreground [overflow-wrap:anywhere] select-text">{conflict.label ?? conflict.recordID ?? t('settings.account.billing.conflict.unnamed')}</p>
          {created && <p className={copy}>{t('settings.account.billing.conflict.createdAt', { date: created })}</p>}
          <p className={copy}>{conflict.message ?? conflict.reason ?? t('settings.account.billing.conflict.defaultMessage')}</p>
          {conflict.variants && (
            <div className="grid grid-cols-2 gap-2">
              <ConflictVersion name={t('settings.account.billing.conflict.local')} version={conflict.variants.local} />
              <ConflictVersion name={t('settings.account.billing.conflict.remote')} version={conflict.variants.remote} />
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {(['local', 'remote'] as const).map(choice => {
              const { action, explanation } = conflictCopy(t, conflict, choice)
              return (
                <Button
                  key={choice}
                  variant="secondary"
                  size="sm"
                  disabled={busy || (conflict.kind !== 'pending-ink' && conflict.variants?.[choice].exists === false)}
                  onClick={() => void run(async () => {
                    if (!(await confirm({
                      title: conflict.label ?? conflict.recordID ?? t('settings.account.billing.conflict.selected'),
                      description: explanation,
                      confirmLabel: action
                    }))) return
                    setSync(await invoke('runtime:syncResolveConflict', { id: conflict.id, choice }))
                  })}
                >
                  {action}
                </Button>
              )
            })}
          </div>
        </Block>
      )
    })}
  </>

  // Account sync is retired, but locally preserved ink (page restructure) must stay recoverable.
  if (sync?.available !== true) {
    if ((sync?.conflicts ?? 0) === 0) return null
    return <>
      <SettingsGroup title={t('settings.account.billing.recovery.title')} description={t('settings.account.billing.recovery.description')}>
        {recovery}
      </SettingsGroup>
      {feedback}
    </>
  }

  const subscriptionStatus = billing
    ? (billing.subscription.active ? t('settings.account.billing.subscription.active') : t('settings.account.billing.subscription.inactive'))
    : t('settings.account.billing.subscription.checking')
  const sources = billing?.subscription.sources.map((source, index) => (
    <span key={`${source.provider}:${index}`} className="block">
      {[
        source.provider === 'apple' ? 'Apple' : 'Paddle',
        source.active ? t('settings.account.billing.source.active') : source.status,
        ...(source.validUntil ? [t('settings.account.billing.source.until', { date: new Date(source.validUntil).toLocaleDateString() })] : []),
        ...(source.cancelAtPeriodEnd ? [t('settings.account.billing.source.cancelAtPeriodEnd')] : [])
      ].join(' · ')}
    </span>
  ))
  const reasonKey = sync.blockedReason ? REASON_KEY[sync.blockedReason] : undefined
  const blocked = sync.blockedReason
    ? `${reasonKey !== undefined ? t(reasonKey) : sync.message ?? sync.blockedReason} ${t('settings.account.billing.sync.kept')}`
    : null
  return <>
    <SettingsGroup title={t('settings.account.billing.subscription.title')} description={t('settings.account.billing.subscription.description')}>
      <SettingsRow
        label={subscriptionStatus}
        {...(sources !== undefined && sources.length > 0 ? { description: sources } : {})}
        control={
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => { setBilling(await invoke('billing:refresh', {})) })}>
            {t('settings.account.billing.refresh')}
          </Button>
        }
      />
      {billing?.subscription.duplicateSubscription && (
        <Block><SettingsNotice tone="warning">{t('settings.account.billing.duplicate')}</SettingsNotice></Block>
      )}
      <Block>
        <div className="flex flex-wrap gap-2">
          {billing?.provider === 'apple' && !billing.subscription.active && (['monthly', 'annual'] as const).map(plan => {
            const product = billing.products?.find(item => item.plan === plan)
            return <Button key={plan} variant="secondary" size="sm" disabled={busy || !product} onClick={() => void run(async () => {
              const result = await invoke('billing:purchase', { plan })
              setBilling(result)
              if (result.status === 'pending') setMessage(t('settings.account.billing.purchasePending'))
            })}>{`${t(`settings.account.billing.plan.${plan}`)} · ${product ? product.displayPrice : t('settings.account.billing.plan.checkingProduct')}`}</Button>
          })}
          {billing?.provider === 'apple' && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => { await invoke('billing:restore', {}); setMessage(t('settings.account.billing.restored')) })}>{t('settings.account.billing.restore')}</Button>}
          {billing?.provider === 'paddle' && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void external('https://bandal.io/billing')}>{t('settings.account.billing.managePaddle')}</Button>}
          {(billing?.provider === 'apple' || billing?.subscription.sources.some(source => source.provider === 'apple')) && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => { await invoke('billing:manageApple', {}) })}>{t('settings.account.billing.manageApple')}</Button>}
        </div>
        {billing?.provider === 'apple' && billing.subscription.sources.some(source => source.provider === 'paddle') && <p className={copy}>{t('settings.account.billing.paddleNote')}</p>}
        <p className={copy}>{t('settings.account.billing.autoRenew')}</p>
        <p className={copy}>{t('settings.account.billing.expiry')}</p>
        <div className="flex flex-wrap gap-1">
          <Button variant="link" size="xs" onClick={() => void external('https://bandal.io/terms')}>{t('settings.account.billing.terms')}</Button>
          <Button variant="link" size="xs" onClick={() => void external('https://bandal.io/privacy')}>{t('settings.account.billing.privacy')}</Button>
        </div>
      </Block>
    </SettingsGroup>
    <SettingsGroup title={t('settings.account.billing.sync.title')} description={t('settings.account.billing.sync.description')}>
      {!sync.enabled && (
        <SettingsSwitchRow
          label={t('settings.account.billing.sync.consent')}
          description={t('settings.account.billing.sync.consentDescription')}
          checked={consent}
          onChange={setConsent}
        />
      )}
      <SettingsRow
        label={t('settings.account.billing.sync.label')}
        description={<>
          <span className="block">{t('settings.account.billing.sync.status', {
            last: sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString() : t('settings.account.billing.sync.never'),
            pending: sync.pending ?? 0,
            conflicts: sync.conflicts ?? 0
          })}</span>
          <span className="block">{t('settings.account.billing.sync.storage', { used: gib(sync.storageUsedBytes ?? billing?.sync.storageUsedBytes) })}</span>
          <span className="block">{t('settings.account.billing.sync.history')}</span>
          {sync.retryAt && <span className="block">{t('settings.account.billing.sync.retryAt', { time: new Date(sync.retryAt).toLocaleTimeString() })}</span>}
        </>}
        disabled={!sync.enabled && !consent}
        disabledReason={t('settings.account.billing.sync.consentRequired')}
        control={<>
          <Button variant="secondary" size="sm" disabled={busy || (!sync.enabled && !consent)} onClick={() => void run(async () => { setSync(await invoke('runtime:syncSetEnabled', { enabled: !sync.enabled })) })}>
            {sync.enabled ? t('settings.account.billing.sync.turnOff') : t('settings.account.billing.sync.turnOn')}
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || !sync.enabled} onClick={() => void run(async () => { setSync(await invoke('runtime:syncNow', {})) })}>
            {t('settings.account.billing.sync.now')}
          </Button>
        </>}
      />
      {blocked && <Block><SettingsNotice tone="warning">{blocked}</SettingsNotice></Block>}
      {recovery}
    </SettingsGroup>
    {feedback}
  </>
}
