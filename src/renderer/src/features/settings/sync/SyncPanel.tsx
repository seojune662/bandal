/**
 * Settings › 동기화 (design 6.1–6.4): connect this profile to the user's
 * iCloud or Google Drive, choose what happens when both sides hold data, and
 * watch the state. Nothing here goes through Bandal's servers.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ConnectMode, ConnectPlan, ConnectPrepare, SyncProviderKind, SyncView } from '../../../../../shared/types/sync'
import { showToast } from '../../../app/toast'
import { Button } from '../../../components/ui/button'
import { Checkbox } from '../../../components/ui/checkbox'
import { useConfirm } from '../../../components/ui/confirm-dialog-context'
import { useLocale, useT, type Locale } from '../../../i18n'
import { translate } from '../../../i18n/translate'
import { invoke, onPush } from '../../../lib/ipc'
import { cn } from '../../../lib/utils'
import { SettingsEmptyState, SettingsGroup, SettingsNotice, SettingsRow, SettingsStack, SettingsTextRow } from '../kit/SettingsKit'

type Translate = ReturnType<typeof useT>

const MINUTE = 60_000
/** While another device's first upload runs (spec v2.6) or root files are still arriving, the root is checked again this often. */
const RECHECK_MS = 30_000
const DEVICE_NAME_MAX = 64
const NAME: Record<SyncProviderKind, string> = { icloud: 'iCloud', gdrive: 'Google Drive' }
const OTHER: Record<SyncProviderKind, SyncProviderKind> = { icloud: 'gdrive', gdrive: 'icloud' }
/** A storage with the account another device moved to, when it said (spec v2.7 account_hint): "Google Drive(me@example.com)". */
const storageOf = (moved: { provider: SyncProviderKind; account_hint: string | null }): string => `${NAME[moved.provider]}${moved.account_hint ? `(${moved.account_hint})` : ''}`

export function ago(at: number, now = Date.now(), locale: Locale = 'ko-KR'): string {
  const minutes = Math.floor(Math.max(0, now - at) / MINUTE)
  if (minutes < 1) return translate(locale, 'settings.sync.ago.now')
  if (minutes < 60) return translate(locale, 'settings.sync.ago.minutes', { n: minutes })
  if (minutes < 24 * 60) return translate(locale, 'settings.sync.ago.hours', { n: Math.floor(minutes / 60) })
  return translate(locale, 'settings.sync.ago.days', { n: Math.floor(minutes / (24 * 60)) })
}

function stateLine(t: Translate, locale: Locale, view: SyncView, provider: SyncProviderKind): { text: string; tone: 'ok' | 'busy' | 'warn' } {
  const { state } = view
  switch (state.state) {
    case 'synced': return { text: t('settings.sync.state.synced', { ago: ago(state.at, Date.now(), locale) }), tone: 'ok' }
    case 'syncing': return { text: t('settings.sync.state.syncing'), tone: 'busy' }
    case 'waiting': return { text: t('settings.sync.state.waiting', { storage: NAME[provider] }), tone: 'busy' }
    case 'needs-auth': return { text: t('settings.sync.state.needsAuth'), tone: 'warn' }
    case 'needs-ipad': return { text: t('settings.sync.state.needsIpad'), tone: 'warn' }
    case 'unavailable': return { text: t('settings.sync.state.unavailable'), tone: 'warn' }
    case 'update-required': return { text: t('settings.sync.state.updateRequired'), tone: 'warn' }
    case 'error': return { text: t('settings.sync.state.error', { message: state.message }), tone: 'warn' }
    default: return { text: t('settings.sync.state.starting'), tone: 'busy' }
  }
}

