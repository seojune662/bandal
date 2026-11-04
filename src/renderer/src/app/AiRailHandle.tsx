import { useEffect, useState } from 'react'
import { useAnnotationStore } from '../features/annotation/annotationStore'
import { useUiStore } from '../stores/uiStore'
import { Icon } from './icons'

/** Pull tab on the right edge of the rightmost left column; it rides the grid transition. */
export function AiRailHandle({ open }: { open: boolean }): JSX.Element | null {
  // The tab overlaps the document edge: during annotation it would land in captures
  // (and toggling would shift the document), so the column stays put without it.
  const annotating = useAnnotationStore(state => state.session !== null)
  const dragging = useDocumentDrag()
  if (annotating) return null
  return <button type="button" className="ai-rail-handle" data-open={open} data-dragging={dragging || undefined} aria-label={open ? 'AI 닫기' : 'AI 열기'}
    aria-expanded={open} aria-controls="ai-rail" onClick={() => useUiStore.getState().toggleAiRail()}>
    <span className="ai-rail-handle__tab" aria-hidden="true">
      {open ? <Icon name="chevronLeft" /> : <><span className="ai-rail-handle__spark">✦</span><span className="ai-rail-handle__label">AI</span></>}
    </span>
  </button>
}

/** Drops at the workspace's left edge (tab splits, files) must reach the dock under the tab. */
function useDocumentDrag(): boolean {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const start = (): void => setDragging(true)
    const end = (): void => setDragging(false)
    // An OS file drag that leaves the window never fires dragend here.
    const leave = (event: DragEvent): void => { if (event.relatedTarget === null) setDragging(false) }
    document.addEventListener('dragstart', start, true)
    document.addEventListener('dragenter', start, true)
    document.addEventListener('dragend', end, true)
    document.addEventListener('drop', end, true)
    document.addEventListener('dragleave', leave, true)
    return () => {
      document.removeEventListener('dragleave', leave, true)
      document.removeEventListener('dragstart', start, true)
      document.removeEventListener('dragenter', start, true)
      document.removeEventListener('dragend', end, true)
      document.removeEventListener('drop', end, true)
    }
  }, [])
  return dragging
}
