import { useEffect, useRef, useState } from 'react'
import { Columns3, LayoutGrid, Palette } from 'lucide-react'
import type { ThemePreference } from '../../../../shared/types/settings'
import { useFocusTrap } from '../../components/useFocusTrap'
import { useLocale } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { ensureSettingsLoaded } from '../../stores/settingsSnapshot'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'
import { shouldShowOnboarding } from '../onboarding/onboardingModel'
import { useTourStore } from '../onboarding/tour/tourStore'
import { DecorPicker, DecorPreview } from '../decor/DecorPicker'
import './design-refresh.css'

/** Settings ids allow [a-z0-9-] only, hence the dashed version. */
export const DESIGN_REFRESH_ID = 'design-refresh-0-96'
/** Reopens the greeting regardless of dismissal (screenshots, help). */
export const OPEN_DESIGN_REFRESH_EVENT = 'bandal:open-design-refresh'
const SHOW_DELAY_MS = 1200
const THEMES: readonly ThemePreference[] = ['light', 'dark', 'system']

export async function dismissAnnouncement(id: string): Promise<void> {
  const settings = await ensureSettingsLoaded()
  if (settings.dismissedAnnouncements.includes(id)) return
  await invoke('settings:set', { dismissedAnnouncements: [...settings.dismissedAnnouncements, id] })
}

/**
 * The once-after-update greeting for the iPad-style redesign. Returning users
 * (onboarding already done) see it once; new users choose their colour in
 * onboarding instead. Every change applies to the window behind it at once.
 */
export function DesignRefreshAnnouncement({ mainScreenVisible }: { mainScreenVisible: boolean }): JSX.Element | null {
  const ko = useLocale() === 'ko-KR'
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const tourIdle = useTourStore(state => state.status === 'idle')
  const signingIn = useAuthStore(state => state.auth.phase === 'signing-in')
  const theme = useUiStore(state => state.themePreference)
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    void ensureSettingsLoaded().then(settings => {
      if (active && !shouldShowOnboarding(settings.onboarding) && !settings.dismissedAnnouncements.includes(DESIGN_REFRESH_ID)) setPending(true)
    }).catch((error: unknown) => console.error('[Bandal] 공지 상태를 불러오지 못했습니다.', error))
    const reopen = (): void => setOpen(true)
    window.addEventListener(OPEN_DESIGN_REFRESH_EVENT, reopen)
    return () => { active = false; window.removeEventListener(OPEN_DESIGN_REFRESH_EVENT, reopen) }
  }, [])

  const ready = pending && mainScreenVisible && tourIdle && !signingIn
  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => { setPending(false); setOpen(true) }, SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [ready])

  const close = (): void => {
    setOpen(false)
    setPending(false)
    void dismissAnnouncement(DESIGN_REFRESH_ID).catch((error: unknown) => console.error('[Bandal] 공지 닫힘을 저장하지 못했습니다.', error))
  }
  useFocusTrap(dialogRef, { active: open, initialFocus: primaryRef, onEscape: close })
  if (!open) return null

  const changes = ko
    ? [
        { icon: <Columns3 size={16} strokeWidth={1.75} />, text: '왼쪽 레일에서 홈과 AI를 같은 자리에 열고 닫아요' },
        { icon: <LayoutGrid size={16} strokeWidth={1.75} />, text: '자주 가는 학교·AI 사이트가 타일로 모였어요' },
        { icon: <Palette size={16} strokeWidth={1.75} />, text: '창의 색과 세기를 직접 고를 수 있어요' }
      ]
    : [
        { icon: <Columns3 size={16} strokeWidth={1.75} />, text: 'Home and AI open in the same spot from the rail' },
        { icon: <LayoutGrid size={16} strokeWidth={1.75} />, text: 'Your school and AI sites are now tiles' },
        { icon: <Palette size={16} strokeWidth={1.75} />, text: 'Pick the window’s color and strength' }
      ]
  const themeLabel = (value: ThemePreference): string => ko
    ? ({ light: '라이트', dark: '다크', system: '시스템' } as Record<string, string>)[value] ?? value
    : ({ light: 'Light', dark: 'Dark', system: 'System' } as Record<string, string>)[value] ?? value

  return (
    <div className="settings-overlay design-refresh-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <section ref={dialogRef} className="design-refresh" role="dialog" aria-modal="true" aria-labelledby="design-refresh-title" data-announcement={DESIGN_REFRESH_ID}>
        <header className="design-refresh__header">
          <span className="design-refresh__mark" aria-hidden="true" />
          <h2 id="design-refresh-title">{ko ? '반달이 새로워졌어요' : 'Bandal has a new look'}</h2>
          <p>{ko ? 'iPad와 같은 화면으로 다듬었어요. 마음에 드는 색을 골라 보세요.' : 'Redesigned to match the iPad app. Pick a color you like.'}</p>
        </header>
        <DecorPreview />
        <div className="design-refresh__card">
          <div className="design-refresh__theme">
            <span>{ko ? '모양' : 'Appearance'}</span>
            <div className="design-refresh__segmented" role="radiogroup" aria-label={ko ? '모양 선택' : 'Choose appearance'}>
              {THEMES.map(value => (
                <button key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => void useUiStore.getState().setThemePreference(value)}>
                  {themeLabel(value)}
                </button>
              ))}
            </div>
          </div>
          <DecorPicker compact />
        </div>
        <ul className="design-refresh__changes">
          {changes.map(change => <li key={change.text}><span aria-hidden="true">{change.icon}</span>{change.text}</li>)}
        </ul>
        <div className="design-refresh__actions">
          <button ref={primaryRef} type="button" className="design-refresh__primary" onClick={close}>{ko ? '시작하기' : 'Get started'}</button>
          <button type="button" className="design-refresh__later" onClick={() => { close(); useUiStore.getState().openSettings('appearance') }}>{ko ? '설정에서 더 보기' : 'More in Settings'}</button>
        </div>
      </section>
    </div>
  )
}