const PREPARE_KEY: Record<Exclude<ConnectPrepare['status'], 'ready' | 'error' | 'waiting' | 'uploading'>, string> = {
  'needs-ipad': 'settings.sync.prepare.needsIpad',
  unavailable: 'settings.sync.prepare.unavailable',
  'update-required': 'settings.sync.prepare.updateRequired',
  'needs-auth': 'settings.sync.prepare.needsAuth'
}
const prepareText = (t: Translate, prepared: Exclude<ConnectPrepare, { status: 'ready' }>, provider: SyncProviderKind): string =>
  prepared.status === 'error' ? t('settings.sync.prepare.error', { message: prepared.message })
    : prepared.status === 'waiting' ? t('settings.sync.prepare.waiting', { storage: NAME[provider] })
      : prepared.status === 'uploading' ? t('settings.sync.prepare.uploading', { device: prepared.device })
        : t(PREPARE_KEY[prepared.status])

function message(t: Translate, error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : t('settings.sync.error.generic')
}

function planText(t: Translate, plan: ConnectPlan, provider: SyncProviderKind): string {
  const storage = NAME[provider]
  switch (plan.kind) {
    case 'upload': return t('settings.sync.plan.upload', { courses: plan.local.courses, docs: plan.local.docs, storage })
    case 'download': return t('settings.sync.plan.download', { courses: plan.remote.courses, docs: plan.remote.docs, storage })
    case 'resume': return t('settings.sync.plan.resume', { storage })
    default: return t('settings.sync.plan.choose', { local: plan.local.courses, remote: plan.remote.courses, storage })
  }
}

/* ------------------------------------------------------------ choice cards */

interface Choice<T extends string> {
  value: T
  label: string
  detail: string
  disabled?: boolean
  describedBy?: string
}

/** Radio cards: here the description of each choice is the point, so they stay large. */
function ChoiceCards<T extends string>({ label, value, choices, onChange }: {
  label: string
  value: T
  choices: readonly Choice<T>[]
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      {choices.map(choice => (
        <button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={value === choice.value}
          aria-describedby={choice.describedBy}
          disabled={choice.disabled}
          onClick={() => onChange(choice.value)}
          className={cn(
            'grid gap-0.5 rounded-md border border-border bg-background p-3 text-left transition-colors duration-(--dur-fast)',
            'hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border',
            value === choice.value && 'border-primary bg-selected hover:border-primary'
          )}
        >
          <span className="text-sm font-medium text-foreground">{choice.label}</span>
          <span className="text-xs leading-relaxed text-muted-foreground">{choice.detail}</span>
        </button>
      ))}
    </div>
  )
}

/** Free-form row content inside a group card (plans, checks, errors). */
function Block({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('space-y-3 px-4 py-3.5', className)}>{children}</div>
}

