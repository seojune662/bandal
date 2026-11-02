/**
 * Settings › 동기화 (design 6.1–6.4): connect this profile to the user's
 * iCloud or Google Drive, choose what happens when both sides hold data, and
 * watch the state. Nothing here goes through Bandal's servers.
 */
import { useEffect, useRef, useState } from 'react'
import type { ConnectMode, ConnectPlan, ConnectPrepare, SyncProviderKind, SyncView } from '../../../../../shared/types/sync'
import { showToast } from '../../../app/toast'
import { invoke, onPush } from '../../../lib/ipc'
import { SettingsCard } from '../primitives'
import './sync-panel.css'

const MINUTE = 60_000
/** While another device's first upload runs (spec v2.6) or root files are still arriving, the root is checked again this often. */
const RECHECK_MS = 30_000
const NAME: Record<SyncProviderKind, string> = { icloud: 'iCloud', gdrive: 'Google Drive' }
const OTHER: Record<SyncProviderKind, SyncProviderKind> = { icloud: 'gdrive', gdrive: 'icloud' }
/** A storage with the account another device moved to, when it said (spec v2.7 account_hint): "Google Drive(me@example.com)". */
const storageOf = (moved: { provider: SyncProviderKind; account_hint: string | null }): string => `${NAME[moved.provider]}${moved.account_hint ? `(${moved.account_hint})` : ''}`

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - at) / MINUTE)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`
  return `${Math.floor(minutes / (24 * 60))}일 전`
}

function stateLine(view: SyncView, provider: SyncProviderKind): { text: string; tone: 'ok' | 'busy' | 'warn' } {
  const { state } = view
  switch (state.state) {
    case 'synced': return { text: `동기화됨 · ${ago(state.at)}`, tone: 'ok' }
    case 'syncing': return { text: '동기화하는 중', tone: 'busy' }
    case 'waiting': return { text: `${NAME[provider]}에서 파일을 받는 중이에요. 받는 대로 이어서 동기화해요`, tone: 'busy' }
    case 'needs-auth': return { text: 'Google Drive 연결이 끊겼어요', tone: 'warn' }
    case 'needs-ipad': return { text: 'iPad에서 먼저 iCloud 동기화를 켜 주세요', tone: 'warn' }
    case 'unavailable': return { text: '시스템 설정에서 iCloud Drive를 켜 주세요', tone: 'warn' }
    case 'update-required': return { text: '다른 기기에서 더 새 반달을 쓰고 있어요. 앱을 업데이트해 주세요', tone: 'warn' }
    case 'error': return { text: `동기화하지 못했어요: ${state.message}`, tone: 'warn' }
    default: return { text: '시작하는 중', tone: 'busy' }
  }
}

const PREPARE_TEXT: Record<Exclude<ConnectPrepare['status'], 'ready' | 'error' | 'waiting' | 'uploading'>, string> = {
  'needs-ipad': 'iPad에서 먼저 iCloud 동기화를 켜 주세요. iPad가 iCloud에 반달 폴더를 만들면 여기서 연결할 수 있어요.',
  unavailable: '이 Mac에서 iCloud Drive가 꺼져 있어요. 시스템 설정 › Apple 계정 › iCloud에서 iCloud Drive를 켜 주세요.',
  'update-required': '다른 기기에서 더 새 반달을 쓰고 있어요. 앱을 업데이트한 뒤 연결해 주세요.',
  'needs-auth': 'Google 계정을 먼저 연결해 주세요.'
}
const prepareText = (prepared: Exclude<ConnectPrepare, { status: 'ready' }>, provider: SyncProviderKind): string =>
  prepared.status === 'error' ? `연결할 수 없어요: ${prepared.message}`
    : prepared.status === 'waiting' ? `${NAME[provider]}에서 파일을 아직 받고 있어요. 잠시 뒤 다시 확인해 주세요.`
      : prepared.status === 'uploading' ? `다른 기기(${prepared.device})가 아직 올리고 있어요. 다 올리면 연결할 수 있어요. 30초마다 다시 확인해요.`
        : PREPARE_TEXT[prepared.status]

function message(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '동기화 요청을 처리하지 못했어요.'
}

function planText(plan: ConnectPlan, provider: SyncProviderKind): string {
  const name = NAME[provider]
  switch (plan.kind) {
    case 'upload': return `이 기기의 과목 ${plan.local.courses}개, 문서 ${plan.local.docs}개를 ${name}에 올립니다.`
    case 'download': return `${name}의 과목 ${plan.remote.courses}개, 문서 ${plan.remote.docs}개를 이 기기로 받습니다.`
    case 'resume': return `전에 이 ${name}와 맞추던 자료를 이어서 동기화합니다.`
    default: return `이 기기에는 과목 ${plan.local.courses}개, ${name}에는 과목 ${plan.remote.courses}개가 있어요. 어떻게 맞출지 골라 주세요.`
  }
}

const PROVIDER_DETAIL: Record<SyncProviderKind, string> = {
  icloud: '이 Mac의 iCloud Drive에 있는 반달 폴더와 맞춥니다. iPad에서 먼저 iCloud 동기화를 켜 주세요.',
  gdrive: 'Google Drive에 Bandal 폴더를 두고 맞춥니다. 반달은 자기가 만든 파일에만 접근해요.'
}

/** Google sign-in for Drive sync; the account shows once signed in. */
function GoogleAccountRow({ view, onView }: { view: SyncView; onView: (view: SyncView) => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const signIn = async (): Promise<void> => {
    setBusy(true)
    try {
      onView(await invoke('sync:signIn', {}))
    } catch (error) {
      showToast(message(error), 'danger')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="setting-row">
      <div className="setting-row__copy">
        <span className="setting-row__label">Google 계정</span>
        <span className="setting-row__description">{view.account === null ? '브라우저에서 Google 계정으로 로그인해 Drive 접근을 허용해 주세요.' : view.account || '연결됨'}</span>
      </div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void signIn()}>
        {busy ? '브라우저에서 기다리는 중' : view.account === null ? 'Google 계정 연결' : '다른 계정'}
      </button>
    </div>
  )
}

function ConnectCard({ view, onView }: { view: SyncView; onView: (view: SyncView) => void }): JSX.Element {
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
      if (!quiet) showToast(message(error), 'danger')
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
    if (chosen === 'overwrite' &&
      !window.confirm(`다른 기기에만 있는 과목 ${plan.remote.courses}개와 문서 ${plan.remote.docs}개가 모든 기기에서 사라집니다. 클라우드 파일은 지우지 않습니다. 덮어쓸까요?`)) return
    if (chosen === 'import' && !window.confirm('지금 자료는 이 프로필에 그대로 두고, 백업한 뒤 새 프로필로 클라우드 자료를 가져옵니다. 앱이 다시 열려요. 계속할까요?')) return
    setBusy(true)
    try {
      const pairs = chosen === 'merge' && plan.kind === 'choose' ? plan.pairs.filter(pair => !skipped.has(pair.local)).map(({ local, remote }) => ({ local, remote })) : []
      onView(await invoke('sync:connect', { provider, mode: chosen, pairs, expect: plan.kind }))
      setPrepared(null)
    } catch (error) {
      showToast(message(error), 'danger')
      // The root may have changed since the plan was made: show it as it is now.
      setPrepared(null)
    } finally {
      setBusy(false)
    }
  }

  const plan = prepared?.status === 'ready' ? prepared.plan : null
  const needsAccount = provider === 'gdrive' && view.account === null
  return (
    <SettingsCard title="동기화" description="iPad와 이 기기가 사용자의 iCloud나 Google Drive에서 과목·PDF·필기·노트를 맞춥니다. 반달 서버에는 아무것도 올리지 않아요.">
      <div className="settings-card__rows">
        {offered.length > 1 && prepared === null && (
          <div className="sync-connect__modes" role="radiogroup" aria-label="저장소">
            {offered.map(kind => (
              <button key={kind} type="button" role="radio" aria-checked={provider === kind}
                className={`sync-connect__mode${provider === kind ? ' sync-connect__mode--selected' : ''}`} onClick={() => setProvider(kind)}>
                <span className="setting-row__label">{NAME[kind]}</span>
                <span className="setting-row__description">{PROVIDER_DETAIL[kind]}</span>
              </button>
            ))}
          </div>
        )}
        {provider === 'gdrive' && prepared === null && <GoogleAccountRow view={view} onView={onView} />}
        {prepared === null && (
          <div className="setting-row">
            <span className="setting-row__description">이 프로필은 아직 동기화하지 않아요.</span>
            <button type="button" className="secondary-button" disabled={busy || needsAccount} onClick={() => void prepare()}>
              {busy ? '확인하는 중' : `${NAME[provider]}에 연결`}
            </button>
          </div>
        )}
        {prepared !== null && prepared.status !== 'ready' && (
          <div className="setting-row">
            <span className="setting-row__description settings-feedback--error" role="alert">{prepareText(prepared, provider)}</span>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setPrepared(null)}>취소</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void prepare()}>다시 확인</button>
          </div>
        )}
        {plan !== null && (
          <div className="sync-connect">
            <p className="setting-row__description" role="status">{planText(plan, provider)}</p>
            {plan.interrupted !== undefined && (
              <p id="sync-interrupted" className="setting-row__description" role="note">
                다른 기기({plan.interrupted})가 처음 올리다 멈췄어요. 그 기기가 다시 켜지면 나머지를 이어 올려요. 그때까지 덮어쓰기는 쓸 수 없어요.
              </p>
            )}
            {plan.kind === 'choose' && (
              <div className="sync-connect__modes" role="radiogroup" aria-label="맞추는 방법">
                {([
                  ['merge', '합치기', '두 쪽 자료를 모두 남깁니다. 같은 과목 안의 같은 PDF는 하나로 합칩니다.'],
                  ['overwrite', '이 기기 자료로 덮어쓰기', '이 기기에 없는 과목과 문서는 모든 기기에서 사라집니다. 클라우드 파일은 지우지 않습니다.'],
                  ['import', '클라우드 자료 가져오기', '지금 자료는 이 프로필에 그대로 두고, 백업 뒤 새 프로필로 클라우드 자료를 받습니다.']
                ] as const).map(([value, label, detail]) => (
                  <button key={value} type="button" role="radio" aria-checked={mode === value} disabled={value === 'overwrite' && plan.interrupted !== undefined}
                    aria-describedby={value === 'overwrite' && plan.interrupted !== undefined ? 'sync-interrupted' : undefined}
                    className={`sync-connect__mode${mode === value ? ' sync-connect__mode--selected' : ''}`} onClick={() => setMode(value)}>
                    <span className="setting-row__label">{label}</span>
                    <span className="setting-row__description">{detail}</span>
                  </button>
                ))}
              </div>
            )}
            {plan.kind === 'choose' && mode === 'merge' && plan.pairs.length > 0 && (
              <fieldset className="sync-connect__pairs">
                <legend className="setting-row__label">이름이 같은 과목을 하나로 합칠까요?</legend>
                {plan.pairs.map(pair => (
                  <label key={pair.local} className="sync-connect__pair">
                    <input type="checkbox" checked={!skipped.has(pair.local)} onChange={event => {
                      const next = new Set(skipped)
                      if (event.target.checked) next.delete(pair.local)
                      else next.add(pair.local)
                      setSkipped(next)
                    }} />
                    {pair.name}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="sync-connect__actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setPrepared(null)}>취소</button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void start(plan)}>{busy ? '연결하는 중' : '시작'}</button>
            </div>
          </div>
        )}
      </div>
    </SettingsCard>
  )
}

function moveText(plan: ConnectPlan, from: SyncProviderKind, to: SyncProviderKind): string {
  return plan.kind === 'upload'
    ? `이 기기의 과목 ${plan.local.courses}개, 문서 ${plan.local.docs}개를 ${NAME[to]}로 옮깁니다. 다 올리면 ${NAME[from]} 연결을 끊어요.`
    : `${NAME[to]}에 이미 과목 ${plan.remote.courses}개가 있어요. 같은 자료는 다시 올리지 않고, 이 기기에만 있거나 바뀐 것만 올려 합칩니다. 다 맞추면 ${NAME[from]} 연결을 끊어요.`
}

/**
 * Moving this profile to the other storage (spec v2.7): from its card after a
 * look at the plan, or in one step from the banner another device's move
 * shows, which moves as soon as that storage can take this profile.
 */
function MoveCards({ view, onView }: { view: SyncView; onView: (view: SyncView) => void }): JSX.Element | null {
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
      showToast(message(error), 'danger')
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
        showToast(message(error), 'danger')
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
      showToast(message(error), 'danger')
    } finally {
      setBusy(false)
      reset()
    }
  }
  const dismiss = async (t: number): Promise<void> => {
    try {
      onView(await invoke('sync:dismissMove', { t }))
    } catch (error) {
      showToast(message(error), 'danger')
    }
  }

  // A move under way: the state card says so.
  if (view.moving !== null) return null
  const offer = target === null ? view.moved : null, plan = prepared?.status === 'ready' ? prepared.plan : null
  return (
    <>
      {offer !== null && (
        <SettingsCard className="sync-move-offer">
          <div className="settings-card__rows">
            <div className="setting-row" role="status">
              <div className="setting-row__copy">
                <span className="setting-row__label">{offer.device}에서 {storageOf(offer)}로 옮겼어요</span>
                <span className="setting-row__description">{view.available[offer.provider]
                  ? `이 기기도 옮길까요? 같은 자료는 다시 올리지 않고, ${NAME[from]}의 파일은 지우지 않아요.`
                  : `이 기기에서는 ${NAME[offer.provider]}를 쓸 수 없어 지금처럼 ${NAME[from]}와 동기화해요.`}</span>
              </div>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => void dismiss(offer.t)}>
                {view.available[offer.provider] ? '나중에' : '닫기'}
              </button>
              {view.available[offer.provider] && <button type="button" className="secondary-button" disabled={busy} onClick={() => void follow(offer.provider)}>옮기기</button>}
            </div>
          </div>
        </SettingsCard>
      )}
      {view.available[to] && (
        <SettingsCard title="저장소 옮기기" description={`자료를 ${NAME[to]}로 옮기고 이 기기를 그쪽에 연결해요. 다른 기기에는 따라 옮길지 묻는 안내가 떠요. ${NAME[from]}의 파일은 지우지 않아요.`}>
          <div className="settings-card__rows">
            {target === null && (
              <div className="setting-row">
                <span className="setting-row__description">지금은 {NAME[from]}와 동기화하고 있어요.</span>
                <button type="button" className="secondary-button" disabled={busy} onClick={begin}>{NAME[to]}로 옮기기</button>
              </div>
            )}
            {target !== null && to === 'gdrive' && view.account === null && !oneStep && (
              <>
                <GoogleAccountRow view={view} onView={onView} />
                <div className="sync-connect__actions">
                  <button type="button" className="secondary-button" disabled={busy} onClick={reset}>취소</button>
                </div>
              </>
            )}
            {target !== null && prepared === null && (oneStep || to !== 'gdrive' || view.account !== null) && (
              <div className="setting-row">
                <span className="setting-row__description" role="status">
                  {!busy ? `${NAME[to]}를 확인할게요.` : to === 'gdrive' && view.account === null ? '브라우저에서 Google 로그인을 기다리는 중' : `${NAME[to]}를 확인하는 중`}
                </span>
                <button type="button" className="secondary-button" disabled={busy} onClick={reset}>취소</button>
                {!busy && <button type="button" className="secondary-button" onClick={() => void look(to, oneStep)}>확인</button>}
              </div>
            )}
            {prepared !== null && prepared.status !== 'ready' && (
              <div className="setting-row">
                <span className="setting-row__description settings-feedback--error" role="alert">
                  {prepareText(prepared, to)}{oneStep && (prepared.status === 'uploading' || prepared.status === 'waiting') ? ' 이 화면을 열어 두면 준비되는 대로 옮겨요.' : ''}
                </span>
                <button type="button" className="secondary-button" disabled={busy} onClick={reset}>취소</button>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void look(to, oneStep)}>다시 확인</button>
              </div>
            )}
            {plan !== null && (
              <div className="sync-connect">
                <p className="setting-row__description" role="status">{moveText(plan, from, to)}</p>
                {oneStep && plan.kind === 'upload' && (
                  <p className="setting-row__description" role="note">
                    {view.moved?.device ?? '다른 기기'}에서 옮긴 자료가 {NAME[to]}에 아직 보이지 않아요.{' '}
                    {to === 'gdrive'
                      ? `같은 Google 계정${view.moved?.account_hint ? `(${view.moved.account_hint})` : ''}인지 확인해 주세요.${view.account ? ` 지금 로그인한 계정: ${view.account}.` : ''}`
                      : 'iCloud가 아직 내려받는 중일 수 있어요.'}{' '}
                    그대로 옮기면 이 기기의 자료를 새로 올려요.
                  </p>
                )}
                {plan.interrupted !== undefined && (
                  <p className="setting-row__description" role="note">
                    다른 기기({plan.interrupted})가 {NAME[to]}에 처음 올리다 멈췄어요. 옮기면 그 자료와 합쳐요.
                  </p>
                )}
                <div className="sync-connect__actions">
                  <button type="button" className="secondary-button" disabled={busy} onClick={reset}>취소</button>
                  {oneStep && plan.kind === 'upload' && to === 'gdrive' && <button type="button" className="secondary-button" disabled={busy} onClick={() => void follow(to, true)}>Google 계정 다시 고르기</button>}
                  {oneStep && plan.kind === 'upload' && <button type="button" className="secondary-button" disabled={busy} onClick={() => void look(to, true)}>다시 확인</button>}
                  <button type="button" className="secondary-button" disabled={busy} onClick={() => void move(plan)}>{busy ? '옮기는 중' : '옮기기'}</button>
                </div>
              </div>
            )}
          </div>
        </SettingsCard>
      )}
    </>
  )
}

function BoundCards({ view, onView }: { view: SyncView; onView: (view: SyncView) => void }): JSX.Element {
  const [name, setName] = useState(view.device.name)
  const [busy, setBusy] = useState(false)
  useEffect(() => setName(view.device.name), [view.device.name])
  const run = async (action: () => Promise<SyncView>): Promise<void> => {
    setBusy(true)
    try {
      onView(await action())
    } catch (error) {
      showToast(message(error), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const provider = view.provider ?? 'icloud', storage = NAME[provider]
  const line = stateLine(view, provider)
  return (
    <>
      <SettingsCard title={`${storage} 동기화`} description={provider === 'icloud'
        ? '이 프로필은 이 Mac의 iCloud Drive에 있는 반달 폴더와 맞춥니다.'
        : `이 프로필은 Google Drive${view.account ? `(${view.account})` : ''}의 Bandal 폴더와 맞춥니다.`}>
        <div className="settings-card__rows">
          <div className="setting-row">
            <div className="setting-row__copy">
              <span className={`setting-row__label sync-state sync-state--${line.tone}`} role="status">{line.text}</span>
              {view.pending > 0 && <span className="setting-row__description">보낼 변경 {view.pending}건</span>}
              {view.moving !== null && <span className="setting-row__description">{storage}로 옮기는 중이에요. 다 올리면 {NAME[view.moving]}에 알리고 연결을 끊어요.</span>}
            </div>
            {view.state.state === 'needs-auth'
              ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(() => invoke('sync:signIn', {}))}>다시 연결</button>
              : <button type="button" className="secondary-button" disabled={busy || view.state.state === 'syncing'} onClick={() => void run(() => invoke('sync:now', {}))}>
                  지금 동기화
                </button>}
          </div>
        </div>
      </SettingsCard>
      <MoveCards view={view} onView={onView} />
      <SettingsCard title="기기" description={`이 ${storage}와 맞추는 기기들이에요. 이 기기의 이름은 충돌 사본 이름에도 쓰여요.`}>
        <ul className="sync-devices">
          {view.devices.map(device => (
            <li key={device.id}>
              <span>{device.name}{device.self ? ' (이 기기)' : ''}{device.moved_to !== null && !device.self ? ` · ${NAME[device.moved_to.provider]}로 옮김` : ''}</span>
              {!device.self && device.last_seen !== null && <span className="setting-row__description">{ago(device.last_seen)}</span>}
            </li>
          ))}
        </ul>
        <div className="settings-card__rows">
          <form className="setting-row" onSubmit={event => {
            event.preventDefault()
            void run(() => invoke('sync:rename', { name }))
          }}>
            <label className="setting-row__copy">
              <span className="setting-row__label">이 기기 이름</span>
              <input className="settings-text-input" value={name} maxLength={64} onChange={event => setName(event.target.value)} />
            </label>
            <button type="submit" className="secondary-button" disabled={busy || name.trim() === '' || name === view.device.name}>저장</button>
          </form>
        </div>
      </SettingsCard>
      {/* Disconnecting and connecting again stays as an advanced choice; moving is the way to change storage (spec v2.7). */}
      <SettingsCard>
        <details className="sync-advanced">
          <summary>고급</summary>
          <div className="settings-card__rows">
            <div className="setting-row">
              <div className="setting-row__copy">
                <span className="setting-row__label">연결 해제</span>
                <span className="setting-row__description">
                  이 기기의 동기화를 끕니다. 이 기기의 자료와 {storage}의 파일은 그대로 둡니다.{provider === 'gdrive' ? ' 이 기기에 저장한 Google 로그인도 지웁니다.' : ''}
                  {' '}다시 연결하면 처음 연결할 때처럼 합치기·덮어쓰기·가져오기를 고릅니다.{view.available[OTHER[provider]] ? ' 저장소를 바꿀 때는 저장소 옮기기를 쓰세요.' : ''}
                </span>
              </div>
              <button type="button" className="secondary-button settings-advanced-danger-button" disabled={busy} onClick={() => {
                if (window.confirm(`이 기기의 동기화를 끌까요? 자료와 ${storage} 파일은 그대로 둡니다.`)) void run(() => invoke('sync:disconnect', {}))
              }}>
                연결 해제
              </button>
            </div>
          </div>
        </details>
      </SettingsCard>
    </>
  )
}

export function SyncPanel(): JSX.Element {
  const [view, setView] = useState<SyncView | null>(null)
  useEffect(() => {
    void invoke('sync:status', {}).then(setView, error => showToast(message(error), 'danger'))
    const off = onPush('sync:changed', setView)
    return () => off()
  }, [])
  if (view === null) return <div className="settings-stack" />
  if (!view.available.icloud && !view.available.gdrive) {
    return (
      <div className="settings-stack">
        <SettingsCard title="동기화" description="이 기기에서는 동기화를 쓸 수 없어요.">
          {null}
        </SettingsCard>
      </div>
    )
  }
  return <div className="settings-stack">{view.provider === null ? <ConnectCard view={view} onView={setView} /> : <BoundCards view={view} onView={setView} />}</div>
}
