/**
 * Nickname invite palette — the ⌘P-style surface from §5.3.
 *
 * The speed comes from ordering, not from cleverness:
 *
 *  1. IT OPENS NON-EMPTY. "최근에 같이 한 사람" is the local profile cache, so
 *     there is no spinner and no network. From the second 조별과제 onward the
 *     right person is usually already on screen → 2 steps, zero typing.
 *  2. TYPING FILTERS THE CACHE INSTANTLY, offline included, because prefix
 *     matching happens locally.
 *  3. ONLY IF THE CACHE MISSES do we go to the server, debounced 300ms, and
 *     the server API is EXACT-MATCH ONLY. Exposing prefix search server-side
 *     would let anyone enumerate the nickname directory.
 *
 * You do not need to be friends to invite someone; friendship is only the
 * autocomplete cache. Requiring it would add a request/accept round trip and
 * make this slower than KakaoTalk, which is the entire thing we are beating.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FriendEntry,
  ProfileLookupResult
} from '../../../../shared/types/group'
import { invoke } from '../../lib/ipc'
import { Icon } from '../../app/icons'
import { GroupAvatar } from './GroupAvatar'
import { InviteCodePanel } from './InviteCodePanel'

const SERVER_LOOKUP_DEBOUNCE_MS = 300

interface Candidate {
  userId: string
  nickname: string
  avatarColor: string
  avatarEmoji: string
  source: 'cache' | 'server'
}

interface InvitePaletteProps {
  open: boolean
  groupId: string
  onClose: () => void
  onInvited: (nickname: string, status: string) => void
}

function fromFriend(friend: FriendEntry): Candidate {
  return {
    userId: friend.userId,
    nickname: friend.nickname,
    avatarColor: friend.avatarColor,
    avatarEmoji: friend.avatarEmoji,
    source: 'cache'
  }
}

function fromLookup(profile: ProfileLookupResult): Candidate {
  return {
    userId: profile.id,
    nickname: profile.nickname,
    avatarColor: profile.avatarColor,
    avatarEmoji: profile.avatarEmoji,
    source: 'server'
  }
}

export function InvitePalette({
  open,
  groupId,
  onClose,
  onInvited
}: InvitePaletteProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<Candidate[]>([])
  const [remote, setRemote] = useState<Candidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setRemote(null)
      setError(null)
      return
    }
    inputRef.current?.focus()
    // Local cache, so this resolves immediately and works offline.
    void invoke('friends:list', {})
      .then((friends) => setRecent(friends.map(fromFriend)))
      .catch(() => {
        setRecent([])
      })
  }, [open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return recent
    return recent.filter((candidate) =>
      candidate.nickname.toLocaleLowerCase().startsWith(needle)
    )
  }, [query, recent])

  // Server fallback: only when the cache has nothing, and only exact match.
  useEffect(() => {
    const needle = query.trim()
    if (!open || needle.length < 2 || filtered.length > 0) {
      setRemote(null)
      return
    }
    const timer = window.setTimeout(() => {
      void invoke('groups:findProfile', { nickname: needle })
        .then((profile) => {
          setRemote(profile === null ? null : fromLookup(profile))
        })
        .catch(() => {
          setRemote(null)
        })
    }, SERVER_LOOKUP_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [filtered.length, open, query])

  const invite = useCallback(
    async (nickname: string) => {
      setBusy(true)
      setError(null)
      try {
        const result = await invoke('groups:inviteByNickname', {
          groupId,
          nickname
        })
        onInvited(nickname, result.status)
        onClose()
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : '초대하지 못했어요.'
        )
      } finally {
        setBusy(false)
      }
    },
    [groupId, onClose, onInvited]
  )

  if (!open) return null

  const candidates = remote === null ? filtered : [...filtered, remote]

  return (
    <div
      className="group-palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-palette-title"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="group-palette">
        <InviteCodePanel groupId={groupId} />

        <div className="group-palette__search">
          <Icon name="search" />
          <label className="sr-only" htmlFor="group-palette-input">
            닉네임으로 초대
          </label>
          <input
            id="group-palette-input"
            ref={inputRef}
            type="text"
            autoComplete="off"
            placeholder="닉네임으로 초대"
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                const first = candidates[0]
                if (first !== undefined) void invite(first.nickname)
              }
            }}
          />
        </div>

        <h2 id="group-palette-title" className="sr-only">
          닉네임으로 초대
        </h2>

        {candidates.length === 0 ? (
          <p className="group-palette__empty">
            {query.trim().length < 2
              ? '닉네임을 입력하면 찾아볼게요'
              : '그런 닉네임을 찾지 못했어요'}
          </p>
        ) : (
          <ul className="group-palette__list">
            {query.trim() === '' && (
              <li className="group-palette__section">최근에 같이 한 사람</li>
            )}
            {candidates.map((candidate) => (
              <li key={`${candidate.source}-${candidate.userId}`}>
                <button
                  type="button"
                  className="group-palette__row"
                  disabled={busy}
                  onClick={() => void invite(candidate.nickname)}
                >
                  <GroupAvatar
                    emoji={candidate.avatarEmoji}
                    color={candidate.avatarColor}
                    nickname={candidate.nickname}
                    size="sm"
                  />
                  <span className="group-palette__name">{candidate.nickname}</span>
                  {candidate.source === 'server' && (
                    <span className="group-palette__hint">검색 결과</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error !== null && (
          <p className="group-palette__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
