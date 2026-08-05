/**
 * Connection state banner (docs/phase2-community.md §6.3).
 *
 * Tone matters here. A dropped websocket is not an error — the app still
 * works, it just refreshes every 15 seconds — so degraded/offline use the
 * quiet accent-muted treatment, never danger. Reserving red for things the
 * user must act on is what keeps red meaningful.
 *
 * `connected` renders nothing at all: a permanent green "연결됨" bar is chrome
 * that says nothing on 99% of frames.
 */

import type { GroupConnectionState } from '../../../../shared/types/group'

interface ConnectionBannerProps {
  state: GroupConnectionState
}

const COPY: Record<
  Exclude<GroupConnectionState, 'connected'>,
  { text: string; tone: 'muted' | 'warn' }
> = {
  reconnecting: { text: '연결하는 중이에요…', tone: 'muted' },
  'degraded-polling': {
    text: '실시간 연결이 불안정해요 · 15초마다 새로고침 중',
    tone: 'warn'
  },
  offline: {
    text: '오프라인이에요 · 연결되면 보낼게요',
    tone: 'warn'
  }
}

export function ConnectionBanner({
  state
}: ConnectionBannerProps): JSX.Element | null {
  if (state === 'connected') return null
  const copy = COPY[state]
  return (
    <div className="group-banner" data-tone={copy.tone} role="status">
      <span className="group-banner__dot" aria-hidden="true" />
      {copy.text}
    </div>
  )
}
