import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LearningAiSettings } from '../../../../shared/types/learning'
import { Icon } from '../../app/icons'
import { useUiStore } from '../../stores/uiStore'
import { useFocusTrap } from '../../components/useFocusTrap'
import { acquirePointerPassthrough } from '../browser/webviewPassthrough'
import { LearningAISelector } from './LearningAISelector'
import { learningError } from './learningNavigation'

export interface LearningGenerationRequest {
  label: string
  sourceTitle: string
  onStart: (ai: LearningAiSettings) => Promise<void>
}
export function LearningGenerationDialog({ request, onClose }: { request: LearningGenerationRequest; onClose: () => void }): JSX.Element {
  const [ai, setAi] = useState<LearningAiSettings | null>(null)
  const [valid, setValid] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const settingsOpen = useUiStore(state => state.isSettingsOpen)
  const root = useRef<HTMLElement>(null)
  const id = useId()
  useFocusTrap(root, { active: !settingsOpen, onEscape: pending ? undefined : onClose })
  useEffect(() => { if (!settingsOpen) return acquirePointerPassthrough() }, [settingsOpen])
  return createPortal(<div className="dialog-backdrop" style={settingsOpen ? { display: 'none' } : undefined} onMouseDown={event => { if (event.target === event.currentTarget && !pending) onClose() }}><section className="course-dialog learning-create learning-create--form" ref={root} role="dialog" aria-modal="true" aria-labelledby={id}>
    <header className="course-dialog__header"><h2 id={id}>{request.label} · AI 선택</h2><button className="bare-icon-button" type="button" aria-label="닫기" disabled={pending} onClick={onClose}><Icon name="x" /></button></header>
    <form className="learning-create__form" onSubmit={event => { event.preventDefault(); if (!valid || !ai) return; setPending(true); setError(null); void request.onStart(ai).then(onClose).catch(caught => { setError(learningError(caught)); setPending(false) }) }}><div className="learning-dialog-body"><p className="learning-muted">{request.sourceTitle}에서 복습 자료를 만들어요. 원본은 그대로 두고, 퀴즈와 카드는 별도 학습 공간에 모입니다.</p><LearningAISelector value={ai} disabled={pending} onChange={setAi} onValidityChange={setValid} />{error && <p className="learning-error" role="alert">{error}</p>}</div><footer className="dialog-actions"><button className="button button--secondary" type="button" disabled={pending} onClick={onClose}>취소</button><button className="button button--primary" type="submit" disabled={pending || !valid || !ai}>{pending ? '원본 확인과 실행 준비 중…' : '학습 자료 만들기'}</button></footer></form>
  </section></div>, document.body)
}
