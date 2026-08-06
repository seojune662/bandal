import { useEffect, useId, useRef } from 'react'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'

interface MaterialDeleteDialogProps {
  target: MaterialNode | null
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => Promise<void>
}

function trapFocus(event: KeyboardEvent, dialog: HTMLElement | null): void {
  if (event.key !== 'Tab' || dialog === null) return
  const items = Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
  )
  if (items.length === 0) return
  const first = items[0]
  const last = items.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

export function MaterialDeleteDialog({
  target,
  pending,
  error,
  onClose,
  onConfirm
}: MaterialDeleteDialogProps): JSX.Element | null {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (target === null) return
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) onClose()
      trapFocus(event, dialogRef.current)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, pending, target])

  if (target === null) return null

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="course-dialog course-dialog--confirm material-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="confirm-dialog__icon" aria-hidden="true">
          <Icon name="trash" />
        </div>
        <h2 id={titleId}>삭제할까요?</h2>
        <p id={descriptionId}>
          <strong>{target.name}</strong>을(를) 휴지통으로 이동합니다. Finder의
          휴지통에서 다시 복구할 수 있습니다.
        </p>
        {error !== null && (
          <p className="confirm-dialog__error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={pending}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={pending}
            onClick={() => void onConfirm()}
          >
            {pending ? '이동 중…' : '휴지통으로 이동'}
          </button>
        </footer>
      </section>
    </div>
  )
}
