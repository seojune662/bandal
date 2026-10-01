import { useEffect, useState } from 'react'
import type { MessageContextSnapshot } from '../../../../shared/types/chatContext'
import { invoke, onPush } from '../../lib/ipc'
import { updateComposerDraft, useComposerDraft } from './composerDraftStore'
const pending = new Map<string, Promise<MessageContextSnapshot>>()
function load(courseId: string): Promise<MessageContextSnapshot> {
  let request = pending.get(courseId)
  if (!request) { request = invoke('chat:context', { courseId }).finally(() => pending.delete(courseId)); pending.set(courseId, request) }
  return request
}
export function useMaterialContext(courseId: string) {
  const [snapshot, setSnapshot] = useState<MessageContextSnapshot | null>(null), [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = (): void => { void load(courseId).then(value => { if (active) { setSnapshot(value); setError(false) } }).catch(() => { if (active) setError(true) }) }
    const off = onPush('assistant:contextChanged', event => { if (event.courseId === courseId) refresh() })
    refresh(); window.addEventListener('focus', refresh)
    return () => { active = false; off(); window.removeEventListener('focus', refresh) }
  }, [courseId])
  return { snapshot, error }
}
export function ContextChips({ courseId, conversationId }: { courseId: string; conversationId: string }): JSX.Element {
  const { snapshot, error } = useMaterialContext(courseId)
  const draft = useComposerDraft(conversationId)
  const material = snapshot?.material
  return <div className="chat-context-chips chat-context-auto" aria-label="자동 연결 자료">
    <span className="chat-context-course">{snapshot?.courseName ?? '이 과목'}{error ? ' · 문맥 확인 실패' : ''}</span>
    {material && !draft.excludeCurrentMaterial && <span className="chat-context-chip" title={`${material.relPath ?? material.url ?? material.title}${material.selection ? '\n선택한 글을 우선 참고해요.' : ''}`}>
      {material.title}{material.page ? ` · ${material.page}쪽` : ''}{material.unsaved ? ' · 저장 전 필기' : ''}{material.selection ? ' · 선택한 글' : ''}
      <button type="button" aria-label="자동 연결 자료 제거" onClick={() => updateComposerDraft(conversationId, { excludeCurrentMaterial: true })}>×</button>
    </span>}
    {material && draft.excludeCurrentMaterial && <button type="button" className="chat-context-restore" onClick={() => updateComposerDraft(conversationId, { excludeCurrentMaterial: false })}>현재 자료 연결</button>}
  </div>
}
