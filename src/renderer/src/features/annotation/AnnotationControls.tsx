import { useEffect } from 'react'
import { useAnnotationStore } from './annotationStore'
import { useComposerDraft } from '../chat/composerDraftStore'
import './annotation.css'

/** The composer remains visible while the user points at any open document pane. */
export function AnnotationControls({ conversationId, courseId, disabled = false }: { conversationId: string; courseId: string; disabled?: boolean }): JSX.Element {
  const session = useAnnotationStore(state => state.session)
  const error = useAnnotationStore(state => state.error)
  const busy = useAnnotationStore(state => state.busy)
  const referenceCount = useComposerDraft(conversationId).references?.length ?? 0
  const active = session?.conversationId === conversationId
  useEffect(() => () => {
    if (useAnnotationStore.getState().session?.conversationId === conversationId) useAnnotationStore.getState().stop()
  }, [conversationId])
  return <div className="annotation-controls" data-annotation-ui>
    <button type="button" className="annotation-trigger" aria-label={active ? '부분 선택 마치기' : '화면에서 부분 선택'} aria-pressed={active} disabled={disabled && !active}
      onPointerDown={event => event.preventDefault()}
      onClick={() => active ? useAnnotationStore.getState().stop() : useAnnotationStore.getState().begin(conversationId, courseId)}>
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H4a1 1 0 0 0-1 1v4m9-5h4a1 1 0 0 1 1 1v4M3 12v4a1 1 0 0 0 1 1h4"/><path d="m10 9 7 4-3 1-1 3-3-8Z"/></svg>
      {active ? '선택 완료' : '부분 선택'}
    </button>
    {active && <>
      <div className="annotation-mode" role="group" aria-label="부분 선택 방식">
        <button type="button" aria-pressed={session.mode === 'element'} onClick={() => useAnnotationStore.getState().mode('element')}>요소</button>
        <button type="button" aria-pressed={session.mode === 'region'} onClick={() => useAnnotationStore.getState().mode('region')}>영역</button>
      </div>
      <span className="annotation-hint" role="status">{busy ? '추가하는 중…' : `${referenceCount ? `${referenceCount}개 추가 · ` : ''}${session.mode === 'region' ? '드래그로 선택' : '원하는 부분 클릭'} · Esc 종료`}</span>
      {error && <span className="annotation-error" role="alert">{error}</span>}
    </>}
  </div>
}
