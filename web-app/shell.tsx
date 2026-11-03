import React, { useEffect, useState } from 'react'
import { AppShell } from '../src/renderer/src/app/AppShell'
import { RendererErrorBoundary } from '../src/renderer/src/app/RendererErrorBoundary'
import type { DriveAccount } from './drive'
import { ko } from './adapter'

const t = (koText: string, enText: string): string => (ko ? koText : enText)

/** The production desktop shell under a thin web bar: account, view-only status, refresh and sign out. */
export function Shell({ account, onRefresh, onSignOut }: { account: DriveAccount; onRefresh(): void; onSignOut(): void }): React.JSX.Element {
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const unavailable = () => setNotice(t('웹 반달은 지금 보기 전용이에요. 편집과 이 기능은 설치한 반달 앱에서 사용할 수 있어요.', 'Bandal on the web is view-only for now. Edit in the desktop app.'))
    window.addEventListener('bandal-web-unavailable', unavailable)
    return () => window.removeEventListener('bandal-web-unavailable', unavailable)
  }, [])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer) }, [notice])
  return <div className="web-app">
    <header className="web-bar">
      <a className="web-bar-brand" href="/" aria-label={t('반달 홈', 'Bandal home')}><span className="web-gate-moon" aria-hidden="true" />{t('반달', 'Bandal')}</a>
      <span className="web-bar-badge" title={t('편집은 반달 앱에서 할 수 있어요', 'Edit in the desktop app')}>{t('보기 전용', 'View only')}</span>
      <span className="web-bar-source">{t('Google Drive에서 읽는 중', 'Reading from Google Drive')}</span>
      <span className="web-bar-spacer" />
      <button type="button" onClick={onRefresh}>{t('새로 맞추기', 'Refresh')}</button>
      <span className="web-bar-account" title={account.email ?? undefined}>{account.email ?? account.name ?? ''}</span>
      <button type="button" onClick={onSignOut}>{t('로그아웃', 'Sign out')}</button>
    </header>
    <div className="web-app-body"><RendererErrorBoundary><AppShell /></RendererErrorBoundary></div>
    {notice && <div className="web-notice" role="status">{notice}<button type="button" aria-label={t('알림 닫기', 'Dismiss')} onClick={() => setNotice('')}>×</button></div>}
  </div>
}