function Actions({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
}

const note = 'text-xs leading-relaxed text-muted-foreground select-text'

/* ---------------------------------------------------------------- connect */

/** Google sign-in for Drive sync; the account shows once signed in. */
function GoogleAccountRow({ view, onView, searchable = false }: { view: SyncView; onView: (view: SyncView) => void; searchable?: boolean }): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const signIn = async (): Promise<void> => {
    setBusy(true)
    try {
      onView(await invoke('sync:signIn', {}))
    } catch (error) {
      showToast(message(t, error), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const row = {
    label: t('settings.sync.google.label'),
    description: view.account === null ? t('settings.sync.google.signInHelp') : view.account || t('settings.sync.google.connected'),
    control: (
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void signIn()}>
        {busy ? t('settings.sync.google.waiting') : view.account === null ? t('settings.sync.google.connect') : t('settings.sync.google.switch')}
      </Button>
    )
  }
  return searchable ? <SettingsRow searchId="sync.connect.google" {...row} /> : <SettingsRow {...row} />
}

function ConnectGroup({ view, onView }: { view: SyncView; onView: (view: SyncView) => void }): JSX.Element {
  const t = useT()
  const confirm = useConfirm()
  const offered = (['icloud', 'gdrive'] as const).filter(kind => view.available[kind])
  const [provider, setProvider] = useState<SyncProviderKind>(offered[0] ?? 'gdrive')
  const [prepared, setPrepared] = useState<ConnectPrepare | null>(null)
  const [mode, setMode] = useState<ConnectMode>('merge')
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  /** Counts finished checks, so the next recheck is set even when one failed and nothing else changed. */
  const [checks, setChecks] = useState(0)
  const checking = useRef(false)

  /** `quiet`: a recheck nobody asked for; if it fails, the waiting goes on without a toast. */
  const prepare = async (quiet = false): Promise<void> => {
    if (checking.current) return
    checking.current = true
    setBusy(true)
    try {
      setPrepared(await invoke('sync:prepare', { provider }))
      setMode('merge')
      setSkipped(new Set())
    } catch (error) {
      if (!quiet) showToast(message(t, error), 'danger')
    } finally {
      checking.current = false
      setBusy(false)
      setChecks(count => count + 1)
    }
  }
  useEffect(() => {
    if (prepared?.status !== 'uploading' && prepared?.status !== 'waiting') return
    const timer = setTimeout(() => void prepare(true), RECHECK_MS)
    return () => clearTimeout(timer)
  }, [prepared, checks])
  const start = async (plan: ConnectPlan): Promise<void> => {
    const chosen = plan.kind === 'choose' ? mode : 'merge'
    if (chosen === 'overwrite' && !(await confirm({
      title: t('settings.sync.confirm.overwrite.title'),
      description: t('settings.sync.confirm.overwrite.description', { courses: plan.remote.courses, docs: plan.remote.docs }),
      confirmLabel: t('settings.sync.confirm.overwrite.action'),
      confirmVariant: 'destructive'
    }))) return
    if (chosen === 'import' && !(await confirm({
      title: t('settings.sync.confirm.import.title'),
      description: t('settings.sync.confirm.import.description'),
      confirmLabel: t('settings.sync.confirm.import.action')
    }))) return
    setBusy(true)
    try {
      const pairs = chosen === 'merge' && plan.kind === 'choose' ? plan.pairs.filter(pair => !skipped.has(pair.local)).map(({ local, remote }) => ({ local, remote })) : []
      onView(await invoke('sync:connect', { provider, mode: chosen, pairs, expect: plan.kind }))
      setPrepared(null)
    } catch (error) {
      showToast(message(t, error), 'danger')
      // The root may have changed since the plan was made: show it as it is now.
      setPrepared(null)
    } finally {
      setBusy(false)
    }
  }

  const plan = prepared?.status === 'ready' ? prepared.plan : null
  const needsAccount = provider === 'gdrive' && view.account === null
  return (
    <SettingsGroup searchId="sync.connect">
      {offered.length > 1 && prepared === null && (
        <SettingsRow
          searchId="sync.connect.storage"
          footer={
            <ChoiceCards
              label={t('settings.sync.connect.storage')}
              value={provider}
              onChange={setProvider}
              choices={offered.map(kind => ({ value: kind, label: NAME[kind], detail: t(`settings.sync.provider.${kind}`) }))}
            />
          }
        />
      )}
      {provider === 'gdrive' && prepared === null && <GoogleAccountRow view={view} onView={onView} searchable />}
      {prepared === null && (
        <SettingsRow
          searchId="sync.connect.start"
          control={
            <Button variant="secondary" size="sm" disabled={busy || needsAccount} onClick={() => void prepare()}>
              {busy ? t('settings.sync.connect.checking') : t('settings.sync.connect.action', { storage: NAME[provider] })}
            </Button>
          }
        />
      )}
      {prepared !== null && prepared.status !== 'ready' && (
        <Block>
          <p className="text-xs leading-relaxed text-destructive select-text" role="alert">{prepareText(t, prepared, provider)}</p>
          <Actions>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPrepared(null)}>{t('common.cancel')}</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void prepare()}>{t('settings.sync.connect.recheck')}</Button>
          </Actions>
        </Block>
      )}
      {plan !== null && (
        <Block>
          <p className="text-sm text-foreground select-text" role="status">{planText(t, plan, provider)}</p>
          {plan.interrupted !== undefined && (
            <p id="sync-interrupted" className={note} role="note">
              {t('settings.sync.connect.interrupted', { device: plan.interrupted })}
            </p>
          )}
          {plan.kind === 'choose' && (
            <ChoiceCards
              label={t('settings.sync.connect.modes')}
              value={mode}
              onChange={setMode}
              choices={(['merge', 'overwrite', 'import'] as const).map(value => {
                const blocked = value === 'overwrite' && plan.interrupted !== undefined
                return {
                  value,
                  label: t(`settings.sync.mode.${value}`),
                  detail: t(`settings.sync.mode.${value}Detail`),
                  ...(blocked ? { disabled: true, describedBy: 'sync-interrupted' } : {})
                }
              })}
            />
          )}
          {plan.kind === 'choose' && mode === 'merge' && plan.pairs.length > 0 && (
            <fieldset className="grid gap-2 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium text-foreground">{t('settings.sync.pairs.legend')}</legend>
              {plan.pairs.map(pair => (
                <label key={pair.local} className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={!skipped.has(pair.local)}
                    onCheckedChange={checked => {
                      const next = new Set(skipped)
                      if (checked === true) next.delete(pair.local)
                      else next.add(pair.local)
                      setSkipped(next)
                    }}
                  />
                  {pair.name}
                </label>
              ))}
            </fieldset>
          )}
          <Actions>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPrepared(null)}>{t('common.cancel')}</Button>
            <Button size="sm" disabled={busy} onClick={() => void start(plan)}>{busy ? t('settings.sync.connect.connecting') : t('settings.sync.connect.begin')}</Button>
          </Actions>
        </Block>
      )}
    </SettingsGroup>
  )
}

