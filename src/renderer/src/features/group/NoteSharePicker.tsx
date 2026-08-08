import { useEffect, useMemo, useState } from 'react'
import type { MaterialNode } from '../../../../shared/types/materials'
import { Icon } from '../../app/icons'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'

export interface NoteShareOption {
  relPath: string
  title: string
}

export function markdownNotes(nodes: readonly MaterialNode[]): NoteShareOption[] {
  const notes: NoteShareOption[] = []
  for (const node of nodes) {
    if (node.kind === 'dir') {
      notes.push(...markdownNotes(node.children ?? []))
    } else if (node.kind === 'note' && /\.md$/i.test(node.relPath)) {
      notes.push({
        relPath: node.relPath,
        title: node.name.replace(/\.md$/i, '')
      })
    }
  }
  return notes
}

interface NoteSharePickerProps {
  open: boolean
  groupId: string
  courseId: string
  onClose: () => void
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('[note-too-long]')) {
    return '이 노트는 공유 헤더를 포함해 4,000자를 넘어요. 내용을 줄인 뒤 다시 공유해 주세요.'
  }
  return '노트를 공유하지 못했어요.'
}

export function NoteSharePicker({
  open,
  groupId,
  courseId,
  onClose
}: NoteSharePickerProps): JSX.Element | null {
  const [tree, setTree] = useState<MaterialNode[]>([])
  const [loading, setLoading] = useState(false)
  const [sharingPath, setSharingPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const notes = useMemo(() => markdownNotes(tree), [tree])

  useEffect(() => {
    if (!open) {
      setTree([])
      setError(null)
      setSharingPath(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void invoke('materials:tree', { courseId })
      .then((result) => {
        if (!cancelled) setTree(result)
      })
      .catch(() => {
        if (!cancelled) setError('노트 목록을 불러오지 못했어요.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [courseId, open])

  const share = async (note: NoteShareOption): Promise<void> => {
    setSharingPath(note.relPath)
    setError(null)
    try {
      await invoke('group:shareNote', {
        groupId,
        courseId,
        relPath: note.relPath
      })
      showToast(`“${note.title}” 노트를 공유했어요.`)
      onClose()
    } catch (caught) {
      const message = errorText(caught)
      setError(message)
      showToast(message, 'danger')
    } finally {
      setSharingPath(null)
    }
  }

  if (!open) return null

  return (
    <div
      className="group-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-note-picker-title"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="group-palette group-note-picker">
        <header className="group-note-picker__head">
          <div>
            <h2 id="group-note-picker-title">노트 공유</h2>
            <p>조원에게 보낼 마크다운 노트를 고르세요.</p>
          </div>
          <button type="button" aria-label="노트 공유 닫기" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        {loading ? (
          <p className="group-palette__empty" role="status">
            노트를 불러오는 중…
          </p>
        ) : notes.length === 0 ? (
          <p className="group-palette__empty">이 과목에 마크다운 노트가 없어요.</p>
        ) : (
          <ul className="group-palette__list">
            {notes.map((note) => (
              <li key={note.relPath}>
                <button
                  type="button"
                  className="group-palette__row"
                  disabled={sharingPath !== null}
                  onClick={() => void share(note)}
                >
                  <Icon name="fileText" />
                  <span className="group-palette__name">{note.title}</span>
                  <span className="group-palette__hint">
                    {sharingPath === note.relPath ? '공유 중…' : note.relPath}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error !== null && (
          <p className="group-palette__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
