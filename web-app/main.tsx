/**
 * Entry of bandal.io/app.
 * - Signs the person in with Google and finds their Bandal sync folder in Drive.
 * - Opens the production AppShell on that workspace (`shell.tsx`, loaded only
 *   once the workspace is ready, so stores hydrate from real data).
 * - With a remembered account, a visit signs in silently and lands straight
 *   in the person's own screen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { setLocale } from '../src/renderer/src/i18n'
import '../src/renderer/src/styles/tokens.css'
import '../src/renderer/src/styles/base.css'
import './web-app.css'
import { accountHint, clientId, currentToken, rememberAccount, signIn, signOut, silentAttemptedRecently, storageAvailable, takeRedirect, type RedirectOutcome } from './google'
import { createDrive, DriveError, type DriveAccount } from './drive'
import { loadWorkspace } from './workspace'
import { attachWorkspace, detachWorkspace, ko, loadSettings, resolveMedia } from './adapter'
import { installMediaBridge } from './media'

setLocale(ko ? 'ko-KR' : 'en-US')
document.documentElement.lang = ko ? 'ko' : 'en'

/** The website's appearance choice (`bandal-appearance`), so /app opens in the same light or dark. */
function websiteTheme(): 'light' | 'dark' {
  let stored: unknown = null
  try { stored = (JSON.parse(localStorage.getItem('bandal-appearance') || '{}') as { theme?: unknown }).theme } catch { /* Defaults below. */ }
  if (stored === 'light' || stored === 'sepia' || stored === 'high-contrast') return 'light'
  if (stored === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return 'dark'
}
document.documentElement.dataset.theme = websiteTheme()

const t = (koText: string, enText: string): string => (ko ? koText : enText)

type Phase =
  | { kind: 'unconfigured' }
  | { kind: 'signed-out'; message?: string | undefined }
  | { kind: 'redirecting' }
  | { kind: 'loading'; step: string; done?: number; total?: number }
  | { kind: 'no-root'; account: DriveAccount }
  | { kind: 'blocked'; account: DriveAccount; reason: string }
  | { kind: 'error'; message: string; retry: boolean }
  | { kind: 'ready'; account: DriveAccount; summary: { courses: number; errors: number; waiting: number } }

const redirectMessage = (outcome: RedirectOutcome): string | undefined => {
  if (outcome.kind !== 'error') return undefined
  if (outcome.code === 'access_denied') return t('Google 로그인을 취소했어요.', 'Google sign-in was cancelled.')
  if (outcome.code === 'scope_denied') return t('Google Drive 접근을 허용해야 반달 자료를 열 수 있어요. 다시 로그인하고 Drive 항목을 체크해 주세요.', 'Allow Google Drive access to open your Bandal material.')
  if (outcome.code === 'state_mismatch') return t('안전한 로그인 연결을 확인하지 못했어요. 다시 로그인해 주세요.', 'Could not verify the sign-in. Please try again.')
  return t('로그인을 마치지 못했어요. 다시 시도해 주세요.', 'Sign-in did not complete. Please try again.')
}

function driveMessage(error: unknown): { message: string; retry: boolean } {
  const code = error instanceof DriveError ? error.code : (error as Error)?.message
  if (code === 'offline') return { message: t('Google Drive에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', 'Could not reach Google Drive. Check your connection.'), retry: true }
  if (code === 'rate_limited') return { message: t('Google Drive 요청이 많아요. 잠시 뒤 다시 시도해 주세요.', 'Google Drive is rate limiting. Try again shortly.'), retry: true }
  if (code === 'unavailable') return { message: t('Google Drive가 잠시 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.', 'Google Drive is not responding. Try again shortly.'), retry: true }
  if (code === 'service_worker_unavailable') return { message: t('이 브라우저에서는 웹 반달을 열 수 없어요. 일반 창의 최신 Chrome, Edge, Safari, Firefox에서 열어 주세요.', 'This browser cannot open Bandal on the web. Use a current browser outside private mode.'), retry: false }
  return { message: t('반달 자료를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.', 'Could not load your Bandal material.'), retry: true }
}

function initialPhase(): Phase {
  if (!clientId()) return { kind: 'unconfigured' }
  if (!storageAvailable()) return { kind: 'signed-out', message: t('이 브라우저에서 세션 저장소를 사용할 수 없어요. 일반 창에서 다시 열어 주세요.', 'Session storage is unavailable. Open this page in a normal window.') }
  const outcome = takeRedirect()
  if (currentToken()) return { kind: 'loading', step: t('Google Drive에 연결하는 중', 'Connecting to Google Drive') }
  const hint = accountHint()
  // A returning person: sign in silently and land in their own screen. Never loop through Google.
  if (outcome.kind === 'none' && hint && !silentAttemptedRecently()) {
    signIn({ silent: true, loginHint: hint })
    return { kind: 'redirecting' }
  }
  return { kind: 'signed-out', message: redirectMessage(outcome) }
}

let Shell: React.ComponentType<{ account: DriveAccount; onRefresh(): void; onSignOut(): void }> | null = null

function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const cache = useRef(new Map<string, { md5: string; bytes: Uint8Array }>())
  const loading = useRef(false)

  const load = useCallback(async () => {
    if (loading.current) return
    const token = currentToken()
    if (!token) {
      const hint = accountHint()
      if (hint && !silentAttemptedRecently()) { setPhase({ kind: 'redirecting' }); signIn({ silent: true, loginHint: hint }); return }
      setPhase({ kind: 'signed-out', message: t('로그인이 만료됐어요. 다시 로그인해 주세요.', 'Your session expired. Please sign in again.') })
      return
    }
    loading.current = true
    const drive = createDrive(() => currentToken()?.access ?? token.access)
    try {
      setPhase({ kind: 'loading', step: t('Google Drive에 연결하는 중', 'Connecting to Google Drive') })
      const [account] = await Promise.all([drive.account(), installMediaBridge(resolveMedia)])
      rememberAccount(account.email)
      setPhase({ kind: 'loading', step: t('반달 폴더를 찾는 중', 'Finding your Bandal folder') })
      const result = await loadWorkspace(drive, cache.current, (done, total) => setPhase({ kind: 'loading', step: t('자료를 맞추는 중', 'Syncing your material'), done, total }))
      if (result.status === 'no-root') { setPhase({ kind: 'no-root', account }); return }
      if (result.status === 'blocked') { setPhase({ kind: 'blocked', account, reason: result.reason }); return }
      attachWorkspace({ workspace: result.workspace, drive, cache: cache.current })
      loadSettings()
      Shell ??= (await import('./shell')).Shell
      setPhase({ kind: 'ready', account, summary: { courses: result.workspace.courses.length, errors: result.workspace.errors.length, waiting: result.workspace.waiting } })
    } catch (error) {
      if (error instanceof DriveError && error.code === 'unauthorized') {
        signOut({ forgetAccount: false })
        const hint = accountHint()
        if (hint && !silentAttemptedRecently()) { setPhase({ kind: 'redirecting' }); signIn({ silent: true, loginHint: hint }); return }
        setPhase({ kind: 'signed-out', message: t('로그인이 만료됐어요. 다시 로그인해 주세요.', 'Your session expired. Please sign in again.') })
        return
      }
      setPhase({ kind: 'error', ...driveMessage(error) })
    } finally {
      loading.current = false
    }
  }, [])

  useEffect(() => { if (phase.kind === 'loading') void load() }, [])

  const logout = useCallback(() => {
    signOut({ forgetAccount: true })
    detachWorkspace()
    cache.current.clear()
    // A fresh page drops every store and every downloaded byte with it.
    location.replace(import.meta.env.BASE_URL)
  }, [])

  if (phase.kind === 'ready' && Shell) return <Shell account={phase.account} onRefresh={() => void load()} onSignOut={logout} />
  return <Gate phase={phase} onSignIn={() => { setPhase({ kind: 'redirecting' }); signIn({ loginHint: accountHint() }) }} onRetry={() => void load()} onSignOut={logout} />
}