/* ------------------------------------------------------------------- move */

function moveText(t: Translate, plan: ConnectPlan, from: SyncProviderKind, to: SyncProviderKind): string {
  return plan.kind === 'upload'
    ? t('settings.sync.move.upload', { courses: plan.local.courses, docs: plan.local.docs, to: NAME[to], from: NAME[from] })
    : t('settings.sync.move.join', { courses: plan.remote.courses, to: NAME[to], from: NAME[from] })
}

/**
 * Moving this profile to the other storage (spec v2.7): from its group after a
 * look at the plan, or in one step from the banner another device's move
 * shows, which moves as soon as that storage can take this profile.
 */
function MoveGroups({ view, onView }: { view: SyncView; onView: (view: SyncView) => void }): JSX.Element | null {
  const t = useT()
  const from = view.provider ?? 'icloud', to = OTHER[from]
  const [target, setTarget] = useState<SyncProviderKind | null>(null)
  const [oneStep, setOneStep] = useState(false)
  const [prepared, setPrepared] = useState<ConnectPrepare | null>(null)
  const [busy, setBusy] = useState(false)
  /** Counts finished checks, so the next recheck is set even when one failed and nothing else changed. */
  const [checks, setChecks] = useState(0)
  const checking = useRef(false)

  const reset = (): void => {
    setTarget(null)
    setOneStep(false)
    setPrepared(null)
  }
  /**
   * `step`: moves right away once the storage holds the data another device
   * moved there; one that looks empty (another Google account, iCloud still
   * downloading) is shown first. `quiet`: a recheck nobody asked for; if the
   * check fails, the waiting goes on. A move that fails always says so.
   */
  const look = async (provider: SyncProviderKind, step: boolean, quiet = false): Promise<void> => {
    if (checking.current) return
    checking.current = true
    setBusy(true)
    try {
      let next: ConnectPrepare
      try {
        next = await invoke('sync:prepareMove', { provider })
      } catch (error) {
        if (quiet) return
        throw error
      }
      if (step && next.status === 'ready' && next.plan.kind === 'join') {
        onView(await invoke('sync:move', { provider, expect: next.plan.kind }))
        reset()
      } else setPrepared(next)
    } catch (error) {
      showToast(message(t, error), 'danger')
      if (step) reset()
    } finally {
      checking.current = false
      setBusy(false)
      setChecks(count => count + 1)
    }
  }
  useEffect(() => {
    if (target === null || (prepared?.status !== 'uploading' && prepared?.status !== 'waiting')) return
    const timer = setTimeout(() => void look(target, oneStep, true), RECHECK_MS)
    return () => clearTimeout(timer)
  }, [prepared, checks])
  /** Following another device's move: a Google sign-in first when there is none (or `again`), offering the account it moved to. */
  const follow = async (provider: SyncProviderKind, again = false): Promise<void> => {
    setTarget(provider)
    setOneStep(true)
    if (provider === 'gdrive' && (again || view.account === null)) {
      setBusy(true)
      try {
        onView(await invoke('sync:signIn', { follow: true }))
      } catch (error) {
        showToast(message(t, error), 'danger')
        if (!again) reset()
        return
      } finally {
        setBusy(false)
      }
    }
    await look(provider, true)
  }
  const begin = (): void => {
    setTarget(to)
    setOneStep(false)
    setPrepared(null)
    if (to !== 'gdrive' || view.account !== null) void look(to, false)
  }
  const move = async (plan: ConnectPlan): Promise<void> => {
    setBusy(true)
    try {
      onView(await invoke('sync:move', { provider: to, expect: plan.kind }))
    } catch (error) {
      showToast(message(t, error), 'danger')
    } finally {
      setBusy(false)
      reset()
    }
  }
  const dismiss = async (at: number): Promise<void> => {
    try {
      onView(await invoke('sync:dismissMove', { t: at }))
    } catch (error) {
      showToast(message(t, error), 'danger')
    }
  }

  // A move under way: the status group says so.
  if (view.moving !== null) return null
  const offer = target === null ? view.moved : null, plan = prepared?.status === 'ready' ? prepared.plan : null
  const cancel = <Button variant="ghost" size="sm" disabled={busy} onClick={reset}>{t('common.cancel')}</Button>
  return (
    <>
      {offer !== null && (
        <div data-sync-move-offer="">
          <SettingsNotice
            action={
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void dismiss(offer.t)}>
                  {view.available[offer.provider] ? t('settings.sync.offer.later') : t('settings.sync.offer.close')}
                </Button>
                {view.available[offer.provider] && (
                  <Button size="sm" disabled={busy} onClick={() => void follow(offer.provider)}>{t('settings.sync.move.action')}</Button>
                )}
              </div>
            }
          >
            <p className="text-sm font-medium text-foreground">{t('settings.sync.offer.title', { device: offer.device, storage: storageOf(offer) })}</p>
            <p className="text-muted-foreground">
              {view.available[offer.provider]
                ? t('settings.sync.offer.ask', { from: NAME[from] })
                : t('settings.sync.offer.unavailable', { to: NAME[offer.provider], from: NAME[from] })}
            </p>
          </SettingsNotice>
        </div>
      )}
      {view.available[to] && (
        <SettingsGroup searchId="sync.move" description={t('settings.sync.move.description', { to: NAME[to], from: NAME[from] })}>
          {target === null && (
            <SettingsRow
              searchId="sync.move.start"
              description={t('settings.sync.move.current', { from: NAME[from] })}
              control={<Button variant="secondary" size="sm" disabled={busy} onClick={begin}>{t('settings.sync.move.begin', { to: NAME[to] })}</Button>}
            />
          )}
          {target !== null && to === 'gdrive' && view.account === null && !oneStep && (
            <>
              <GoogleAccountRow view={view} onView={onView} />
              <Block><Actions>{cancel}</Actions></Block>
            </>
          )}
          {target !== null && prepared === null && (oneStep || to !== 'gdrive' || view.account !== null) && (
            <Block className="flex items-center gap-3 space-y-0">
              <p className={cn(note, 'flex-1')} role="status">
                {!busy ? t('settings.sync.move.willCheck', { to: NAME[to] }) : to === 'gdrive' && view.account === null ? t('settings.sync.move.waitingGoogle') : t('settings.sync.move.checking', { to: NAME[to] })}
              </p>
              <Actions>
                {cancel}
                {!busy && <Button variant="secondary" size="sm" onClick={() => void look(to, oneStep)}>{t('settings.sync.move.check')}</Button>}
              </Actions>
            </Block>
          )}
          {prepared !== null && prepared.status !== 'ready' && (
            <Block>
              <p className="text-xs leading-relaxed text-destructive select-text" role="alert">
                {[prepareText(t, prepared, to), ...(oneStep && (prepared.status === 'uploading' || prepared.status === 'waiting') ? [t('settings.sync.prepare.keepOpen')] : [])].join(' ')}
              </p>
              <Actions>
                {cancel}
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void look(to, oneStep)}>{t('settings.sync.connect.recheck')}</Button>
              </Actions>
            </Block>
          )}
          {plan !== null && (
            <Block>
              <p className="text-sm text-foreground select-text" role="status">{moveText(t, plan, from, to)}</p>
              {oneStep && plan.kind === 'upload' && (
                <p className={note} role="note">
                  {[
                    t('settings.sync.move.notVisible', { device: view.moved?.device ?? t('settings.sync.move.otherDevice'), to: NAME[to] }),
                    ...(to === 'gdrive'
                      ? [
                          t('settings.sync.move.sameAccount', { hint: view.moved?.account_hint ? `(${view.moved.account_hint})` : '' }),
                          ...(view.account ? [t('settings.sync.move.signedInAs', { account: view.account })] : [])
                        ]
                      : [t('settings.sync.move.icloudDownloading')]),
                    t('settings.sync.move.uploadFresh')
                  ].join(' ')}
                </p>
              )}
              {plan.interrupted !== undefined && (
                <p className={note} role="note">{t('settings.sync.move.interrupted', { device: plan.interrupted, to: NAME[to] })}</p>
              )}
              <Actions>
                {cancel}
                {oneStep && plan.kind === 'upload' && to === 'gdrive' && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void follow(to, true)}>{t('settings.sync.move.repickGoogle')}</Button>}
                {oneStep && plan.kind === 'upload' && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void look(to, true)}>{t('settings.sync.connect.recheck')}</Button>}
                <Button size="sm" disabled={busy} onClick={() => void move(plan)}>{busy ? t('settings.sync.move.moving') : t('settings.sync.move.action')}</Button>
              </Actions>
            </Block>
          )}
        </SettingsGroup>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ bound */

