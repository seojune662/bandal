import type { CommunityCampaign } from '../../../../shared/types/community'
import { CommunityDialog, formatCommunityDate } from './primitives'

export const CONTEST_QUESTIONS = [
  ['audience', '누구의 어떤 공부 상황에서 필요한가요?', '예: 전공 교재를 읽고도 핵심을 말로 설명하기 어려운 학생'],
  ['problem', '지금은 어떻게 공부하며, 무엇이 불편한가요?', '현재 공부하는 방법과 막히는 순간을 알려 주세요.'],
  ['workflow', '반달이 어떤 순서로 도와주면 좋겠나요?', '실제로 누를 버튼이나 읽고, 쓰고, 복습하는 순서를 적어 주세요.'],
  ['example', '실제로 사용할 장면을 하나 설명해 주세요.', '공부할 내용 하나를 정하고, 시작부터 끝까지 상상해 보세요.']
] as const

export function campaignAcceptsEntries(campaign: CommunityCampaign | null): boolean {
  return campaign?.published === true && campaign.phase === 'open'
}

export function CampaignBanner({ campaign, onCompose, onDetails }: { campaign: CommunityCampaign | null; onCompose: () => void; onDetails: () => void }): JSX.Element | null {
  if (!campaign?.published || campaign.phase === 'draft') return null
  const open = campaignAcceptsEntries(campaign)
  return <section className={`community__campaign${open ? ' community__campaign--open' : ''}`} aria-label="공모전 안내">
    <div className="community__campaign-copy"><span className="community__eyebrow">{campaign.phase === 'upcoming' ? '접수 예정' : open ? '아이디어를 기다리고 있어요' : campaign.phase === 'results' ? '결과 발표' : '접수 마감'}</span>
      <h2>{campaign.title}</h2>
      <p>{campaign.summary}</p>
      <small>{open ? `접수 마감 · ${formatCommunityDate(campaign.endsAt)} (한국 시간)` : campaign.phase === 'upcoming' ? `접수 시작 · ${formatCommunityDate(campaign.startsAt)} (한국 시간)` : `결과 발표 · ${formatCommunityDate(campaign.resultsAt)} (한국 시간)`}</small>
    </div>
    <div className="community__campaign-side"><strong>1등 10만 원 <span>2등 5만 원</span></strong><button type="button" className={`button button--${open ? 'primary' : 'secondary'}`} onClick={open ? onCompose : onDetails}>{open ? '공모 참여하기' : '모집 요강 보기'}</button>{open && <button type="button" className="community__text-button" onClick={onDetails}>모집 요강</button>}</div>
  </section>
}

export function CampaignDetails({ campaign, onClose, onCompose }: { campaign: CommunityCampaign; onClose: () => void; onCompose: () => void }): JSX.Element {
  return <CommunityDialog title={campaign.title} onClose={onClose} wide>
    <div className="community__dialog-body community__prose">
      <p>{campaign.summary}</p>
      <div className="community__prizes"><div><span>1등 · 1명</span><strong>100,000원</strong></div><div><span>2등 · 1명</span><strong>50,000원</strong></div></div>
      <h3>내가 쓰고 싶은 공부 도구를 알려 주세요</h3>
      <p>모든 반달 사용자가 참여할 수 있어요. 코딩이나 완성된 기획서는 필요하지 않아요. 네 가지 질문에 여러분의 경험을 적어 주세요.</p>
      <ol>{CONTEST_QUESTIONS.map(([key, question]) => <li key={key}>{question}</li>)}</ol>
      <h3>이런 흐름을 상상해 보세요</h3>
      <ul><li>영어 기사: 관심 있는 글 읽기 → 표현 수집 → 다음 글에서 다시 만나기</li><li>전공 공부: 어려운 개념 고르기 → 내 말로 설명하기 → 빠뜨린 부분 복습하기</li><li>수학 공부: 틀린 풀이 돌아보기 → 실수한 이유 묶기 → 비슷한 문제 다시 풀기</li></ul>
      <h3>심사와 개발</h3>
      <p>실제 도움 40점 · 사용 과정의 구체성 30점 · 구현 가능성 20점 · 독창성 10점. 운영자가 심사하며 공감 수는 참고만 해요.</p>
      <p>수상과 개발 채택은 별도로 결정해요. 개발 검토 결과와 이유를 공개하고, 채택한 아이디어의 개발 소식과 체험 후기는 같은 글에서 이어 갑니다.</p>
      <dl className="community__schedule"><dt>접수</dt><dd>{formatCommunityDate(campaign.startsAt)} ~ {formatCommunityDate(campaign.endsAt)}</dd><dt>발표</dt><dd>{formatCommunityDate(campaign.resultsAt)}</dd></dl>
      <p className="community__hint">모든 일정은 한국 시간 기준입니다. 접수 마감 뒤에는 응모 내용을 수정할 수 없어요.</p>
      {campaign.rules && <><h3>모집 요강</h3><p className="community__body-text">{campaign.rules}</p></>}
    </div>
    <footer className="community__dialog-footer"><span className="community__hint">응모작은 반달 앱 커뮤니티에서만 볼 수 있어요.</span>{campaignAcceptsEntries(campaign) ? <button type="button" className="button button--primary" onClick={onCompose}>공모 참여하기</button> : <button type="button" className="button button--secondary" onClick={onClose}>확인</button>}</footer>
  </CommunityDialog>
}
