import { useEffect, useState, type ReactNode } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { invoke } from '../../lib/ipc'
import './account-access.css'

export function AccountAccessGate({ children }: { children: ReactNode }): JSX.Element {
  const { auth, hydrated, init, signIn } = useAuthStore()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { void init() }, [init])
  useEffect(() => {
    const resume = () => {
      if (!useAuthStore.getState().auth.localAccess?.allowed) return
      void invoke('runtime:syncState', {}).then(state => state.enabled ? invoke('runtime:syncNow', {}) : undefined).catch(() => {})
    }
    window.addEventListener('online', resume)
    return () => window.removeEventListener('online', resume)
  }, [])
  if (hydrated && auth.localAccess?.allowed) return <>{children}</>
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '요청을 완료하지 못했습니다.') }
    finally { setBusy(false) }
  }
  const binding = auth.localAccess?.requiresBindingConfirmation && auth.localAccess.pendingUserID
  return <main className="account-access" data-bandal-native-overlay="true">
    <section className="account-access__card" aria-labelledby="account-access-title">
      <span className="account-access__moon" aria-hidden="true">◐</span>
      <h1 id="account-access-title">{binding ? '이 기기의 자료를 연결할 계정' : '반달에 로그인'}</h1>
      {!hydrated ? <p role="status">계정 연결을 확인하고 있어요.</p> : binding ? <>
        <p><strong>{auth.email ?? auth.profile?.nickname ?? '현재 로그인한 계정'}</strong>에 이 기기의 자료를 연결합니다. 이후 다른 계정은 백업 후 새 프로필에서 사용할 수 있어요.</p>
        <p>계정 연결만으로 자료를 업로드하지 않습니다. 동기화는 계정 설정에서 별도로 켤 수 있어요.</p>
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          const next = await invoke('auth:confirmProfile', { userID: String(binding) })
          useAuthStore.setState({ auth: next })
        })}>이 계정에 연결하고 시작</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(() => useAuthStore.getState().signOut())}>다른 계정으로 로그인</button>
      </> : <>
        <p>처음 한 번 로그인하면 인터넷이 없어도 이 기기의 자료를 편집할 수 있어요.</p>
        {auth.errorCode === 'storage' && <p role="alert">계정 연결 기록을 읽거나 저장하지 못했습니다. 자료를 백업한 뒤 다시 시도해 주세요.</p>}
        {auth.errorCode === 'network' && <p role="alert">인증 서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 로그인해 주세요.</p>}
        {auth.errorCode === 'provider' && <p role="alert">로그인을 완료하지 못했습니다. 로그인 수단과 계정을 확인해 주세요.</p>}
        {auth.errorCode === 'profile-mismatch' && <p role="alert">이 자료는 다른 계정에 연결되어 있습니다. 원래 계정으로 로그인하거나 백업 후 새 프로필을 만들어 주세요.</p>}
        {auth.phase === 'unconfigured' ? <p role="alert">이 설치본에 로그인 설정이 없습니다. 앱을 업데이트하거나 지원에 문의해 주세요.</p> : <div className="account-access__providers">
          {(['apple', 'google', 'kakao'] as const).map(provider => <button type="button" key={provider} disabled={busy || auth.phase === 'signing-in'} onClick={() => void run(async () => {
            const result = await signIn(provider)
            if (!result.ok) throw new Error('로그인을 시작하지 못했어요. 인터넷 연결과 계정 설정을 확인해 주세요.')
            setMessage('로그인 화면에서 인증을 완료해 주세요.')
          })}>{provider === 'apple' ? 'Apple' : provider === 'google' ? 'Google' : 'Kakao'}로 계속</button>)}
          {auth.phase === 'signed-in' && <button type="button" className="secondary-button" onClick={() => void run(() => useAuthStore.getState().signOut())}>다시 로그인</button>}
          {auth.phase === 'signing-in' && <button type="button" className="secondary-button" onClick={() => void run(() => useAuthStore.getState().signOut())}>로그인 다시 시작</button>}
        </div>}
      </>}
      <div className="account-access__backup">
        <button type="button" className="secondary-button" disabled={busy || !hydrated} onClick={() => void run(async () => {
          const result = await invoke('profile:backup', {})
          if (result.ok) setMessage('전체 자료 백업과 파일 검증을 완료했어요.')
        })}>로그인 전 자료 백업·내보내기</button>
        <button type="button" className="secondary-button" disabled={busy || !hydrated} onClick={() => void run(async () => {
          if (!window.confirm('전체 자료를 백업하고 검증한 뒤 빈 프로필로 다시 시작합니다. 기존 프로필과 원본 자료는 보존됩니다. 계속할까요?')) return
          await invoke('profile:new', {})
        })}>백업 후 새 프로필</button>
      </div>
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">처리 중입니다…</p>}
    </section>
  </main>
}
