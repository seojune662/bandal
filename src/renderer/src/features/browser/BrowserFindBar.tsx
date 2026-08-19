/**
 * ⌘F, in the panel chrome rather than over the guest.
 *
 * Rendering it inside `.browser-chrome` avoids fighting the guest layer for
 * z-index: guests live in a fixed layer above the panel DOM, so anything drawn
 * over them has to acquire pointer passthrough. The chrome is already above.
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { BrowserIcon } from './browserIcons'
import { useBrowserGuests, type BrowserFindState } from './browserGuestsStore'
import { guestActions } from './guestActions'

/** Chromium re-scans the whole page per call; a keystroke is too often. */
const QUERY_DEBOUNCE_MS = 120

export function BrowserFindBar({
  tabId,
  state
}: {
  tabId: string
  state: BrowserFindState
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(state.query)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [state.focusSeq])

  // Debounced incremental search. `findNext: false` restarts from the top,
  // which is what a changed query means.
  useEffect(() => {
    const store = useBrowserGuests.getState()
    if (draft === '') {
      store.setFindQuery(tabId, '')
      guestActions.stopFind(tabId)
      return
    }
    const timer = setTimeout(() => {
      store.setFindQuery(tabId, draft)
      guestActions.find(tabId, draft)
    }, QUERY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, tabId])

  const step = (forward: boolean): void => {
    if (draft === '') return
    guestActions.find(tabId, draft, { findNext: true, forward })
  }

  const close = (): void => {
    guestActions.stopFind(tabId)
    useBrowserGuests.getState().closeFind(tabId)
  }

  const hasQuery = draft !== ''
  const noMatches = hasQuery && state.matchCount === 0

  return (
    <div className="browser-find" role="search">
      <input
        ref={inputRef}
        className="browser-find__input"
        type="text"
        value={draft}
        aria-label="페이지에서 찾기"
        data-empty={noMatches ? 'true' : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            step(!event.shiftKey)
          }
        }}
      />
      <span className="browser-find__count" aria-live="polite">
        {hasQuery ? `${state.activeMatch}/${state.matchCount}` : ''}
      </span>
      <button
        type="button"
        className="browser-find__step"
        aria-label="이전 결과"
        disabled={!hasQuery || state.matchCount === 0}
        onClick={() => step(false)}
      >
        <BrowserIcon name="chevronUp" />
      </button>
      <button
        type="button"
        className="browser-find__step"
        aria-label="다음 결과"
        disabled={!hasQuery || state.matchCount === 0}
        onClick={() => step(true)}
      >
        <BrowserIcon name="chevronDown" />
      </button>
      <button
        type="button"
        className="browser-find__step"
        aria-label="찾기 닫기"
        onClick={close}
      >
        <Icon name="x" />
      </button>
    </div>
  )
}
