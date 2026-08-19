/**
 * Browser settings: which search engine the omnibox uses, which sites the
 * student is signed in to, and how to forget any of it.
 *
 * `browser:sessionSites` / `browser:clearSession` were fully implemented in
 * main but had ZERO renderer callers — a working feature nobody could reach.
 * This is where they surface.
 *
 * Every class here is `settings-` prefixed on purpose: the settings surface
 * loads into the main window, and an unprefixed class has leaked into the
 * sidebar before (`.course-list`).
 */

import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../lib/ipc'
import {
  SEARCH_ENGINE_NAMES,
  SEARCH_ENGINES,
  type SearchEngineId
} from '../../../../shared/search'
import type { Settings } from '../../../../shared/types/settings'

interface SignedInSite {
  origin: string
  cookieCount: number
}

export function BrowsingDataPanel({
  settings
}: {
  settings: Settings | null
}): JSX.Element {
  const [sites, setSites] = useState<SignedInSite[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const loadSites = useCallback(() => {
    void invoke('browser:sessionSites', {})
      .then((result) => setSites(result.sites))
      .catch(() => setSites([]))
  }, [])

  useEffect(() => loadSites(), [loadSites])

  const forget = (origin: string | null): void => {
    setBusy(origin ?? '*')
    void invoke('browser:clearSession', { origin })
      .then(() => {
        setFeedback(
          origin === null
            ? '모든 사이트에서 로그아웃했습니다.'
            : `${origin}에서 로그아웃했습니다.`
        )
        loadSites()
      })
      .catch(() => setFeedback('로그아웃하지 못했습니다.'))
      .finally(() => setBusy(null))
  }

  const clearHistory = (): void => {
    setBusy('history')
    void invoke('browser:clearHistory', { courseId: null })
      .then(() => setFeedback('방문 기록을 지웠습니다.'))
      .catch(() => setFeedback('방문 기록을 지우지 못했습니다.'))
      .finally(() => setBusy(null))
  }

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <div className="settings-card__header">
          <h2>검색 엔진</h2>
          <p>주소창에 주소가 아닌 말을 넣었을 때 사용합니다.</p>
        </div>
        <div className="setting-row">
          <div className="setting-row__copy">
            <span className="setting-row__label">기본 검색 엔진</span>
          </div>
          <select
            className="language-select"
            aria-label="기본 검색 엔진"
            value={settings?.browserSearchEngine ?? 'google'}
            onChange={(event) => {
              void invoke('settings:set', {
                browserSearchEngine: event.target.value as SearchEngineId
              })
            }}
          >
            {(Object.keys(SEARCH_ENGINES) as SearchEngineId[]).map((id) => (
              <option key={id} value={id}>
                {SEARCH_ENGINE_NAMES[id]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card__header">
          <h2>로그인된 사이트</h2>
          <p>반달 브라우저가 기억하고 있는 학교 사이트 로그인입니다.</p>
        </div>
        {sites === null ? (
          <p className="settings-feedback">불러오는 중…</p>
        ) : sites.length === 0 ? (
          <p className="settings-feedback">아직 없습니다.</p>
        ) : (
          <ul className="settings-site-list">
            {sites.map((site) => (
              <li key={site.origin} className="settings-site-row">
                <span className="settings-site-row__origin">{site.origin}</span>
                <button
                  type="button"
                  className="settings-site-row__action"
                  disabled={busy !== null}
                  onClick={() => forget(site.origin)}
                >
                  로그아웃
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="settings-danger-row">
          <button
            type="button"
            className="settings-site-row__action"
            disabled={busy !== null || (sites?.length ?? 0) === 0}
            onClick={() => forget(null)}
          >
            전체 로그아웃
          </button>
          <button
            type="button"
            className="settings-site-row__action"
            disabled={busy !== null}
            onClick={clearHistory}
          >
            방문 기록 지우기
          </button>
        </div>
        <p className="settings-feedback" aria-live="polite">
          {feedback ?? ''}
        </p>
      </section>
    </div>
  )
}
