import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../../lib/ipc'
import { DEFAULT_AI_ACCESS, type AiAccessMode, type AiAccessPolicy } from '../../../../shared/types/aiAccess'
import { ComposerPopover } from './ComposerPopover'
const modes: { id: AiAccessMode; label: string; detail: string }[] = [
  { id: 'ask', label: '항상 확인', detail: '자료 변경과 추가 접근 전에 확인해요.' },
  { id: 'auto', label: '자동 판단', detail: '허용된 자료는 읽고, 삭제·외부 전송·민감한 접근은 확인해요.' },
  { id: 'full', label: '전체 허용', detail: '아래에서 선택한 범위 안의 확인을 생략해요.' }
]
export function AccessPolicyMenu({ courseId, conversationId, disabled }: { courseId: string; conversationId: string; disabled: boolean }): JSX.Element {
  const [policy, setPolicy] = useState(DEFAULT_AI_ACCESS), [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const anchor = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => { let live = true; void invoke('chat:accessPolicy', { courseId, sessionId: conversationId }).then(p => { if (live) setPolicy(p) }).catch(() => {}); return () => { live = false } }, [courseId, conversationId, open])
  const save = async (next: AiAccessPolicy): Promise<void> => { if (saving) return; setSaving(true); setError(''); try { setPolicy(await invoke('chat:accessPolicy', { courseId, sessionId: conversationId, policy: next })) } catch (e) { setError(e instanceof Error ? e.message : '설정을 저장하지 못했어요.') } finally { setSaving(false) } }
  return <><button className="chat-access-trigger" type="button" ref={anchor} disabled={disabled || saving} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="AI 허용 모드">{modes.find(m => m.id === policy.mode)?.label}⌄</button>
    {open && <ComposerPopover anchor={anchor} label="AI 허용 범위" onClose={close}>
      <div className="chat-menu-heading">AI 작업을 어떻게 허용할까요?</div>
      {modes.map(mode => <button className="chat-add-item" type="button" key={mode.id} aria-pressed={policy.mode === mode.id} disabled={saving} onClick={() => void save({ ...policy, mode: mode.id })}><span>{policy.mode === mode.id ? '✓' : '○'}</span><span>{mode.label}<small>{mode.detail}</small></span></button>)}
      <div className="chat-menu-heading">확인 생략 범위 · 이 대화에만 저장</div>
      {(['course', 'browser', 'screen'] as const).map(scope => <label className="chat-access-scope" key={scope}><input type="checkbox" checked={policy.scope[scope]} disabled={saving} onChange={event => void save({ ...policy, scope: { ...policy.scope, [scope]: event.target.checked } })} />{{ course: '이 과목의 자료', browser: '브라우저 사이트', screen: '화면과 클립보드' }[scope]}</label>)}
      <p className="chat-menu-note">운영체제 권한은 별도로 허용해야 해요. 범위 밖의 작업은 다시 확인해요.</p>{error && <p className="chat-menu-error" role="alert">{error}</p>}
    </ComposerPopover>}
  </>
}
