import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { BandalMark } from '../../components/BandalMark'
import { DecorPicker } from '../decor/DecorPicker'
import { useFocusTrap } from '../../components/useFocusTrap'
import { useLocale } from '../../i18n'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { onboardingCopy } from './onboardingCopy'
import { useOnboardingStore } from './onboardingStore'
import { useTourStore } from './tour/tourStore'
import './onboarding.css'

/** A short welcome. Setup is offered where each feature is first used. */
export function OnboardingOverlay(): JSX.Element {
  const dismiss = useOnboardingStore(state => state.dismiss)
  const copy = onboardingCopy(useLocale())
  const [pending, setPending] = useState(false)
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const direct = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    if (await useTourStore.getState().later()) dismiss()
    setPending(false)
  }
  useFocusTrap(dialogRef, { active: true, onEscape: pending ? undefined : () => { void direct() } })
  useEffect(() => acquirePointerPassthrough(), [])
  return <div className="onboarding-overlay" role="presentation">
    <div ref={dialogRef} className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="onboarding-header"><BandalMark size={56} motion="periodic" title="Bandal" />
        <button type="button" className="bare-icon-button" aria-label={copy.close} disabled={pending} onClick={() => { void direct() }}><Icon name="x" /></button>
      </header>
      <div className="onboarding-body"><h2 id={titleId} className="onboarding-title">{copy.welcome}</h2>
        <p className="onboarding-desc">{copy.description}</p><p className="onboarding-tour-note">{copy.tourDescription}</p>
        {/* The decor step (iPad onboarding: 반달의 색을 골라 주세요); the window behind repaints as it is chosen. */}
        <div className="onboarding-decor"><p className="onboarding-decor__title">{copy.decor}</p><DecorPicker compact /></div>
      </div>
      <footer className="onboarding-footer">
        <button type="button" className="button button--secondary" disabled={pending} onClick={() => { void direct() }}>{copy.direct}</button>
        <button type="button" className="button button--primary" disabled={pending} onClick={() => { dismiss(); void useTourStore.getState().start() }}>{copy.tour}</button>
      </footer>
    </div>
  </div>
}
