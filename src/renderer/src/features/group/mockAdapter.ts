/**
 * [P2-D] Dev-only fake transport for the group feature.
 *
 * Lets the whole 함께하기 surface be built and demoed with no Supabase project,
 * no OAuth and no second account. It plugs in at `lib/ipc.ts`, so every layer
 * above it — the store, the hook, the reducer, the seq/batch handling and the
 * components — is exactly the code that ships.
 *
 * The script is not decoration. It exercises the five states that are
 * genuinely hard to reach by hand and therefore usually ship broken:
 *   1. a message arriving from someone else while you are reading
 *   2. presence appearing and disappearing
 *   3. a local echo settling into a committed message
 *   4. a permission-ish failure (rejected send → 빨간 느낌표 + 다시 시도)
 *   5. connection degrading to polling and recovering
 *
 * Any channel it does not own falls through to the real bridge, so Phase 1
 * keeps working while the mock is installed.
 *
 * Enable with `?mockGroups=1`, or `localStorage.bandalMockGroups = '1'`.
 */

import type {
  IpcChannel,
  IpcRequest,
  IpcResponse
} from '../../../../shared/ipc/contract'
import type {
  GroupEventBatch,
  PushChannel,
  PushPayload
} from '../../../../shared/ipc/events'
import type { AuthState } from '../../../../shared/types/auth'
import type {
  GroupMember,
  GroupMessage,
  GroupSummary
} from '../../../../shared/types/group'
import type { GroupEvent } from '../../../../shared/types/group-events'
import { setIpcAdapter, type IpcAdapter, type Unsubscribe } from '../../lib/ipc'

const ME = 'mock-user-me'
const PEER = 'mock-user-peer'
const GROUP_ID = 'mock-group-1'

const MOCK_AUTH: AuthState = {
  phase: 'signed-in',
  profile: {
    id: ME,
    nickname: '나리',
    avatarColor: 'blue',
    avatarEmoji: '🌙'
  },
  online: true,
  errorCode: null
}

const MOCK_GROUPS: GroupSummary[] = [
  {
    id: GROUP_ID,
    name: '자료구조 3조',
    color: 'violet',
    courseId: null,
    memberCount: 3,
    unread: 2,
    lastMsgAt: new Date().toISOString(),
    joinedAt: new Date(Date.now() - 86_400_000).toISOString()
  },
  {
    id: 'mock-group-2',
    name: '운영체제 전체 공지',
    color: 'green',
    courseId: null,
    memberCount: 42,
    unread: 0,
    lastMsgAt: new Date(Date.now() - 3_600_000).toISOString(),
    joinedAt: new Date(Date.now() - 604_800_000).toISOString()
  }
]

const MOCK_MEMBERS: GroupMember[] = [
  {
    groupId: GROUP_ID,
    userId: ME,
    role: 'owner',
    joinedAt: new Date(Date.now() - 86_400_000).toISOString(),
    nickname: '나리',
    avatarColor: 'blue',
    avatarEmoji: '🌙'
  },
  {
    groupId: GROUP_ID,
    userId: PEER,
    role: 'member',
    joinedAt: new Date(Date.now() - 43_200_000).toISOString(),
    nickname: '달기',
    avatarColor: 'gold',
    avatarEmoji: '🐰'
  },
  {
    groupId: GROUP_ID,
    userId: 'mock-user-3',
    role: 'member',
    joinedAt: new Date(Date.now() - 3_600_000).toISOString(),
    nickname: '별이',
    avatarColor: 'pink',
    avatarEmoji: '⭐'
  }
]

let seqCounter = 3

function message(
  authorId: string,
  body: string,
  kind: 'text' | 'system' = 'text'
): GroupMessage {
  const member = MOCK_MEMBERS.find((entry) => entry.userId === authorId)
  seqCounter += 1
  return {
    id: `mock-msg-${seqCounter}`,
    groupId: GROUP_ID,
    seq: seqCounter,
    authorId,
    kind,
    body,
    replyTo: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deleted: false,
    author: {
      nickname: member?.nickname ?? '알 수 없음',
      avatarColor: member?.avatarColor ?? 'moon',
      avatarEmoji: member?.avatarEmoji ?? '🌙'
    }
  }
}

