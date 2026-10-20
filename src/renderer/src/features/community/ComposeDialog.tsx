import { useRef, useState } from 'react'
import type { CommunityCampaign, CommunityCategory, CommunityPost } from '../../../../shared/types/community'
import { COMMUNITY_CATEGORY_LABELS } from '../../../../shared/types/community'
import { communityError, communityRequest } from './api'
import { campaignAcceptsEntries, CONTEST_QUESTIONS } from './CampaignNotice'
import { clearDraft, draftKey, newDraft, postInput, readDraft, samePostContent, saveDraft, type CommunityDraft } from './drafts'
import { CommunityDialog, CommunityError, CommunityField } from './primitives'

export function ComposeDialog({ category, campaign, userId, signedIn, editing, onClose, onLogin, onSaved }: {
  category: CommunityCategory; campaign: CommunityCampaign | null; userId: string | null; signedIn: boolean; editing: CommunityPost | null
  onClose: () => void; onLogin: () => void; onSaved: (post: CommunityPost) => void
}): JSX.Element {
  const key = draftKey(userId, category, category === 'contest' ? campaign?.id : undefined, editing?.id)
  const [draft, setDraft] = useState<CommunityDraft>(() => readDraft(key) ?? (editing ? {
    requestId: crypto.randomUUID(), title: editing.title, body: editing.body, answers: editing.answers ?? newDraft().answers
  } : newDraft()))
  const [durable, setDurable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [recovered, setRecovered] = useState<CommunityPost | null>(null)
  const allowed = category !== 'contest' || (campaignAcceptsEntries(campaign) && (!editing || editing.editable))
  const change = (value: CommunityDraft): void => { setDraft(value); setDurable(saveDraft(key, value)) }
  const submit = async (): Promise<void> => {
    if (running.current || !allowed) return
    setDurable(saveDraft(key, draft))
    if (!signedIn) { onLogin(); return }
    if (!draft.title.trim() || (category === 'contest' ? CONTEST_QUESTIONS.some(([field]) => !draft.answers[field].trim()) : !draft.body.trim())) {
      setError('제목과 모든 내용을 작성해 주세요.'); return
    }
    running.current = true; setBusy(true); setError(null)
    try {
      const requested = postInput(draft, category, campaign?.id, editing?.id)
      const submission = draft.submission ?? requested
      change({ ...draft, submission })
      let post = await communityRequest('savePost', submission)
      if (!samePostContent(submission, requested)) {
        setRecovered(post)
        const updatedSubmission = { ...requested, id: post.id, requestId: crypto.randomUUID() }
        change({ ...draft, requestId: updatedSubmission.requestId, submission: updatedSubmission })
        post = await communityRequest('savePost', updatedSubmission)
      }
      clearDraft(key); onSaved(post)
    } catch (failure) { setError(communityError(failure)) }
    finally { running.current = false; setBusy(false) }
  }
  return <CommunityDialog title={editing ? '게시글 수정' : COMMUNITY_CATEGORY_LABELS[category]} onClose={onClose} busy={busy} wide>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="community__dialog-body community__form">
        <p className="community__hint">{category === 'contest' ? '거창한 기획보다 실제로 공부하면서 필요했던 순간을 들려주세요.' : '함께 공부하는 사람들과 경험과 생각을 나눠 보세요.'}</p>
        {!allowed && <p className="community__notice" role="status">지금은 공모를 접수하지 않아요. 작성한 초안은 이 기기에 보관합니다.</p>}
        <CommunityError message={error} />
        {recovered && error && <div className="community__notice">기존 제출은 확인했지만 변경 내용을 저장하지 못했어요. 변경한 초안은 보관됩니다. <button type="button" className="community__text-button" onClick={() => onSaved(recovered)}>제출된 글 보기</button></div>}
        <CommunityField label="제목"><input required maxLength={120} value={draft.title} disabled={busy} placeholder={category === 'contest' ? '어떤 공부 도구가 있으면 좋겠나요?' : '어떤 이야기를 나누고 싶나요?'} onChange={event => change({ ...draft, title: event.target.value })} /></CommunityField>
        {category === 'contest' ? CONTEST_QUESTIONS.map(([field, label, hint], index) => <CommunityField key={field} label={`${index + 1}. ${label}`} hint={hint}><textarea required rows={3} maxLength={3000} disabled={busy} value={draft.answers[field]} onChange={event => change({ ...draft, answers: { ...draft.answers, [field]: event.target.value } })} /></CommunityField>) :
          <CommunityField label="내용"><textarea required rows={12} maxLength={10000} disabled={busy} value={draft.body} placeholder="공부법, 경험 또는 궁금한 점을 자유롭게 적어 주세요." onChange={event => change({ ...draft, body: event.target.value })} /></CommunityField>}
        <p className="community__hint">개인 연락처나 다른 사람의 개인정보는 적지 말아 주세요.{category === 'contest' && ' 마감 시점의 응모 내용으로 심사하며, 마감 후에는 수정할 수 없어요.'}</p>
      </div>
      <footer className="community__dialog-footer"><span className="community__hint" role="status">{durable ? '초안은 이 기기에 자동 저장돼요.' : '이 창에서 초안을 보관 중이에요. 앱을 종료하면 사라질 수 있어요.'}</span><div className="community__actions"><button type="button" className="button button--secondary" disabled={busy} onClick={onClose}>나중에 이어 쓰기</button><button className="button button--primary" type="submit" disabled={busy || !allowed}>{busy ? '게시 중…' : !signedIn ? '로그인하고 게시' : editing ? '수정 완료' : category === 'contest' ? '응모하기' : '게시하기'}</button></div></footer>
    </form>
  </CommunityDialog>
}
