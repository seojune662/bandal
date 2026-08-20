/**
 * The invite code, after the toast is gone.
 *
 * `create_group` has always minted a code and `groups:currentCode` /
 * `groups:regenerateCode` have always been wired through IPC, the service and
 * the SQL — but nothing in the renderer ever called them. The only time a
 * human saw a code was one toast at group creation, and the value was never
 * stored anywhere. So the app told people to "paste the invite code into
 * KakaoTalk" while giving them no way to get it back.
 *
 * This is that way back.
 *
 * Who may rotate a code is derived from the load, not asked separately:
 * `current_invite_code()` raises `not_authorized` for a plain member, returns
 * `null` for an admin whose code expired, and returns the code otherwise. So
 * the answer to "can this person make a new one?" is already in the response.
 */

import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../lib/ipc'
import { showToast } from '../../app/toast'
import { formatInviteCode } from '../../../../shared/group/inviteCode'
import type { InviteCodeInfo } from '../../../../shared/types/group'
import { GroupIcon } from './groupIcons'
import { inviteCodeStatus } from './inviteCodeStatus'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; info: InviteCodeInfo }
  /** Admin, but the live code expired — the SQL returns null exactly here. */
  | { phase: 'expired' }
  /** Not an admin: this person cannot see or mint a code at all. */
  | { phase: 'forbidden' }
  | { phase: 'error'; message: string }

/** The RPC raises this; PostgREST hands the raw code through as the message. */
function isNotAuthorized(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes('not_authorized')
  )
}

export function InviteCodePanel({ groupId }: { groupId: string }): JSX.Element {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const info = await invoke('groups:currentCode', { groupId })
      setState(info === null ? { phase: 'expired' } : { phase: 'ready', info })
    } catch (error) {
      if (isNotAuthorized(error)) {
        setState({ phase: 'forbidden' })
        return
      }
      setState({
        phase: 'error',
        message:
          error instanceof Error ? error.message : '코드를 불러오지 못했어요.'
      })
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  const copy = useCallback((code: string) => {
    void navigator.clipboard
      .writeText(code)
      .then(() => showToast(`코드 ${code} 복사됐어요 · 카톡에 붙여넣으면 돼요`))
      .catch(() => showToast('복사하지 못했어요.', 'danger'))
  }, [])

  const regenerate = useCallback(async () => {
    // A group has exactly one live code (partial unique index), so a new one
    // kills the old immediately — and the old one is already sitting in
    // somebody's chat window.
    if (
      !window.confirm('새 코드를 만들면 지금 코드는 바로 못 쓰게 돼요. 계속할까요?')
    ) {
      return
    }
    setBusy(true)
    try {
      const info = await invoke('groups:regenerateCode', { groupId })
      setState({ phase: 'ready', info })
      showToast('새 코드를 만들었어요.')
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '새 코드를 만들지 못했어요.',
        'danger'
      )
    } finally {
      setBusy(false)
    }
  }, [groupId])

  const canRegenerate = state.phase === 'ready' || state.phase === 'expired'

  return (
    <section className="invite-code" aria-label="초대 코드">
      <p className="invite-code__label">초대 코드</p>

      {state.phase === 'loading' && (
        <p className="invite-code__status" role="status">
          불러오는 중…
        </p>
      )}

      {state.phase === 'ready' && (
        <>
          <div className="invite-code__row">
            <output className="invite-code__value">
              {formatInviteCode(state.info.code)}
            </output>
            <button
              type="button"
              className="invite-code__copy"
              onClick={() => copy(formatInviteCode(state.info.code))}
            >
              <GroupIcon name="copy" />
              복사
            </button>
          </div>
          <p className="invite-code__status">
            {inviteCodeStatus(state.info, Date.now()).line}
          </p>
        </>
      )}

      {state.phase === 'expired' && (
        <p className="invite-code__status">
          쓸 수 있는 코드가 없어요. 새로 만들어 주세요.
        </p>
      )}

      {state.phase === 'forbidden' && (
        <p className="invite-code__status">
          코드는 그룹을 만든 사람만 볼 수 있어요. 닉네임으로 초대해 보세요.
        </p>
      )}

      {state.phase === 'error' && (
        <p className="invite-code__status">{state.message}</p>
      )}

      {canRegenerate && (
        <button
          type="button"
          className="invite-code__regenerate"
          disabled={busy}
          onClick={() => void regenerate()}
        >
          {busy ? '만드는 중…' : '새 코드 만들기'}
        </button>
      )}
    </section>
  )
}
