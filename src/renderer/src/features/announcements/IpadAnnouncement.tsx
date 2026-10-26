import { useEffect, useState } from 'react'
import { IPAD_APP_STORE_URL } from '../../../../shared/appLinks'
import { showToast } from '../../app/toast'
import { useT } from '../../i18n'
import { invoke } from '../../lib/ipc'
import { ensureSettingsLoaded } from '../../stores/settingsSnapshot'
import { useAuthStore } from '../../stores/authStore'
import { shouldShowOnboarding } from '../onboarding/onboardingModel'
import { useTourStore } from '../onboarding/tour/tourStore'
import { Announcement } from './Announcement'
import screenshot from './assets/ipad-screenshot.webp?inline'
import qrCode from './assets/ipad-app-store-qr.svg?inline'

export const IPAD_ANNOUNCEMENT_ID = 'ipad-launch-2026-10'
/** Help menu → "iPad 앱 받기" reopens the announcement regardless of dismissal. */
export const OPEN_IPAD_ANNOUNCEMENT_EVENT = 'bandal:open-ipad-announcement'
/** Let the main screen settle before a modal covers it. */
const SHOW_DELAY_MS = 1200

async function dismissAnnouncement(id: string): Promise<void> {
  const settings = await ensureSettingsLoaded()
  if (settings.dismissedAnnouncements.includes(id)) return
  await invoke('settings:set', { dismissedAnnouncements: [...settings.dismissedAnnouncements, id] })
}

interface IpadAnnouncementProps {
  /** False while onboarding or settings cover the main screen. */
  mainScreenVisible: boolean
}

export function IpadAnnouncement({ mainScreenVisible }: IpadAnnouncementProps): JSX.Element | null {
  const t = useT()
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const tourIdle = useTourStore((state) => state.status === 'idle')
  const signingIn = useAuthStore((state) => state.auth.phase === 'signing-in')

  useEffect(() => {
    let active = true
    void ensureSettingsLoaded().then((settings) => {
      // First-run users meet onboarding this launch; existing users (updates) get the news.
      if (active && !shouldShowOnboarding(settings.onboarding) && !settings.dismissedAnnouncements.includes(IPAD_ANNOUNCEMENT_ID)) setPending(true)
    }).catch((error: unknown) => console.error('[Bandal] 공지 상태를 불러오지 못했습니다.', error))
    const reopen = (): void => setOpen(true)
    window.addEventListener(OPEN_IPAD_ANNOUNCEMENT_EVENT, reopen)
    return () => { active = false; window.removeEventListener(OPEN_IPAD_ANNOUNCEMENT_EVENT, reopen) }
  }, [])

  const ready = pending && mainScreenVisible && tourIdle && !signingIn
  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => { setPending(false); setOpen(true) }, SHOW_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [ready])

  if (!open) return null
  const close = (): void => {
    setOpen(false)
    setPending(false)
    void dismissAnnouncement(IPAD_ANNOUNCEMENT_ID).catch((error: unknown) => console.error('[Bandal] 공지 닫힘을 저장하지 못했습니다.', error))
  }
  return (
    <Announcement
      id={IPAD_ANNOUNCEMENT_ID}
      title={t('announcement.ipad.title')}
      body={t('announcement.ipad.body')}
      primaryLabel={t('announcement.ipad.primary')}
      onPrimary={() => { void invoke('shell:openExternal', { url: IPAD_APP_STORE_URL }).catch(() => showToast(t('help.linkFailed'), 'danger')) }}
      laterLabel={t('announcement.later')}
      onClose={close}
      visual={
        <>
          <div className="ipad-visual__device">
            <img src={screenshot} width={1100} height={825} alt={t('announcement.ipad.screenshotAlt')} />
          </div>
          <div className="ipad-visual__qr">
            <img src={qrCode} width={76} height={76} alt={t('announcement.ipad.qrAlt')} />
            <span>{t('announcement.ipad.scan')}</span>
          </div>
        </>
      }
    />
  )
}
