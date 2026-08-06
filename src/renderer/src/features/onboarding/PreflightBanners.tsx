/**
 * [M6-A] Preflight issue cards (Orca Landing pattern, docs/orca-analysis.md
 * §8): a slim, individually-dismissible banner strip in the app shell that
 * surfaces LIVE probe failures — "Claude Code가 설치되어 있지 않아요" /
 * "로그인이 필요해요". Shares the useAgentPreflight store with onboarding
 * step ③, so a 재확인 anywhere refreshes both.
 */

import { Icon } from '../../app/icons'
import {
  useAgentPreflight,
  visibleIssues,
  type PreflightIssueKind
} from './useAgentPreflight'
import './onboarding.css'
import { BandalMark } from '../../components/BandalMark'

const ISSUE_COPY: Record<
  PreflightIssueKind,
  { title: string; hint: JSX.Element }
> = {
  'not-installed': {
    title: 'Claude Code가 설치되어 있지 않아요',
    hint: <>설치를 마치면 AI 튜터를 바로 쓸 수 있어요.</>
  },
  'not-logged-in': {
    title: '로그인이 필요해요',
    hint: (
      <>
        터미널에서 <code>claude</code>를 실행해 로그인해 주세요.
      </>
    )
  }
}

interface PreflightBannersProps {
  /** Hide the strip (e.g. while the onboarding overlay covers the shell). */
  suppressed?: boolean
}

export function PreflightBanners({
  suppressed = false
}: PreflightBannersProps): JSX.Element | null {
  const status = useAgentPreflight((state) => state.status)
  const availability = useAgentPreflight((state) => state.availability)
  const dismissed = useAgentPreflight((state) => state.dismissed)
  const probe = useAgentPreflight((state) => state.probe)
  const dismissIssue = useAgentPreflight((state) => state.dismissIssue)

  const issues = visibleIssues({ status, availability, dismissed })
  if (suppressed || issues.length === 0) return null

  return (
    <div className="preflight-strip" role="status">
      {issues.map((issue) => {
        const copy = ISSUE_COPY[issue]
        return (
          <div className="preflight-banner" key={issue}>
            <BandalMark size={16} className="preflight-banner__moon" />
            <span className="preflight-banner__text">
              <strong>{copy.title}</strong> — {copy.hint}
            </span>
            <span className="preflight-banner__actions">
              <button
                type="button"
                className="preflight-banner__retry"
                onClick={() => void probe()}
              >
                재확인
              </button>
              <button
                type="button"
                className="preflight-banner__dismiss"
                aria-label="알림 닫기"
                onClick={() => dismissIssue(issue)}
              >
                <Icon name="x" />
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}
