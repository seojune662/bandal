import { useCallback, useEffect, useState } from 'react'
import type { BillingState, RuntimeSyncState, RuntimeSyncConflict, SyncConflictVersion } from '../../../../shared/types/subscription'
import { invoke } from '../../lib/ipc'

const reasons: Record<string,string> = {
  subscription_required: '동기화 구독이 필요합니다.', sync_subscription_required: '동기화 구독이 필요합니다.',
  quota_exceeded: '5 GiB 저장 용량을 초과했습니다.', sync_quota_exceeded: '5 GiB 저장 용량을 초과했습니다.',
  authentication_required: '다시 로그인하면 동기화를 계속할 수 있습니다.', auth_required: '다시 로그인하면 동기화를 계속할 수 있습니다.',
  permission_denied: '서버에서 업로드 권한을 거절했습니다. 계정과 구독 상태를 확인해 주세요.',
  network: '인터넷 연결이 복구되면 다시 시도합니다.'
}
const gib = (bytes: number | undefined): string => `${((bytes ?? 0) / 1073741824).toFixed(2)} GiB`
const validBilling = (value: BillingState): boolean => Boolean(value?.subscription && Array.isArray(value.subscription.sources) && value.sync)
const dateLabel = (value?: string): string | null => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : null
function ConflictVersion({ name, version }: { name: string; version: SyncConflictVersion }): JSX.Element {
  return <div><strong>{name}</strong>
    <p>{!version.exists ? '보관된 사본 없음' : version.deleted ? '삭제한 상태' : '자료 보관됨'}
      {version.page !== undefined && ` · ${version.page}쪽`}
      {version.objects !== undefined && ` · 필기·강조 ${version.objects}개`}</p>
    {version.title && <p>{version.title}</p>}
    {dateLabel(version.updatedAt) && <p>마지막 수정: {dateLabel(version.updatedAt)}</p>}
    {version.text && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{version.text}</p>}
  </div>
}
/** Retired Supabase account sync + Paddle billing. Renders only when main enables the legacy flag. */
export function BillingSyncPanel(): JSX.Element | null {
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
    else setMessage('구독 상태를 확인하지 못했습니다. 오프라인 편집은 계속할 수 있어요.')
  }, [])
  useEffect(() => {
    let active = true
    void refresh()
    const timer = window.setInterval(() => { if (active) void invoke('runtime:syncState', {}).then(setSync).catch(() => {}) }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [refresh])
  useEffect(() => {
    let active = true
    if (sync?.conflicts) void invoke('runtime:syncConflicts', {}).then(items => { if (active) setConflicts(items) }).catch(() => {
      if (active) setMessage('복구 목록을 불러오지 못했습니다. 잠시 후 다시 확인합니다. 보관된 변경은 유지됩니다.')
    })
    else setConflicts([])
    return () => { active = false }
  }, [sync])
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action(); await refresh() } catch (error) { setMessage(error instanceof Error ? error.message : '처리하지 못했습니다. 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  const external = (url: string) => invoke('shell:openExternal', { url })
  const recovery = <>
    {(sync?.conflicts ?? 0) > conflicts.length && <p>충돌 {sync?.conflicts}개 중 {conflicts.length}개를 표시합니다. 표시된 항목을 해결하면 나머지를 확인할 수 있어요.</p>}
    {conflicts.map(conflict => <div key={conflict.id} className="settings-card"><strong>{conflict.kind === 'pending-ink' ? '페이지 변경 전 필기 보관됨' : '충돌 사본 보관됨'}</strong>
      <p style={{ overflowWrap: 'anywhere' }}>{conflict.label ?? conflict.recordID ?? '자료 이름 확인 중'}</p>
      {dateLabel(conflict.createdAt) && <p>보관한 시각: {dateLabel(conflict.createdAt)}</p>}
      <p>{conflict.message ?? conflict.reason ?? '양쪽 변경을 보존했습니다. 자료와 복구 사본을 확인한 후 사용할 변경을 선택해 주세요.'}</p>
      {conflict.variants && <div className="sync-conflict-versions">
        <ConflictVersion name="이 기기의 변경" version={conflict.variants.local} />
        <ConflictVersion name="다른 기기의 변경" version={conflict.variants.remote} />
      </div>}
      <div className="account-sign-in-actions">
      {(['local', 'remote'] as const).map(choice => <button key={choice} type="button" className="secondary-button" disabled={busy || (conflict.kind !== 'pending-ink' && conflict.variants?.[choice].exists === false)} onClick={() => void run(async () => {
        const explanation = conflict.kind === 'pending-ink' ? (choice === 'local' ? '변경 전 페이지와 보관된 필기로 복구 노트를 만들까요? 현재 노트는 그대로 보존됩니다.' : '현재 페이지 구성을 유지할까요? 이전 필기는 복구 기록에 보관됩니다.') : `${choice === 'local' ? '이 기기' : '다른 기기'}의 사본을 사용하도록 복구할까요? 양쪽 원본은 복구 기록에 보존됩니다.`
        if (!window.confirm(`${conflict.label ?? conflict.recordID ?? '선택한 자료'}\n\n${explanation}`)) return
        setSync(await invoke('runtime:syncResolveConflict', { id: conflict.id, choice }))
      })}>{conflict.kind === 'pending-ink' ? (choice === 'local' ? '이전 필기로 복구 노트 만들기' : '현재 페이지 유지') : (choice === 'local' ? '이 기기 사본 사용' : '다른 기기 사본 사용')}</button>)}
    </div></div>)}
  </>
  // Account sync is retired, but locally preserved ink (page restructure) must stay recoverable.
  if (sync?.available !== true) {
    if ((sync?.conflicts ?? 0) === 0) return null
    return <section className="settings-card">
      <div className="settings-card__header"><h2>필기 복구</h2><p>보관해 둔 이전 필기를 확인하고 복구 노트를 만들 수 있어요.</p></div>
      {recovery}
      {message && <p role="status">{message}</p>}
    </section>
  }
  return <>
    <section className="settings-card">
      <div className="settings-card__header"><h2>반달 구독</h2><p>같은 계정으로 데스크톱과 iPad에서 5 GiB 동기화를 이용합니다.</p></div>
      <p>{billing ? (billing.subscription.active ? '구독 이용 중' : '활성 구독 없음') : '구독 상태 확인 중'}</p>
      {billing?.subscription.sources.map((source, index) => <p key={`${source.provider}:${index}`}>
        {source.provider === 'apple' ? 'Apple' : 'Paddle'} · {source.active ? '이용 중' : source.status}
        {source.validUntil && ` · ${new Date(source.validUntil).toLocaleDateString()}까지`}
        {source.cancelAtPeriodEnd && ' · 갱신 중단 예정'}
      </p>)}
      {billing?.subscription.duplicateSubscription && <p role="alert">Apple과 Paddle 구독이 함께 활성화되어 있습니다. 저장 용량은 5 GiB이며, 계속 이용할 구매처를 선택해 나머지 구독을 직접 관리해 주세요.</p>}
      <div className="account-sign-in-actions">
        {billing?.provider === 'apple' && !billing.subscription.active && (['monthly', 'annual'] as const).map(plan => {
          const product = billing.products?.find(item => item.plan === plan)
          return <button key={plan} type="button" className="secondary-button" disabled={busy || !product} onClick={() => void run(async () => {
            const result = await invoke('billing:purchase', { plan })
            setBilling(result)
            if (result.status === 'pending') setMessage('구매 승인을 기다리고 있습니다. 승인 후 구독이 적용됩니다.')
          })}>{plan === 'monthly' ? '월간' : '연간'} 구독{product ? ` · ${product.displayPrice}` : ' · 상품 확인 중'}</button>
        })}
        {billing?.provider === 'apple' && <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { await invoke('billing:restore', {}); setMessage('구매 내역을 확인했습니다. 구매 당시 반달 계정에만 적용됩니다.') })}>구매 복원</button>}
        {billing?.provider === 'paddle' && <button type="button" className="secondary-button" disabled={busy} onClick={() => void external('https://bandal.io/billing')}>구독 관리 · 월 4,900원 / 연 49,000원</button>}
        {(billing?.provider === 'apple' || billing?.subscription.sources.some(source => source.provider === 'apple')) && <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { await invoke('billing:manageApple', {}) })}>Apple 구독 관리</button>}
        {billing?.provider === 'apple' && billing.subscription.sources.some(source => source.provider === 'paddle') && <p>Paddle에서 구매한 구독은 구매 확인 이메일의 구독 관리 경로에서 변경할 수 있어요.</p>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => { setBilling(await invoke('billing:refresh', {})) })}>구독 새로고침</button>
      </div>
      <p>구독은 선택한 기간마다 자동 갱신됩니다. 다음 결제를 원하지 않으면 구매처의 구독 관리에서 갱신을 중단해 주세요.</p>
      <p><button type="button" className="secondary-button" onClick={() => void external('https://bandal.io/terms')}>이용약관</button> <button type="button" className="secondary-button" onClick={() => void external('https://bandal.io/privacy')}>개인정보처리방침</button></p>
      <p>구독 만료 후에도 로컬 편집과 허용된 기존 자료 다운로드는 유지됩니다. 구독 만료로 자료를 삭제하지 않습니다.</p>
    </section>
    <section className="settings-card">
      <div className="settings-card__header"><h2>모든 과목 동기화</h2><p>과목·자료·PDF 노트·마크다운·필기를 동기화합니다. AI 대화·학습 진도·녹음 세션은 이 기기에 보관합니다.</p></div>
      {!sync?.enabled && <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> 현재와 앞으로 만드는 모든 과목을 이 반달 계정의 클라우드에 동기화하는 데 동의합니다.</label>}
      <div className="account-sign-in-actions">
        <button type="button" className="secondary-button" disabled={busy || (!sync?.enabled && !consent)} onClick={() => void run(async () => { setSync(await invoke('runtime:syncSetEnabled', { enabled: !sync?.enabled })) })}>{sync?.enabled ? '동기화 끄기' : '동기화 켜기'}</button>
        <button type="button" className="secondary-button" disabled={busy || !sync?.enabled} onClick={() => void run(async () => { setSync(await invoke('runtime:syncNow', {})) })}>지금 동기화</button>
      </div>
      <p>최근 완료: {sync?.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString() : '아직 없음'} · 대기 변경: {sync?.pending ?? 0} · 충돌: {sync?.conflicts ?? 0}</p>
      <p>저장 용량: {gib(sync?.storageUsedBytes ?? billing?.sync.storageUsedBytes)} / 5 GiB</p>
      <p>복구를 위해 보관된 과거 파일 버전도 용량에 포함됩니다.</p>
      {sync?.blockedReason && <p role="status">{reasons[sync.blockedReason] ?? sync.message ?? sync.blockedReason} 업로드하지 못한 변경은 이 기기에 보관합니다.</p>}
      {sync?.retryAt && <p>다음 재시도: {new Date(sync.retryAt).toLocaleTimeString()}</p>}
      {recovery}
    </section>
    {message && <p role="status">{message}</p>}
  </>
}