const HISTORY: GroupMessage[] = [
  { ...message(PEER, 'joined', 'system'), seq: 1, id: 'mock-msg-1' },
  { ...message(PEER, '자료구조 발표 자료 정리 시작했어요'), seq: 2, id: 'mock-msg-2' },
  { ...message(ME, '고마워요! 나는 3장부터 볼게요'), seq: 3, id: 'mock-msg-3' }
]

interface Listener {
  channel: PushChannel
  cb: (payload: never) => void
}

export interface MockGroupAdapter extends IpcAdapter {
  /** Runs the scripted stream once. Idempotent per install. */
  play(): void
  stop(): void
}

/**
 * @param real Fallback for channels the mock does not own (all of Phase 1).
 */
export function createMockGroupAdapter(real: IpcAdapter): MockGroupAdapter {
  const listeners: Listener[] = []
  const timers: number[] = []
  let batchSeq = 0
  let played = false

  function emitPush<K extends PushChannel>(
    channel: K,
    payload: PushPayload<K>
  ): void {
    for (const listener of listeners) {
      if (listener.channel === channel) {
        ;(listener.cb as (value: PushPayload<K>) => void)(payload)
      }
    }
  }

  function emitEvents(events: GroupEvent[]): void {
    batchSeq += 1
    const batch: GroupEventBatch = { groupId: GROUP_ID, seq: batchSeq, events }
    emitPush('group:event-batch', batch)
  }

  function after(ms: number, fn: () => void): void {
    timers.push(window.setTimeout(fn, ms))
  }

  function handle(channel: IpcChannel, req: unknown): unknown {
    switch (channel) {
      case 'auth:getState':
        return MOCK_AUTH
      case 'auth:signIn':
        return { ok: true }
      case 'auth:signOut':
        return { ok: true }
      case 'groups:list':
        return MOCK_GROUPS
      case 'groups:members':
        return MOCK_MEMBERS
      case 'groups:create': {
        const input = req as { name: string; color: string }
        const group: GroupSummary = {
          id: `mock-group-${Date.now()}`,
          name: input.name,
          color: input.color,
          courseId: null,
          memberCount: 1,
          unread: 0,
          lastMsgAt: null,
          joinedAt: new Date().toISOString()
        }
        MOCK_GROUPS.unshift(group)
        return {
          group,
          invite: {
            code: 'K7M2QX',
            groupId: group.id,
            expiresAt: new Date(Date.now() + 604_800_000).toISOString(),
            maxUses: 0,
            useCount: 0
          }
        }
      }
      case 'groups:joinWithCode': {
        const input = req as { code: string }
        // Two scripted outcomes so both branches of the overlay are reachable.
        if (input.code === 'K7M2QX') {
          return { ok: true, group: MOCK_GROUPS[0], alreadyMember: false }
        }
        return { ok: false, error: 'invalid_code' }
      }
      case 'groups:currentCode':
        return {
          code: 'K7M2QX',
          groupId: GROUP_ID,
          expiresAt: new Date(Date.now() + 604_800_000).toISOString(),
          maxUses: 0,
          useCount: 3
        }
      case 'groups:linkCourse': {
        const input = req as { groupId: string; courseId: string | null }
        const found =
          MOCK_GROUPS.find((group) => group.id === input.groupId) ?? MOCK_GROUPS[0]
        if (found !== undefined) found.courseId = input.courseId
        return found
      }
      case 'groups:findProfile': {
        const input = req as { nickname: string }
        const member = MOCK_MEMBERS.find(
          (entry) => entry.nickname === input.nickname
        )
        return member === undefined
          ? null
          : {
              id: member.userId,
              nickname: member.nickname,
              avatarColor: member.avatarColor,
              avatarEmoji: member.avatarEmoji,
              isFriend: false
            }
      }
      case 'groups:inviteByNickname':
        return { status: 'pending', userId: PEER, inviteId: 'mock-invite-1' }
      case 'invites:listPending':
        return []
      case 'friends:list':
        return [
          {
            userId: PEER,
            nickname: '달기',
            avatarColor: 'gold',
            avatarEmoji: '🐰',
            status: 'accepted',
            direction: 'outgoing'
          }
        ]
      case 'groupChat:open':
        after(80, () => {
          emitEvents([{ type: 'connection', state: 'connected' }])
        })
        return {
          group: MOCK_GROUPS[0] ?? null,
          messages: HISTORY,
          members: MOCK_MEMBERS,
          pending: [],
          connection: 'reconnecting',
          myUserId: ME,
          lastReadSeq: 2
        }
      case 'groupChat:send': {
        const input = req as { groupId: string; body: string }
        const localId = `mock-local-${Date.now()}`
        emitEvents([
          {
            type: 'local-echo',
            localId,
            body: input.body,
            createdAt: new Date().toISOString()
          }
        ])
        // "실패" 로 시작하는 메시지는 거절 경로를 재현한다 — 빨간 느낌표 + 다시 시도.
        if (input.body.startsWith('실패')) {
          after(700, () => {
            emitEvents([
              { type: 'local-echo-failed', localId, reason: 'rejected' }
            ])
          })
        } else {
          after(500, () => {
            const committed = message(ME, input.body)
            emitEvents([
              {
                type: 'local-echo-settled',
                localId,
                messageId: committed.id,
                seq: committed.seq
              },
              { type: 'message', message: committed }
            ])
          })
        }
        return { localId }
      }
      case 'groupChat:loadOlder':
        return []
      case 'groupChat:markRead':
      case 'groupChat:close':
      case 'groupChat:retry':
      case 'groupChat:deleteMessage':
      case 'groups:leave':
      case 'groups:kick':
      case 'safety:block':
      case 'safety:report':
        return { ok: true }
      default:
        return undefined
    }
  }

  return {
    invoke<K extends IpcChannel>(
      channel: K,
      req: IpcRequest<K>
    ): Promise<IpcResponse<K>> {
      const result = handle(channel, req)
      if (result === undefined) return real.invoke(channel, req)
      // A small delay keeps loading states honest instead of always resolving
      // in the same tick as the render.
      return new Promise((resolve) => {
        window.setTimeout(() => resolve(result as IpcResponse<K>), 60)
      })
    },

    on<K extends PushChannel>(
      channel: K,
      cb: (payload: PushPayload<K>) => void
    ): Unsubscribe {
      if (
        channel !== 'group:event-batch' &&
        channel !== 'auth:changed' &&
        channel !== 'groups:invalidated'
      ) {
        return real.on(channel, cb)
      }
      const listener: Listener = {
        channel,
        cb: cb as (payload: never) => void
      }
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },

    play() {
      if (played) return
      played = true
      after(1_500, () => {
        emitEvents([
          { type: 'presence', online: [{ userId: ME }, { userId: PEER }] }
        ])
      })
      after(3_000, () => {
        emitEvents([{ type: 'message', message: message(PEER, '3장 요약 올렸어요!') }])
      })
      after(6_000, () => {
        emitEvents([{ type: 'connection', state: 'degraded-polling' }])
      })
      after(10_000, () => {
        emitEvents([
          { type: 'connection', state: 'connected' },
          { type: 'message', message: message('mock-user-3', '저도 곧 붙일게요') },
          { type: 'presence', online: [{ userId: ME }] }
        ])
      })
    },

    stop() {
      for (const timer of timers) window.clearTimeout(timer)
      timers.length = 0
    }
  }
}

/** True when the dev flag asked for the fake transport. */
export function shouldUseMockGroups(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('mockGroups') === '1') {
      return true
    }
    return window.localStorage.getItem('bandalMockGroups') === '1'
  } catch {
    return false
  }
}

/** Installs the mock when the flag is set. Returns true when installed. */
export function installMockGroupsIfRequested(): boolean {
  if (!shouldUseMockGroups()) return false
  const real: IpcAdapter = {
    invoke: (channel, req) => window.bandal.invoke(channel, req),
    on: (channel, cb) => window.bandal.on(channel, cb)
  }
  const mock = createMockGroupAdapter(real)
  setIpcAdapter(mock)
  mock.play()
  console.info('[bandal] group mock adapter installed (?mockGroups=1)')
  return true
}
