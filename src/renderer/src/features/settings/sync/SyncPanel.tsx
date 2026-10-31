/**
 * Settings › 동기화 (design 6.1–6.2): connect this profile to the user's
 * iCloud, choose what happens when both sides hold data, and watch the state.
 * Nothing here goes through Bandal's servers.
 */
import { useEffect, useState } from 'react'
import type { ConnectMode, ConnectPlan, ConnectPrepare, SyncView } from '../../../../../shared/types/sync'
import { showToast } from '../../../app/toast'
import { invoke, onPush } from '../../../lib/ipc'
import { SettingsCard } from '../primitives'
import './sync-panel.css'

const MINUTE = 60_000

export function ago(at: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - at) / MINUTE)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`
  return `${Math.floor(minutes / (24 * 60))}일 전`
}

function stateLine(view: SyncView): { text: string; tone: 'ok' | 'busy' | 'warn' } {
  const { state } = view
  switch (state.state) {
    case 'synced': return { text: `동기화됨 · ${ago(state.at)}`, tone: 'ok' }
    case 'syncing': return { text: '동기화하는 중', tone: 'busy' }
    case 'waiting': return { text: 'iCloud에서 파일을 받는 중이에요. 받는 대로 이어서 동기화해요', tone: 'busy' }
    case 'needs-ipad': return { text: 'iPad에서 먼저 iCloud 동기화를 켜 주세요', tone: 'warn' }
    case 'unavailable': return { text: '시스템 설정에서 iCloud Drive를 켜 주세요', tone: 'warn' }
    case 'update-required': return { text: '다른 기기에서 더 새 반달을 쓰고 있어요. 앱을 업데이트해 주세요', tone: 'warn' }
    case 'error': return { text: `동기화하지 못했어요: ${state.message}`, tone: 'warn' }
    default: return { text: '시작하는 중', tone: 'busy' }
  }
}

const PREPARE_TEXT: Record<Exclude<ConnectPrepare['status'], 'ready' | 'error'>, string> = {
  'needs-ipad': 'iPad에서 먼저 iCloud 동기화를 켜 주세요. iPad가 iCloud에 반달 폴더를 만들면 여기서 연결할 수 있어요.',
  unavailable: '이 Mac에서 iCloud Drive가 꺼져 있어요. 시스템 설정 › Apple 계정 › iCloud에서 iCloud Drive를 켜 주세요.',
  waiting: 'iCloud에서 파일을 아직 받고 있어요. 잠시 뒤 다시 확인해 주세요.',
  'update-required': '다른 기기에서 더 새 반달을 쓰고 있어요. 앱을 업데이트한 뒤 연결해 주세요.'
}

function message(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '동기화 요청을 처리하지 못했어요.'
}

function planText(plan: ConnectPlan): string {
  switch (plan.kind) {
    case 'upload': return `이 기기의 과목 ${plan.local.courses}개, 문서 ${plan.local.docs}개를 iCloud에 올립니다.`
    case 'download': return `iCloud의 과목 ${plan.remote.courses}개, 문서 ${plan.remote.docs}개를 이 기기로 받습니다.`
    case 'resume': return '전에 이 iCloud와 맞추던 자료를 이어서 동기화합니다.'
    default: return `이 기기에는 과목 ${plan.local.courses}개, iCloud에는 과목 ${plan.remote.courses}개가 있어요. 어떻게 맞출지 골라 주세요.`
  }
}

function ConnectCard({ onView }: { onView: (view: SyncView) => void }): JSX.Element {
  const [prepared, setPrepared] = useState<ConnectPrepare | null>(null)
  const [mode, setMode] = useState<ConnectMode>('merge')
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const prepare = async (): Promise<void> => {
    setBusy(true)
    try {
      setPrepared(await invoke('sync:prepare', {}))
      setMode('merge')
      setSkipped(new Set())
    } catch (error) {
      showToast(message(error), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const start = async (plan: ConnectPlan): Promise<void> => {
    const chosen = plan.kind === 'choose' ? mode : 'merge'
    if (chosen === 'overwrite' &&
      !window.confirm(`다른 기기에만 있는 과목 ${plan.remote.courses}개와 문서 ${plan.remote.docs}개가 모든 기기에서 사라집니다. 클라우드 파일은 지우지 않습니다. 덮어쓸까요?`)) return
    if (chosen === 'import' && !window.confirm('지금 자료는 이 프로필에 그대로 두고, 백업한 뒤 새 프로필로 클라우드 자료를 가져옵니다. 앱이 다시 열려요. 계속할까요?')) return
    setBusy(true)
    try {
      const pairs = chosen === 'merge' && plan.kind === 'choose' ? plan.pairs.filter(pair => !skipped.has(pair.local)).map(({ local, remote }) => ({ local, remote })) : []
      onView(await invoke('sync:connect', { mode: chosen, pairs, expect: plan.kind }))
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
  return (
    <SettingsCard title="iCloud 동기화" description="iPad와 이 Mac이 사용자의 iCloud Drive에서 과목·PDF·필기·노트를 맞춥니다. 반달 서버에는 아무것도 올리지 않아요.">
      <div className="settings-card__rows">
        {prepared === null && (
          <div className="setting-row">
            <span className="setting-row__description">이 프로필은 아직 동기화하지 않아요.</span>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void prepare()}>
              {busy ? '확인하는 중' : 'iCloud에 연결'}
            </button>
          </div>
        )}
        {prepared !== null && prepared.status !== 'ready' && (
          <div className="setting-row">
            <span className="setting-row__description settings-feedback--error" role="alert">
              {prepared.status === 'error' ? `연결할 수 없어요: ${prepared.message}` : PREPARE_TEXT[prepared.status]}
            </span>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void prepare()}>다시 확인</button>
          </div>
        )}
        {plan !== null && (
          <div className="sync-connect">
            <p className="setting-row__description">{planText(plan)}</p>
            {plan.kind === 'choose' && (
              <div className="sync-connect__modes" role="radiogroup" aria-label="맞추는 방법">
                {([
                  ['merge', '합치기', '두 쪽 자료를 모두 남깁니다. 같은 과목 안의 같은 PDF는 하나로 합칩니다.'],
                  ['overwrite', '이 기기 자료로 덮어쓰기', '이 기기에 없는 과목과 문서는 모든 기기에서 사라집니다. 클라우드 파일은 지우지 않습니다.'],
                  ['import', '클라우드 자료 가져오기', '지금 자료는 이 프로필에 그대로 두고, 백업 뒤 새 프로필로 클라우드 자료를 받습니다.']
                ] as const).map(([value, label, detail]) => (
                  <button key={value} type="button" role="radio" aria-checked={mode === value}
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
  const line = stateLine(view)
  return (
    <>
      <SettingsCard title="iCloud 동기화" description="이 프로필은 이 Mac의 iCloud Drive에 있는 반달 폴더와 맞춥니다.">
        <div className="settings-card__rows">
          <div className="setting-row">
            <div className="setting-row__copy">
              <span className={`setting-row__label sync-state sync-state--${line.tone}`} role="status">{line.text}</span>
              {view.pending > 0 && <span className="setting-row__description">보낼 변경 {view.pending}건</span>}
            </div>
            <button type="button" className="secondary-button" disabled={busy || view.state.state === 'syncing'} onClick={() => void run(() => invoke('sync:now', {}))}>
              지금 동기화
            </button>
          </div>
        </div>
      </SettingsCard>
      <SettingsCard title="기기" description="이 iCloud와 맞추는 기기들이에요. 이 기기의 이름은 충돌 사본 이름에도 쓰여요.">
        <ul className="sync-devices">
          {view.devices.map(device => (
            <li key={device.id}>
              <span>{device.name}{device.self ? ' (이 기기)' : ''}</span>
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
      <SettingsCard>
        <div className="settings-card__rows">
          <div className="setting-row">
            <div className="setting-row__copy">
              <span className="setting-row__label">연결 해제</span>
              <span className="setting-row__description">이 Mac의 동기화를 끕니다. 이 기기의 자료와 iCloud의 파일은 그대로 둡니다.</span>
            </div>
            <button type="button" className="secondary-button settings-advanced-danger-button" disabled={busy} onClick={() => {
              if (window.confirm('이 Mac의 동기화를 끌까요? 자료와 iCloud 파일은 그대로 둡니다.')) void run(() => invoke('sync:disconnect', {}))
            }}>
              연결 해제
            </button>
          </div>
        </div>
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
  if (!view.available) {
    return (
      <div className="settings-stack">
        <SettingsCard title="동기화" description="이 기기에서는 iCloud 동기화를 쓸 수 없어요. Windows용 Google Drive 동기화를 준비하고 있어요.">
          {null}
        </SettingsCard>
      </div>
    )
  }
  return <div className="settings-stack">{view.provider === null ? <ConnectCard onView={setView} /> : <BoundCards view={view} onView={setView} />}</div>
}
