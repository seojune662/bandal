import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import type { BoardTask } from '../../../../shared/types/board'
import type { Course } from '../../../../shared/types/course'
import { Icon } from '../../app/icons'
import { normalizeCourseColor } from '../courses/courseColors'

export interface TaskEditorDraft {
  title: string
  notes: string
  dueAt: string | null
  courseId: string | null
}

interface TaskEditorPopoverProps {
  task: BoardTask
  courses: Course[]
  anchorStyle: CSSProperties
  onClose: () => void
  onSave: (draft: TaskEditorDraft) => Promise<void>
  onDelete: () => Promise<void>
}

function toDateTimeLocal(value: string | null): string {
  if (value === null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toIso(value: string): string | null {
  if (value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function TaskEditorPopover({
  task,
  courses,
  anchorStyle,
  onClose,
  onSave,
  onDelete
}: TaskEditorPopoverProps): JSX.Element {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [dueAt, setDueAt] = useState(() => toDateTimeLocal(task.dueAt))
  const [courseId, setCourseId] = useState(task.courseId ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      popoverRef.current?.querySelector<HTMLInputElement>('#board-task-title')?.focus()
    })
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const normalizedTitle = title.trim()
    if (normalizedTitle.length === 0) {
      setLocalError('제목을 입력해주세요.')
      return
    }

    setIsSaving(true)
    setLocalError(null)
    try {
      await onSave({
        title: normalizedTitle,
        notes,
        dueAt: toIso(dueAt),
        courseId: courseId.length === 0 ? null : courseId
      })
      onClose()
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : '태스크를 저장하지 못했습니다.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    setIsSaving(true)
    setLocalError(null)
    try {
      await onDelete()
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : '태스크를 삭제하지 못했습니다.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const currentCourseMissing =
    task.courseId !== null && !courses.some((course) => course.id === task.courseId)

  return (
    <div
      ref={popoverRef}
      className="board-editor"
      role="dialog"
      aria-modal="false"
      aria-labelledby="board-editor-heading"
      style={anchorStyle}
    >
      <form onSubmit={(event) => void submit(event)}>
        <header className="board-editor__header">
          <div>
            <p className="board-eyebrow">TASK DETAILS</p>
            <h3 id="board-editor-heading">태스크 편집</h3>
          </div>
          <button
            type="button"
            className="board-icon-button"
            aria-label="편집 닫기"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>

        <label className="board-field" htmlFor="board-task-title">
          <span>제목</span>
          <input
            id="board-task-title"
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="board-field" htmlFor="board-task-notes">
          <span>메모</span>
          <textarea
            id="board-task-notes"
            value={notes}
            rows={5}
            placeholder="준비할 내용이나 참고사항을 적어보세요"
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>

        <label className="board-field" htmlFor="board-task-due-at">
          <span>마감일</span>
          <div className="board-field__with-action">
            <input
              id="board-task-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
            {dueAt.length > 0 && (
              <button type="button" onClick={() => setDueAt('')}>
                지우기
              </button>
            )}
          </div>
        </label>

        <label className="board-field" htmlFor="board-task-course">
          <span>과목</span>
          <div className="board-course-select">
            {courseId.length > 0 && (
              <span
                className="board-course-dot"
                data-course-color={normalizeCourseColor(
                  courses.find((course) => course.id === courseId)?.color ?? courseId
                )}
                aria-hidden="true"
              />
            )}
            <select
              id="board-task-course"
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
            >
              <option value="">전체 태스크</option>
              {currentCourseMissing && (
                <option value={task.courseId ?? ''}>목록에 없는 과목</option>
              )}
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </div>
        </label>

        {localError !== null && (
          <p className="board-editor__error" role="alert">
            {localError}
          </p>
        )}

        <footer className="board-editor__footer">
          <button
            type="button"
            className="board-button board-button--danger"
            disabled={isSaving}
            onClick={() => void remove()}
          >
            <Icon name="trash" />
            삭제
          </button>
          <div className="board-editor__actions">
            <button
              type="button"
              className="board-button"
              disabled={isSaving}
              onClick={onClose}
            >
              취소
            </button>
            <button
              type="submit"
              className="board-button board-button--primary"
              disabled={isSaving}
            >
              {isSaving ? '저장 중…' : '저장'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}
