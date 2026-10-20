import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommunityApi, CommunityComment, CommunityDevelopmentStatus, CommunityPost } from '../../../../shared/types/community'
import { COMMUNITY_CATEGORY_LABELS, COMMUNITY_DEVELOPMENT_LABELS } from '../../../../shared/types/community'
import { communityError, communityRequest } from './api'
import { CONTEST_QUESTIONS } from './CampaignNotice'
import { clearDraft, newDraft, readDraft, saveDraft } from './drafts'
import { CommunityDialog, CommunityError, CommunityField, formatCommunityDate } from './primitives'

function ReviewForm({ post, onSaved }: { post: CommunityPost; onSaved: (post: CommunityPost) => void }): JSX.Element {
  const [award, setAward] = useState(post.award === null ? '' : String(post.award))
  const [status, setStatus] = useState<CommunityDevelopmentStatus | ''>(post.developmentStatus ?? '')
  const [note, setNote] = useState(post.developmentNote)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <details className="community__review"><summary>수상·개발 검토 관리</summary><form className="community__form" onSubmit={event => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    void communityRequest('reviewPost', { postId: post.id, award: award === '1' ? 1 : award === '2' ? 2 : null, developmentStatus: status || null, developmentNote: note.trim() })
      .then(onSaved).catch(failure => setError(communityError(failure))).finally(() => setBusy(false))
  }}>
    <p className="community__hint">수상과 개발 채택은 별도로 결정합니다. 수상 결과는 공모 결과를 공개한 뒤 표시됩니다.</p>
    <div className="community__form-row"><CommunityField label="수상"><select value={award} disabled={busy} onChange={event => setAward(event.target.value)}><option value="">선정 없음</option><option value="1">1등 · 10만 원</option><option value="2">2등 · 5만 원</option></select></CommunityField>
      <CommunityField label="개발 검토"><select value={status} disabled={busy} onChange={event => setStatus(event.target.value as CommunityDevelopmentStatus | '')}><option value="">검토 전</option>{Object.entries(COMMUNITY_DEVELOPMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></CommunityField></div>
    <CommunityField label="공개할 검토 결과와 이유"><textarea rows={3} maxLength={3000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></CommunityField>
    <CommunityError message={error} /><button type="submit" className="button button--secondary" disabled={busy}>{busy ? '저장 중…' : '검토 저장'}</button>
  </form></details>
}

function ReportDialog({ postId, commentId, onClose }: { postId: string; commentId: string | null; onClose: () => void }): JSX.Element {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  return <CommunityDialog title={commentId ? '댓글 신고' : '게시글 신고'} onClose={onClose} busy={busy}>
    {done ? <div className="community__dialog-body"><p role="status">신고를 접수했어요. 운영자가 내용을 확인할게요.</p><button className="button button--primary" type="button" onClick={onClose}>확인</button></div> :
      <form onSubmit={event => { event.preventDefault(); if (busy || !reason.trim()) return; setBusy(true); setError(null)
        void communityRequest('report', { postId, ...(commentId ? { commentId } : {}), reason: reason.trim() }).then(() => setDone(true)).catch(failure => setError(communityError(failure))).finally(() => setBusy(false))
      }}><div className="community__dialog-body community__form"><CommunityField label="신고 이유"><textarea required rows={5} minLength={2} maxLength={1000} value={reason} disabled={busy} placeholder="확인이 필요한 내용을 알려 주세요." onChange={event => setReason(event.target.value)} /></CommunityField><CommunityError message={error} /></div><footer className="community__dialog-footer"><span className="community__hint">신고 내용은 운영자만 확인합니다.</span><button type="submit" className="button button--primary" disabled={busy || reason.trim().length < 2}>신고 보내기</button></footer></form>}
  </CommunityDialog>
}

export function PostDialog({ id, signedIn, operator, userId, onClose, onLogin, onEdit, onChanged }: {
  id: string; signedIn: boolean; operator: boolean; userId: string | null; onClose: () => void; onLogin: () => void
  onEdit: (post: CommunityPost) => void; onChanged: () => void
}): JSX.Element {
  const [detail, setDetail] = useState<CommunityApi['post']['res'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const sequence = useRef(0)
  const commentKey = `bandal:community:comment:${userId ?? 'guest'}:${id}`
  const [draft, setDraft] = useState(() => readDraft(commentKey) ?? newDraft())
  const [commentStatus, setCommentStatus] = useState('')
  const [report, setReport] = useState<{ commentId: string | null } | null>(null)
  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current
    setLoading(true); setError(null)
    try { const data = await communityRequest('post', { id }); if (current === sequence.current) setDetail(data) }
    catch (failure) { if (current === sequence.current) setError(communityError(failure)) }
    finally { if (current === sequence.current) setLoading(false) }
  }, [id])
  useEffect(() => { void load(); return () => { sequence.current += 1 } }, [load])
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (running.current) return
    running.current = true; setBusy(true); setError(null)
    try { await action(); onChanged() } catch (failure) { setError(communityError(failure)) }
    finally { running.current = false; setBusy(false) }
  }
  const moderate = (action: CommunityApi['moderate']['req']['action'], comment?: CommunityComment): void => {
    void run(async () => { await communityRequest('moderate', { postId: id, action, ...(comment ? { commentId: comment.id } : {}) }); await load() })
  }
  const post = detail?.post
  return <CommunityDialog title="커뮤니티 게시글" onClose={onClose} busy={busy} wide>
    <div className="community__dialog-body">
      <CommunityError message={error} {...(!detail ? { retry: () => void load() } : {})} />
      {loading && !detail && <p role="status">게시글을 불러오고 있어요…</p>}
      {post && <>
        <div className="community__post-meta"><span>{COMMUNITY_CATEGORY_LABELS[post.category]}</span>{post.pinned && <span className="community__badge">공지</span>}{post.hidden && <span className="community__badge">숨긴 글</span>}</div>
        <h3 className="community__post-title">{post.title}</h3><p className="community__hint">{post.authorName} · {formatCommunityDate(post.createdAt)}</p>
        {post.award && <p className="community__award">{post.award}등 수상 · {post.award === 1 ? '10만' : '5만'} 원</p>}
        {post.answers ? <div className="community__answers">{CONTEST_QUESTIONS.map(([field, question], index) => <section key={field}><h4>{index + 1}. {question}</h4><p className="community__body-text">{post.answers?.[field]}</p></section>)}</div> : <p className="community__body-text community__post-body">{post.body}</p>}
        {(post.developmentStatus || post.developmentNote) && <section className="community__development"><h4>{post.developmentStatus ? COMMUNITY_DEVELOPMENT_LABELS[post.developmentStatus] : '개발 검토'}</h4><p className="community__body-text">{post.developmentNote || '진행 소식을 이 글에서 이어서 알려 드릴게요.'}</p></section>}
        <div className="community__post-actions"><button type="button" className="button button--secondary" aria-pressed={post.reacted} disabled={busy || post.hidden} onClick={() => {
          if (!signedIn) { onLogin(); return }
          void run(async () => {
            const result = await communityRequest('react', { postId: id, active: !post.reacted })
            setDetail(current => current ? { ...current, post: { ...current.post, reactionCount: result.count, reacted: result.active } } : current)
          })
        }}>공감 {post.reactionCount}</button>
          {post.editable && post.authorId === userId && <button type="button" className="community__text-button" disabled={busy} onClick={() => onEdit(post)}>수정</button>}
          <button type="button" className="community__text-button" disabled={busy} onClick={() => signedIn ? setReport({ commentId: null }) : onLogin()}>신고</button>
          {operator && <><button type="button" className="community__text-button" disabled={busy} onClick={() => moderate(post.pinned ? 'unpin' : 'pin')}>{post.pinned ? '공지 해제' : '공지로 고정'}</button><button type="button" className="community__text-button" disabled={busy} onClick={() => moderate(post.hidden ? 'restore' : 'hide')}>{post.hidden ? '게시글 복원' : '게시글 숨김'}</button></>}
        </div>
        {post.category === 'contest' && !post.editable && post.authorId === userId && <p className="community__hint">접수 마감 이후에는 응모 내용을 수정할 수 없어요.</p>}
        {operator && post.category === 'contest' && <ReviewForm key={`${post.id}:${post.updatedAt}`} post={post} onSaved={updated => { setDetail(current => current ? { ...current, post: updated } : current); onChanged() }} />}
        <section className="community__comments"><h4>댓글 {detail.comments.filter(comment => !comment.hidden).length}</h4>
          {detail.comments.length === 0 && <p className="community__hint">사용할 장면이나 더 좋은 방법을 함께 이야기해 보세요.</p>}
          {detail.comments.map(comment => <article key={comment.id} className="community__comment"><header><strong>{comment.authorName}</strong><small>{formatCommunityDate(comment.createdAt)}</small>{comment.hidden && <span className="community__badge">숨긴 댓글</span>}</header><p className="community__body-text">{comment.body}</p><div className="community__actions"><button type="button" className="community__text-button" disabled={busy} onClick={() => signedIn ? setReport({ commentId: comment.id }) : onLogin()}>댓글 신고</button>{operator && <button type="button" className="community__text-button" disabled={busy} onClick={() => moderate(comment.hidden ? 'restoreComment' : 'hideComment', comment)}>{comment.hidden ? '댓글 복원' : '댓글 숨김'}</button>}</div></article>)}
          {!post.hidden && <form className="community__form" onSubmit={event => {
            event.preventDefault()
            if (!signedIn) { onLogin(); return }
            if (!draft.body.trim()) return
            void run(async () => {
              const submission = draft.commentSubmission ?? { requestId: draft.requestId, body: draft.body.trim() }
              const pending = { ...draft, commentSubmission: submission }
              setDraft(pending); saveDraft(commentKey, pending); setCommentStatus('')
              const comment = await communityRequest('comment', { postId: id, ...submission })
              if (draft.body.trim() !== submission.body) {
                const remaining = { ...newDraft(), body: draft.body }
                setDraft(remaining); saveDraft(commentKey, remaining)
                setCommentStatus('이전 댓글의 게시를 확인했어요. 이후에 바꾼 내용은 새 초안으로 남겨 두었어요.')
              } else { clearDraft(commentKey); setDraft(newDraft()) }
              setDetail(current => current ? { ...current, comments: current.comments.some(item => item.id === comment.id) ? current.comments : [...current.comments, comment] } : current)
            })
          }}><CommunityField label="댓글 쓰기"><textarea rows={3} maxLength={3000} required disabled={busy} value={draft.body} onChange={event => { const next = { ...draft, body: event.target.value }; setDraft(next); saveDraft(commentKey, next) }} placeholder="이 아이디어에 대한 생각을 남겨 주세요." /></CommunityField>{commentStatus && <p className="community__hint" role="status">{commentStatus}</p>}<div className="community__actions"><button type="submit" className="button button--secondary" disabled={busy || !draft.body.trim()}>{busy ? '처리 중…' : signedIn ? '댓글 게시' : '로그인하고 댓글 게시'}</button></div></form>}
        </section>
      </>}
    </div>
    {report && <ReportDialog postId={id} commentId={report.commentId} onClose={() => setReport(null)} />}
  </CommunityDialog>
}
