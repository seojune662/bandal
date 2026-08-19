/**
 * 에이전트 접근 권한 — what the agent may reach in the browser, and what it did.
 *
 * `improvement-backlog.md` §5.8's complaint about the existing tool-permission
 * grant is that it is course-wide, permanent, invisible and irrevocable. The
 * browser grants are none of those, and this screen is the reason: a
 * permission a student cannot see is a permission they cannot withdraw.
 */

import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../lib/ipc'

interface Grant {
  id: string
  courseId: string
  origin: string
  capability: 'read' | 'interact' | 'download'
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
}

interface AuditEntry {
  id: string
  action: string
  url: string
  detail: string
  createdAt: string
}

const CAPABILITY_LABEL: Record<Grant['capability'], string> = {
  read: '읽기',
  interact: '조작',
  download: '내려받기'
}

const ACTION_LABEL: Record<string, string> = {
  navigate: '이동',
  read: '읽음',
  snapshot: '살펴봄',
  download: '내려받음',
  grant: '허용',
  revoke: '해제',
  denied: '거부됨'
}

function day(iso: string): string {
  return iso.slice(0, 10)
}

export function AgentAccessPanel(): JSX.Element {
  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    void invoke('browserAgent:grants', {})
      .then((result) => setGrants(result.grants))
      .catch(() => setGrants([]))
    void invoke('browserAgent:auditTail', { courseId: null, limit: 50 })
      .then((result) => setEntries(result.entries))
      .catch(() => setEntries([]))
  }, [])

  useEffect(() => load(), [load])

  const revoke = (id: string): void => {
    setBusy(true)
    void invoke('browserAgent:revokeGrant', { id })
      .then(load)
      .finally(() => setBusy(false))
  }

  const live = (grants ?? []).filter(
    (grant) => grant.revokedAt === null && grant.expiresAt > new Date().toISOString()
  )
  const past = (grants ?? []).filter((grant) => !live.includes(grant))

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card__header">
          <h2>에이전트 접근 권한</h2>
          <p>AI가 열어볼 수 있는 학교 사이트입니다. 기한이 지나면 자동으로 사라집니다.</p>
        </div>
        {grants === null ? (
          <p className="settings-feedback">불러오는 중…</p>
        ) : live.length === 0 ? (
          <p className="settings-feedback">아직 없습니다.</p>
        ) : (
          <ul className="settings-site-list">
            {live.map((grant) => (
              <li key={grant.id} className="settings-site-row">
                <span className="settings-site-row__origin">
                  {grant.origin} · {CAPABILITY_LABEL[grant.capability]} ·{' '}
                  {day(grant.expiresAt)}까지
                  {grant.lastUsedAt === null ? ' · 사용 전' : ''}
                </span>
                <button
                  type="button"
                  className="settings-site-row__action"
                  disabled={busy}
                  onClick={() => revoke(grant.id)}
                >
                  해제
                </button>
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <p className="settings-feedback">
            만료·해제된 권한 {past.length}건
          </p>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-card__header">
          <h2>기록</h2>
          <p>AI가 브라우저에서 한 일입니다. 페이지 내용은 남기지 않습니다.</p>
        </div>
        {entries.length === 0 ? (
          <p className="settings-feedback">아직 없습니다.</p>
        ) : (
          <ul className="settings-site-list">
            {entries.map((entry) => (
              <li key={entry.id} className="settings-site-row">
                <span className="settings-site-row__origin">
                  {day(entry.createdAt)} · {ACTION_LABEL[entry.action] ?? entry.action} ·{' '}
                  {entry.url} · {entry.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