function BoundGroups({ view, onView }: { view: SyncView; onView: (view: SyncView) => void }): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<SyncView>): Promise<void> => {
    setBusy(true)
    try {
      onView(await action())
    } catch (error) {
      showToast(message(t, error), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const rename = async (draft: string): Promise<string | undefined> => {
    if (draft.trim() === '') return t('settings.sync.devices.nameEmpty')
    if (draft.length > DEVICE_NAME_MAX) return t('settings.sync.devices.nameTooLong')
    setBusy(true)
    try {
      onView(await invoke('sync:rename', { name: draft }))
      return undefined
    } catch (error) {
      return message(t, error)
    } finally {
      setBusy(false)
    }
  }
  const provider = view.provider ?? 'icloud', storage = NAME[provider]
  const line = stateLine(t, locale, view, provider)
  const statusNotes = [
    ...(view.pending > 0 ? [t('settings.sync.status.pending', { count: view.pending })] : []),
    ...(view.moving !== null ? [t('settings.sync.status.moving', { storage, from: NAME[view.moving] })] : [])
  ]
  return (
    <>
      <SettingsGroup
        searchId="sync.status"
        title={t('settings.sync.status.groupTitle', { storage })}
        description={provider === 'icloud'
          ? t('settings.sync.status.icloud')
          : t('settings.sync.status.gdrive', { account: view.account ? `(${view.account})` : '' })}
      >
        <SettingsRow
          searchId="sync.status.now"
          label={
            <span
              role="status"
              className={cn(line.tone === 'busy' && 'text-muted-foreground', line.tone === 'warn' && 'text-destructive')}
            >
              {line.text}
            </span>
          }
          {...(statusNotes.length > 0 ? { description: statusNotes.map(text => <span key={text} className="block">{text}</span>) } : {})}
          control={view.state.state === 'needs-auth'
            ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => invoke('sync:signIn', {}))}>{t('settings.sync.status.reconnect')}</Button>
            : <Button variant="secondary" size="sm" disabled={busy || view.state.state === 'syncing'} onClick={() => void run(() => invoke('sync:now', {}))}>{t('settings.sync.status.now')}</Button>}
        />
      </SettingsGroup>
      <MoveGroups view={view} onView={onView} />
      <SettingsGroup searchId="sync.devices" description={t('settings.sync.devices.groupDescription', { storage })}>
        {view.devices.map(device => (
          <div key={device.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-foreground">
            <span className="min-w-0 truncate">
              {[
                device.self ? t('settings.sync.devices.self', { name: device.name }) : device.name,
                ...(device.moved_to !== null && !device.self ? [t('settings.sync.devices.movedTo', { storage: NAME[device.moved_to.provider] })] : [])
              ].join(' · ')}
            </span>
            {!device.self && device.last_seen !== null && <span className="shrink-0 text-xs text-muted-foreground">{ago(device.last_seen, Date.now(), locale)}</span>}
          </div>
        ))}
        <SettingsTextRow searchId="sync.devices.name" value={view.device.name} maxLength={64} disabled={busy} onCommit={rename} />
      </SettingsGroup>
      {/* Disconnecting and connecting again stays as an advanced choice; moving is the way to change storage (spec v2.7). */}
      <SettingsGroup searchId="sync.advanced">
        <SettingsRow
          searchId="sync.advanced.disconnect"
          alignTop
          description={[
            t('settings.sync.disconnect.description', { storage }),
            ...(provider === 'gdrive' ? [t('settings.sync.disconnect.google')] : []),
            t('settings.sync.disconnect.reconnect'),
            ...(view.available[OTHER[provider]] ? [t('settings.sync.disconnect.useMove')] : [])
          ].join(' ')}
          control={
            <Button
              variant="destructive-outline"
              size="sm"
              disabled={busy}
              onClick={() => void (async () => {
                if (await confirm({
                  title: t('settings.sync.confirm.disconnect.title'),
                  description: t('settings.sync.confirm.disconnect.description', { storage }),
                  confirmLabel: t('settings.sync.disconnect.label'),
                  confirmVariant: 'destructive'
                })) await run(() => invoke('sync:disconnect', {}))
              })()}
            >
              {t('settings.sync.disconnect.label')}
            </Button>
          }
        />
      </SettingsGroup>
    </>
  )
}

export function SyncPanel(): JSX.Element {
  const t = useT()
  const [view, setView] = useState<SyncView | null>(null)
  useEffect(() => {
    void invoke('sync:status', {}).then(setView, error => showToast(message(t, error), 'danger'))
    const off = onPush('sync:changed', setView)
    return () => off()
  }, [])
  if (view === null) return <SettingsStack>{null}</SettingsStack>
  if (!view.available.icloud && !view.available.gdrive) {
    return (
      <SettingsStack>
        <SettingsGroup searchId="sync.connect" bare>
          <SettingsEmptyState title={t('settings.sync.connect.unavailable')} />
        </SettingsGroup>
      </SettingsStack>
    )
  }
  return (
    <SettingsStack>
      {view.provider === null ? <ConnectGroup view={view} onView={setView} /> : <BoundGroups view={view} onView={setView} />}
    </SettingsStack>
  )
}