function Gate({ phase, onSignIn, onRetry, onSignOut }: { phase: Phase; onSignIn(): void; onRetry(): void; onSignOut(): void }): React.JSX.Element {
  const busy = phase.kind === 'redirecting' || phase.kind === 'loading'
  return <main className="web-gate" aria-busy={busy}>
    <section className="web-gate-card">
      <a className="web-gate-brand" href="/"><span className="web-gate-moon" aria-hidden="true" />{t('반달', 'Bandal')}</a>
      {phase.kind === 'unconfigured' && <>
        <h1>{t('웹 반달을 준비하고 있어요', 'Bandal on the web is coming')}</h1>
        <p>{t('곧 브라우저에서도 내 과목과 필기를 열 수 있어요. 지금은 설치한 반달 앱을 이용해 주세요.', 'Soon you can open your courses and notes in the browser. Use the desktop app for now.')}</p>
        <a className="web-gate-primary" href="/">{t('반달 내려받기', 'Download Bandal')}</a>
      </>}
      {(phase.kind === 'signed-out' || phase.kind === 'redirecting') && <>
        <h1>{t('브라우저에서 반달 열기', 'Open Bandal in your browser')}</h1>
        <p>{t('반달 앱에서 Google Drive 동기화를 켠 계정으로 로그인하면 내 과목, PDF, 필기를 바로 볼 수 있어요.', 'Sign in with the Google account you sync Bandal with to see your courses, PDFs and notes.')}</p>
        {phase.kind === 'signed-out' && phase.message && <p className="web-gate-alert" role="alert">{phase.message}</p>}
        <button className="web-gate-primary" type="button" onClick={onSignIn} disabled={phase.kind === 'redirecting'}>
          <span className="web-gate-g" aria-hidden="true">G</span>{phase.kind === 'redirecting' ? t('Google로 이동하는 중…', 'Opening Google…') : t('Google로 계속하기', 'Continue with Google')}
        </button>
        <ul className="web-gate-notes">
          <li>{t('반달 서버에는 내 자료를 올리지 않아요. 내 Google Drive의 반달 폴더를 이 브라우저에서 직접 읽어요.', 'Your material never goes to Bandal servers. This browser reads your own Drive folder directly.')}</li>
          <li>{t('지금은 보기 전용이에요. 편집은 반달 앱에서 하면 자동으로 맞춰져요.', 'View-only for now. Edits in the app sync here.')}</li>
          <li>{t('iCloud로 동기화하는 자료는 웹에서 열 수 없어요.', 'Material synced with iCloud cannot be opened on the web.')}</li>
        </ul>
      </>}
      {phase.kind === 'loading' && <>
        <h1>{phase.step}</h1>
        <div className="web-gate-progress" role="progressbar" aria-valuemin={0} aria-valuemax={phase.total || undefined} aria-valuenow={phase.total ? phase.done : undefined}>
          <span style={phase.total ? { width: `${Math.round(((phase.done ?? 0) / phase.total) * 100)}%` } : undefined} data-indeterminate={!phase.total || undefined} />
        </div>
        {phase.total ? <p className="web-gate-muted">{t(`파일 ${phase.done ?? 0} / ${phase.total}`, `${phase.done ?? 0} of ${phase.total} files`)}</p> : null}
      </>}
      {phase.kind === 'no-root' && <>
        <h1>{t('Google Drive에 반달 폴더가 없어요', 'No Bandal folder in Google Drive')}</h1>
        <p>{t(`${phase.account.email ?? '이 계정'}에서 반달 동기화 폴더를 찾지 못했어요. 반달 앱의 설정 › 동기화에서 Google Drive를 연결한 계정인지 확인해 주세요.`, `No Bandal sync folder was found for ${phase.account.email ?? 'this account'}. Connect Google Drive in the app under Settings › Sync.`)}</p>
        <button className="web-gate-primary" type="button" onClick={onSignOut}>{t('다른 계정으로 로그인', 'Use another account')}</button>
        <button className="web-gate-secondary" type="button" onClick={onRetry}>{t('다시 확인', 'Check again')}</button>
      </>}
      {phase.kind === 'blocked' && <>
        <h1>{phase.reason === 'update-required' ? t('더 새로운 반달 형식이에요', 'A newer Bandal format') : t('이 폴더를 열 수 없어요', 'This folder cannot be opened')}</h1>
        <p>{phase.reason === 'update-required'
          ? t('다른 기기의 반달이 더 새로운 동기화 형식을 쓰고 있어요. 웹 반달이 업데이트되면 열 수 있어요.', 'Another device uses a newer sync format. It will open once the web app updates.')
          : t('반달 폴더의 형식을 확인하지 못했어요. 반달 앱에서 동기화 상태를 확인해 주세요.', 'The Bandal folder format could not be read. Check sync in the app.')}</p>
        <button className="web-gate-secondary" type="button" onClick={onSignOut}>{t('로그아웃', 'Sign out')}</button>
      </>}
      {phase.kind === 'error' && <>
        <h1>{t('열지 못했어요', 'Could not open')}</h1>
        <p className="web-gate-alert" role="alert">{phase.message}</p>
        {phase.retry && <button className="web-gate-primary" type="button" onClick={onRetry}>{t('다시 시도', 'Try again')}</button>}
        <button className="web-gate-secondary" type="button" onClick={onSignOut}>{t('로그아웃', 'Sign out')}</button>
      </>}
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
