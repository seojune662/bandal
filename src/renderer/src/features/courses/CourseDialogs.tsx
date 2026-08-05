import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import {
  COURSE_COLORS,
  courseColorLabel,
  type CourseColor
} from './courseColors'

interface CourseFormDialogProps {
  open: boolean
  mode: 'create' | 'rename'
  initialName?: string
  initialColor?: CourseColor
  onClose: () => void
  onSubmit: (name: string, color: CourseColor) => Promise<void>
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : '저장하지 못했습니다.'
}

function keepFocusInside(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || container === null) return
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
  )
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (first === undefined || last === undefined) return

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export function CourseFormDialog({
  open,
  mode,
  initialName = '',
  initialColor = 'gold',
  onClose,
  onSubmit
}: CourseFormDialogProps): JSX.Element | null {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState<CourseColor>(initialColor)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const errorId = useId()
  const inputId = useId()
  const creating = mode === 'create'

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setColor(initialColor)
    setError(null)
    setPending(false)
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [initialColor, initialName, open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) onClose()
      keepFocusInside(event, dialogRef.current)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open, pending])

  if (!open) return null

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const normalizedName = name.trim()
    if (normalizedName.length === 0) {
      setError('과목 이름을 입력해주세요.')
      inputRef.current?.focus()
      return
    }

    setPending(true)
    setError(null)
    try {
      await onSubmit(normalizedName, color)
      onClose()
    } catch (submitError) {
      setError(messageFrom(submitError))
      setPending(false)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="course-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="course-dialog__header">
          <div>
            <p className="eyebrow">COURSE</p>
            <h2 id={titleId}>{creating ? '새 과목' : '과목 이름 변경'}</h2>
          </div>
          <button
            type="button"
            className="bare-icon-button"
            aria-label="닫기"
            disabled={pending}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <label className="field-label" htmlFor={inputId}>
            이름
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="text-field"
            value={name}
            placeholder="예: 자료구조"
            autoComplete="off"
            aria-describedby={error === null ? undefined : errorId}
            aria-invalid={error !== null}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
          />

          {creating && (
            <fieldset className="color-fieldset">
              <legend className="field-label">색상</legend>
              <div className="color-palette">
                {COURSE_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="color-swatch"
                    data-course-color={option}
                    data-selected={color === option}
                    aria-label={courseColorLabel(option)}
                    aria-pressed={color === option}
                    disabled={pending}
                    onClick={() => setColor(option)}
                  >
                    <span className="color-swatch__fill" />
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {error !== null && (
            <p id={errorId} className="form-error" role="alert">
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
              type="submit"
              className="button button--primary"
              disabled={pending}
            >
              {pending ? '저장 중…' : creating ? '과목 만들기' : '변경하기'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

interface DeleteCourseDialogProps {
  courseName: string | null
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function DeleteCourseDialog({
  courseName,
  pending,
  error,
  onClose,
  onConfirm
}: DeleteCourseDialogProps): JSX.Element | null {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (courseName === null) return
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) onClose()
      keepFocusInside(event, dialogRef.current)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [courseName, onClose, pending])

  if (courseName === null) return null

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="course-dialog course-dialog--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="confirm-dialog__icon" aria-hidden="true">
          <Icon name="trash" />
        </div>
        <h2 id={titleId}>과목을 삭제할까요?</h2>
        <p>
          <strong>{courseName}</strong> 과목이 목록에서 사라집니다. 자료 폴더는
          디스크에 그대로 남습니다.
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
            {pending ? '삭제 중…' : '삭제'}
          </button>
        </footer>
      </section>
    </div>
  )
}
