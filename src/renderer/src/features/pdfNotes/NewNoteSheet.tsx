import { sameWorkspace, workspaceMaterialRoot } from '../../../../shared/types/workspace'
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { descriptorFor } from '../workspace/tabIdentity'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { WorkspaceTarget } from '../workspace/placementContext'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { settingsSnapshot } from '../../stores/settingsSnapshot'
import { useMaterialsStore } from '../../stores/materialsStore'
import './noteSheet.css'

type Paper = 'blank' | 'lines' | 'grid' | 'dots'
type Orientation = 'portrait' | 'landscape'
const papers: Array<[Paper, string]> = [['blank', '빈 종이'], ['lines', '줄'], ['grid', '모눈'], ['dots', '점']]
const defaultTitle = (now = new Date()): string => `노트 ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
let creating = false

/** A note is a generated PDF: it gets the native ink pipeline, the toolbar and
 * the page panel instead of a separate canvas with its own tools. */
function NewNoteSheet({ courseId, target, dirRelPath, onClose, onCreated }: { dirRelPath?: string | undefined; courseId: string; target?: WorkspaceTarget; onClose(): void; onCreated?: (relPath: string) => Promise<void> }): JSX.Element {
  const capturedWorkspace = useRef(target ? target.workspace ?? { kind: 'course' as const, courseId } : useWorkspaceStore.getState().activeWorkspace).current
  const dialog = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(defaultTitle)
  const [paper, setPaper] = useState<Paper>(settingsSnapshot().tabs.notePaper)
  const [orientation, setOrientation] = useState<Orientation>(settingsSnapshot().tabs.noteOrientation)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { dialog.current?.querySelector<HTMLInputElement>('input[type=text]')?.focus() }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose, busy])
  const create = async (): Promise<void> => {
    if (busy) return
    creating = true; setBusy(true); setError('')
    try {
      const { relPath } = await invoke('pdfNotes:create', { courseId, title: title.trim() || defaultTitle(), paper, orientation, ...((dirRelPath !== undefined || capturedWorkspace?.kind === 'project') ? { dirRelPath: dirRelPath ?? workspaceMaterialRoot(capturedWorkspace) } : {}) }) as { relPath: string }
      const workspace = useWorkspaceStore.getState()
      const descriptor = descriptorFor('pdf', { courseId, relPath })
      if (target) workspace.openTab(descriptor, { target })
      else if (workspace.surface === 'course' && sameWorkspace(workspace.activeWorkspace, capturedWorkspace)) workspace.openTab(descriptor)
      else showToast('원래 공간에 새 노트를 만들었어요.')
      void useMaterialsStore.getState().loadTree(courseId, { refreshOnly: true })
      onClose()
      if (onCreated) void onCreated(relPath).catch(() => showToast('노트는 만들었지만 클립을 붙이지 못했어요. 다시 보내 주세요.', 'danger'))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setBusy(false) }
    finally { creating = false }
  }
  return <div className="ipad-note-sheet__backdrop" onPointerDown={event => { if (!busy && event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} className="ipad-note-sheet" role="dialog" aria-modal="true" aria-label="새 노트" data-bandal-native-overlay="true">
      <h2>새 노트</h2>
      <label>제목<input type="text" value={title} autoFocus onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void create() }} /></label>
      <fieldset><legend>종이</legend>
        {papers.map(([value, label]) => <label key={value} className="ipad-note-sheet__option" data-paper={value}>
          <input type="radio" name="ipad-note-paper" value={value} checked={paper === value} onChange={() => setPaper(value)} />
          <span className="ipad-note-sheet__preview" aria-hidden="true" /><span>{label}</span>
        </label>)}
      </fieldset>
      <fieldset><legend>방향</legend>
        <label className="ipad-note-sheet__option"><input type="radio" name="ipad-note-orientation" checked={orientation === 'portrait'} onChange={() => setOrientation('portrait')} /><span>세로</span></label>
        <label className="ipad-note-sheet__option"><input type="radio" name="ipad-note-orientation" checked={orientation === 'landscape'} onChange={() => setOrientation('landscape')} /><span>가로</span></label>
      </fieldset>
      {error && <p role="alert" className="ipad-note-sheet__error">{error}</p>}
      <footer>
        <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>취소</button>
        <button type="button" className="button button--primary" onClick={() => void create()} disabled={busy}>{busy ? '만드는 중…' : '만들기'}</button>
      </footer>
    </div>
  </div>
}

let root: Root | null = null, container: HTMLDivElement | null = null
/** Replaces the desktop `canvas:create` flow for new whiteboards on iPad. */
export function openNewNoteSheet(courseId: string, target?: WorkspaceTarget, onCreated?: (relPath: string) => Promise<void>, dirRelPath?: string): void {
  if (creating) return
  const close = () => { root?.unmount(); root = null; container?.remove(); container = null }
  close()
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  root.render(<NewNoteSheet courseId={courseId} dirRelPath={dirRelPath} {...(target ? { target } : {})} onClose={close} {...(onCreated ? { onCreated } : {})} />)
}
