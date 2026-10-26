import { useRef, type ReactNode } from 'react'
import { Icon } from '../../app/icons'
import { useFocusTrap } from '../../components/useFocusTrap'
import { useT } from '../../i18n'
import './announcement.css'

export interface AnnouncementProps {
  id: string
  title: string
  body: string
  primaryLabel: string
  onPrimary: () => void
  laterLabel: string
  /** Every exit (X, Escape, backdrop, later, primary) ends here. */
  onClose: () => void
  visual: ReactNode
}

/** Centered "NEW" feature announcement: copy on the left, a visual card on the right. */
export function Announcement({ id, title, body, primaryLabel, onPrimary, laterLabel, onClose, visual }: AnnouncementProps): JSX.Element {
  const t = useT()
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(dialogRef, { active: true, initialFocus: primaryRef, onEscape: onClose })
  const titleId = `announcement-${id}-title`

  return (
    <div className="settings-overlay announcement-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="announcement" role="dialog" aria-modal="true" aria-labelledby={titleId} data-announcement={id}>
        <button type="button" className="announcement__close" aria-label={t('help.close')} onClick={onClose}>
          <Icon name="x" />
        </button>
        <div className="announcement__copy">
          <span className="announcement__tag">NEW</span>
          <h2 id={titleId}>{title}</h2>
          <p>{body}</p>
          <div className="announcement__actions">
            <button ref={primaryRef} type="button" className="button button--primary announcement__primary" onClick={() => { onPrimary(); onClose() }}>
              {primaryLabel}
            </button>
            <button type="button" className="announcement__later" onClick={onClose}>{laterLabel}</button>
          </div>
        </div>
        <div className="announcement__visual">{visual}</div>
      </section>
    </div>
  )
}
