import { useEffect, useId, useState, type ReactNode } from 'react'
import type {
  MarketplaceDashboard,
  MarketplaceRelease,
} from '../../../../shared/types/marketplace'
import { Button } from '../../components/ui/button'
import { useConfirm } from '../../components/ui/confirm-dialog-context'
import { Input, Textarea } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { useLocale, useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { useUiStore } from '../../stores/uiStore'
import { describePermission } from '../../../../shared/plugins/permissions'
import { SettingsEmptyState, SettingsGroup, SettingsNotice } from './kit/SettingsKit'

const CARD = 'space-y-3 rounded-lg border border-border bg-card/60 px-4 py-4'

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }): JSX.Element {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  )
}

export function MarketplacePanel(): JSX.Element {
  const locale = useLocale()
  const t = useT()
  const confirm = useConfirm()
  const [dashboard, setDashboard] = useState<MarketplaceDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<MarketplaceRelease | null>(null)
  const [reason, setReason] = useState('')
  const [changelog, setChangelog] = useState('')
  useEffect(() => {
    let active = true
    setError(null)
    void invoke('marketplace:dashboard', {})
      .then((result) => {
        if (active) {
          setDashboard(result)
          setSelected(null)
        }
      })
      .catch((failure: unknown) => {
        if (active)
          setError(failure instanceof Error ? failure.message : String(failure))
      })
    const stop = onPush('auth:changed', () => {
      setDashboard(null)
      setSelected(null)
      setAttempt((n) => n + 1)
    })
    return () => {
      active = false
      stop()
    }
  }, [attempt])
  async function perform(action: () => Promise<unknown>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      setAttempt((n) => n + 1)
      setReason('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  const status = (value: MarketplaceRelease['status']): string => t(`settings.marketplace.status.${value}`)

  return (
    <SettingsGroup
      bare
      title={t('settings.marketplace.title')}
      description={t('settings.marketplace.description')}
      action={
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAttempt((n) => n + 1)}>
          {t('settings.catalog.refresh')}
        </Button>
      }
    >
      <div className="marketplace-panel space-y-4" aria-busy={busy}>
        {error && <SettingsNotice tone="danger">{error}</SettingsNotice>}
        {!dashboard && !error && <p role="status" className="text-xs text-muted-foreground">{t('settings.marketplace.loading')}</p>}
        {dashboard && !dashboard.configured && <SettingsNotice>{t('settings.marketplace.notConfigured')}</SettingsNotice>}
        {dashboard?.configured && !dashboard.signedIn && (
          <SettingsNotice
            action={
              <Button variant="secondary" size="xs" onClick={() => useUiStore.getState().openSettings('account')}>
                {t('settings.marketplace.openAccount')}
              </Button>
            }
          >
            {t('settings.marketplace.signIn')}
          </SettingsNotice>
        )}
        {dashboard?.signedIn && (
          <>
            {!dashboard.publisher ? (
              <form
                className={cn('marketplace-form', CARD)}
                onSubmit={(event) => {
                  event.preventDefault()
                  const data = new FormData(event.currentTarget)
                  void perform(() =>
                    invoke('marketplace:register', {
                      id: String(data.get('id')),
                      displayName: String(data.get('name')),
                    }),
                  )
                }}
              >
                <h3 className="text-sm font-medium text-foreground">{t('settings.marketplace.register.title')}</h3>
                <Field label={t('settings.marketplace.register.id')}>
                  {(id) => <Input id={id} name="id" required pattern="[a-z0-9][a-z0-9-]*" maxLength={63} disabled={busy} placeholder="your-name" spellCheck={false} />}
                </Field>
                <Field label={t('settings.marketplace.register.name')}>
                  {(id) => <Input id={id} name="name" required maxLength={80} disabled={busy} />}
                </Field>
                <Button type="submit" variant="secondary" size="sm" disabled={busy}>{t('settings.marketplace.register.submit')}</Button>
              </form>
            ) : (
              <form
                className={cn('marketplace-form', CARD)}
                onSubmit={(event) => {
                  event.preventDefault()
                  void perform(() => invoke('marketplace:submit', { changelog }))
                }}
              >
                <h3 className="text-sm font-medium text-foreground">{dashboard.publisher.display_name}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('settings.marketplace.namespace')}: <code>{dashboard.publisher.id}.</code>
                </p>
                <Field label={t('settings.marketplace.changelog')}>
                  {(id) => <Textarea id={id} value={changelog} maxLength={10000} onChange={(event) => setChangelog(event.currentTarget.value)} disabled={busy} />}
                </Field>
                <Button type="submit" size="sm" disabled={busy}>{t('settings.marketplace.submit')}</Button>
                <p className="text-xs leading-relaxed text-muted-foreground">{t('settings.marketplace.submitNote')}</p>
              </form>
            )}
            <section className={cn('marketplace-releases', CARD)}>
              <h3 className="text-sm font-medium text-foreground">
                {t(dashboard.reviewer ? 'settings.marketplace.releases.reviewer' : 'settings.marketplace.releases.mine')}
              </h3>
              {dashboard.releases.length === 0 && <SettingsEmptyState title={t('settings.marketplace.releases.empty')} className="py-5" />}
              <div className="grid gap-1">
                {dashboard.releases.map((release) => (
                  <button
                    type="button"
                    className="marketplace-release flex items-center gap-3 rounded-md px-3 py-2 text-start text-sm transition-colors hover:bg-accent aria-pressed:bg-selected"
                    key={release.id}
                    aria-pressed={selected?.id === release.id}
                    onClick={() => {
                      setSelected(release)
                      setReason('')
                    }}
                  >
                    <strong className="min-w-0 flex-1 truncate font-medium text-foreground">{release.manifest.name}</strong>
                    <span className="text-xs text-muted-foreground">{release.version}</span>
                    <span className="text-xs text-muted-foreground">{status(release.status)}</span>
                  </button>
                ))}
              </div>
            </section>
            {dashboard.reviewer && (
              <section className={cn('marketplace-releases', CARD)}>
                <h3 className="text-sm font-medium text-foreground">{t('settings.marketplace.reports.title')}</h3>
                {!dashboard.reports?.length && <SettingsEmptyState title={t('settings.marketplace.reports.empty')} className="py-5" />}
                {dashboard.reports?.map((report) => (
                  <form
                    key={report.id}
                    className="marketplace-form space-y-3 border-t border-border pt-3 first-of-type:border-t-0 first-of-type:pt-0"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const resolution = String(
                        new FormData(event.currentTarget).get('resolution') ?? '',
                      ).trim()
                      if (resolution)
                        void perform(() =>
                          invoke('marketplace:resolveReport', {
                            id: report.id,
                            reason: resolution,
                          }),
                        )
                    }}
                  >
                    <p className="text-sm text-foreground select-text">{report.reason}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void invoke('marketplace:release', {
                          id: report.release_id,
                        })
                          .then(setSelected)
                          .catch((failure: unknown) =>
                            setError(
                              failure instanceof Error
                                ? failure.message
                                : String(failure),
                            ),
                          )
                      }
                    >
                      {t('settings.marketplace.reports.inspect')}
                    </Button>
                    <Field label={t('settings.marketplace.reports.resolution')}>
                      {(id) => <Textarea id={id} name="resolution" required maxLength={2000} disabled={busy} />}
                    </Field>
                    <Button type="submit" variant="secondary" size="sm" disabled={busy}>{t('settings.marketplace.reports.resolve')}</Button>
                  </form>
                ))}
              </section>
            )}
            {selected && (
              <article className={cn('marketplace-form', CARD)}>
                <h3 className="text-sm font-medium text-foreground">
                  {selected.manifest.name} · {selected.version}
                </h3>
                <p className="text-xs text-muted-foreground select-text">{selected.manifest.description}</p>
                <pre className="marketplace-release-notes max-h-60 overflow-auto rounded-md bg-secondary/60 p-3 font-mono text-2xs whitespace-pre-wrap select-text">
                  {selected.changelog}
                </pre>
                <ul className="list-disc space-y-0.5 ps-5 text-xs text-secondary-foreground">
                  {selected.manifest.permissions.map((permission) => (
                    <li key={permission}>
                      {describePermission(permission, locale)}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {status(selected.status)} {selected.review_reason}
                </p>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">{t('settings.marketplace.integrity')}</summary>
                  <pre className="mt-2 max-h-60 overflow-auto font-mono text-2xs whitespace-pre-wrap select-text">{JSON.stringify(selected.manifest, null, 2)}</pre>
                  <code className="block [overflow-wrap:anywhere]">{selected.sha256}</code>
                </details>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      invoke('marketplace:reviewBundle', { id: selected.id }),
                    )
                  }
                >
                  {t('settings.marketplace.saveZip')}
                </Button>
                {dashboard.reviewer &&
                  ['pending', 'approved'].includes(selected.status) && (
                    <>
                      <Field label={t('settings.marketplace.reviewReason')}>
                        {(id) => <Textarea id={id} maxLength={2000} value={reason} onChange={(event) => setReason(event.currentTarget.value)} />}
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        {(selected.status === 'pending'
                          ? (['approved', 'rejected'] as const)
                          : (['withdrawn'] as const)
                        ).map((decision) => (
                          <Button
                            key={decision}
                            type="button"
                            variant={decision === 'approved' ? 'secondary' : 'destructive-outline'}
                            size="sm"
                            disabled={busy || !reason.trim()}
                            onClick={() => {
                              void confirm({
                                title: t('settings.marketplace.decisionConfirm', { status: status(decision) }),
                                confirmLabel: status(decision),
                                ...(decision === 'approved' ? {} : { confirmVariant: 'destructive' as const }),
                              }).then((ok) => {
                                if (!ok) return
                                void perform(() =>
                                  invoke('marketplace:review', {
                                    id: selected.id,
                                    decision,
                                    reason,
                                  }),
                                )
                              })
                            }}
                          >
                            {status(decision)}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
              </article>
            )}
          </>
        )}
      </div>
    </SettingsGroup>
  )
}
