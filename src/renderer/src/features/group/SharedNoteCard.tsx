import { useState } from 'react'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import {
  sharedNotePreview,
  type SharedNoteMessage
} from './sharedNoteMessage'

interface SharedNoteCardProps {
  note: SharedNoteMessage
  messageBody: string
  courseId: string | null
  pending?: boolean
}

export function SharedNoteCard({
  note,
  messageBody,
  courseId,
  pending = false
}: SharedNoteCardProps): JSX.Element {
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (courseId === null || saving || savedPath !== null) return
    setSaving(true)
    try {
      const result = await invoke('group:saveSharedNote', {
        courseId,
        title: note.title,
        markdown: messageBody
      })
      setSavedPath(result.relPath)
      showToast(`내 자료로 저장했어요: ${result.relPath}`)
    } catch {
      showToast('공유 노트를 저장하지 못했어요.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const buttonLabel = pending
    ? '전송 중'
    : courseId === null
      ? '저장할 과목 없음'
      : saving
        ? '저장 중…'
        : savedPath === null
          ? '내 자료로 저장'
          : '저장됨'

  return (
    <section className="group-note-card" aria-label={`공유 노트 ${note.title}`}>
      <p className="group-note-card__eyebrow">{SHARED_NOTE_MARKER_TEXT}</p>
      <h3 className="group-note-card__title">{note.title}</h3>
      <p className="group-note-card__origin">
        {note.courseName} · {note.sharedBy}
      </p>
      <p className="group-note-card__preview">{sharedNotePreview(note.markdown)}</p>
      <button
        type="button"
        className="group-note-card__save"
        disabled={pending || courseId === null || saving || savedPath !== null}
        onClick={() => void save()}
      >
        {buttonLabel}
      </button>
    </section>
  )
}

const SHARED_NOTE_MARKER_TEXT = '공유된 노트'
