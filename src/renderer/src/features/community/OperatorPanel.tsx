import { useEffect, useState } from 'react'
import type { CommunityCampaign, CommunityReport } from '../../../../shared/types/community'
import { communityError, communityRequest } from './api'
import { CommunityError, CommunityField, formatCommunityDate } from './primitives'

function localDate(value: string | null): string {
  return value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', 'T') : ''
}
function isoDate(value: string): string | null { return value ? new Date(`${value}:00+09:00`).toISOString() : null }

function CampaignForm({ campaign, onSaved }: { campaign: CommunityCampaign; onSaved: () => void }): JSX.Element {
  const [title, setTitle] = useState(campaign.title)
  const [summary, setSummary] = useState(campaign.summary)
  const [rules, setRules] = useState(campaign.rules)
  const [startsAt, setStartsAt] = useState(localDate(campaign.startsAt))
  const [endsAt, setEndsAt] = useState(localDate(campaign.endsAt))
  const [resultsAt, setResultsAt] = useState(localDate(campaign.resultsAt))
  const [published, setPublished] = useState(campaign.published)
  const [resultsPublished, setResultsPublished] = useState(campaign.resultsPublished)
  const [closed, setClosed] = useState(campaign.closed)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  return <form className="community__form" onSubmit={event => {
    event.preventDefault()
    if (busy) return
    setError(null); setSaved(false)
    if (published && (!startsAt || !endsAt || !resultsAt || !rules.trim())) { setError('공개하려면 접수 시작·마감·발표 일정과 최종 모집 요강을 입력해 주세요.'); return }
    if ((startsAt && endsAt && startsAt >= endsAt) || (endsAt && resultsAt && endsAt > resultsAt)) { setError('접수 시작, 마감, 발표 순서로 일정을 정해 주세요.'); return }
    setBusy(true)
    void communityRequest('updateCampaign', { id: campaign.id, title: title.trim(), summary: summary.trim(), rules: rules.trim(), startsAt: isoDate(startsAt), endsAt: isoDate(endsAt), resultsAt: isoDate(resultsAt), published, resultsPublished, closed })
      .then(() => { setSaved(true); onSaved() }).catch(failure => setError(communityError(failure))).finally(() => setBusy(false))
  }}>
    <h3>공모 운영</h3><p className="community__hint">일정과 최종 모집 요강을 확정한 뒤 공개하세요. 공개한 접수 기간에만 앱 안내창·참여 배너가 활성화됩니다.</p>
    <CommunityField label="공모 제목"><input required maxLength={120} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></CommunityField>
    <CommunityField label="소개"><textarea required rows={2} maxLength={1000} value={summary} disabled={busy} onChange={event => setSummary(event.target.value)} /></CommunityField>
    <div className="community__form-row"><CommunityField label="접수 시작 (한국 시간)"><input type="datetime-local" value={startsAt} disabled={busy} onChange={event => setStartsAt(event.target.value)} /></CommunityField><CommunityField label="접수 마감 (한국 시간)"><input type="datetime-local" value={endsAt} disabled={busy} onChange={event => setEndsAt(event.target.value)} /></CommunityField><CommunityField label="결과 발표 (한국 시간)"><input type="datetime-local" value={resultsAt} disabled={busy} onChange={event => setResultsAt(event.target.value)} /></CommunityField></div>
    <CommunityField label="최종 모집 요강"><textarea rows={8} maxLength={12000} value={rules} disabled={busy} onChange={event => setRules(event.target.value)} /></CommunityField>
    <label className="community__check"><input type="checkbox" checked={published} disabled={busy} onChange={event => setPublished(event.target.checked)} />앱과 웹에 공모 안내 공개</label>
    <label className="community__check"><input type="checkbox" checked={resultsPublished} disabled={busy} onChange={event => setResultsPublished(event.target.checked)} />수상 결과 공개</label>
    <label className="community__check"><input type="checkbox" checked={closed} disabled={busy} onChange={event => setClosed(event.target.checked)} />공모 종료</label>
    <CommunityError message={error} />{saved && <p role="status">공모 설정을 저장했어요.</p>}<div className="community__actions"><button type="submit" disabled={busy} className="button button--primary">{busy ? '저장 중…' : '공모 설정 저장'}</button></div>
  </form>
}

export function OperatorPanel({ campaign, onSaved, onPost }: { campaign: CommunityCampaign | null; onSaved: () => void; onPost: (id: string) => void }): JSX.Element {
  const [reports, setReports] = useState<CommunityReport[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setLoading(true); setError(null)
    void communityRequest('reports', {}).then(data => { if (active) setReports(data) }).catch(failure => { if (active) setError(communityError(failure)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])
  return <div className="community__operator">
    {campaign ? <CampaignForm campaign={campaign} onSaved={onSaved} /> : <p className="community__notice">등록된 공모가 없습니다.</p>}
    <section><div className="community__section-title"><h3>신고 검토</h3><button type="button" className="community__text-button" onClick={() => setRevision(value => value + 1)}>새로고침</button></div><CommunityError message={error} retry={() => setRevision(value => value + 1)} />
      {loading ? <p role="status">신고를 불러오고 있어요…</p> : reports.filter(report => !report.resolved).length === 0 ? <p className="community__hint">검토할 신고가 없어요.</p> : reports.filter(report => !report.resolved).map(report => <article key={report.id} className="community__report"><span className="community__eyebrow">{report.commentId ? '댓글 신고' : '게시글 신고'} · {formatCommunityDate(report.createdAt)}</span><p className="community__body-text">{report.reason}</p><div className="community__actions"><button type="button" className="button button--secondary" onClick={() => onPost(report.postId)}>게시글 확인</button><button type="button" className="community__text-button" disabled={busyId !== null} onClick={() => {
        setBusyId(report.id); setError(null)
        void communityRequest('resolveReport', { id: report.id }).then(() => setReports(current => current.map(item => item.id === report.id ? { ...item, resolved: true } : item))).catch(failure => setError(communityError(failure))).finally(() => setBusyId(null))
      }}>{busyId === report.id ? '저장 중…' : '검토 완료'}</button></div></article>)}
    </section>
  </div>
}
