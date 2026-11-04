import { useAnnotationStore } from '../features/annotation/annotationStore'
import { useUiStore } from '../stores/uiStore'
import { Icon } from './icons'

/** Pull tab on the right edge of the rightmost left column; it rides the grid transition. */
export function AiRailHandle({ open }: { open: boolean }): JSX.Element {
  // Toggling mid-annotation would shift the document under the pointer.
  const locked = useAnnotationStore(state => state.session !== null)
  return <button type="button" className="ai-rail-handle" data-open={open} aria-label={open ? 'AI 닫기' : 'AI 열기'}
    aria-expanded={open} aria-controls="ai-rail" disabled={locked} onClick={() => useUiStore.getState().toggleAiRail()}>
    <span className="ai-rail-handle__tab" aria-hidden="true">
      {open ? <Icon name="chevronLeft" /> : <><span className="ai-rail-handle__spark">✦</span><span className="ai-rail-handle__label">AI</span></>}
    </span>
  </button>
}
