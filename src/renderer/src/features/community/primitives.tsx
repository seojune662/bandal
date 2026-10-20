import { useId, useRef, type ReactNode } from 'react'
import { useFocusTrap } from '../../components/useFocusTrap'

export function CommunityDialog({ title, onClose, children, busy = false, wide = false }: {
  title: string; onClose: () => void; children: ReactNode; busy?: boolean; wide?: boolean
}): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  useFocusTrap(ref, { active: true, onEscape: busy ? undefined : onClose })
  return <div className="community__backdrop" data-bandal-native-overlay="true" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <section ref={ref} className={`community__dialog${wide ? ' community__dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="community__dialog-header"><h2 id={titleId}>{title}</h2><button type="button" aria-label="닫기" className="community__close" disabled={busy} onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>
}

export function CommunityError({ message, retry }: { message: string | null; retry?: () => void }): JSX.Element | null {
  return message ? <div className="community__error" role="alert"><span>{message}</span>{retry && <button type="button" onClick={retry}>다시 시도</button>}</div> : null
}

export function CommunityField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): JSX.Element {
  return <label className="community__field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function formatCommunityDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '일정 확정 후 안내'
}
