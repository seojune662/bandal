import { describe, expect, test } from 'vitest'
import type {
  GroupMember,
  GroupMessage
} from '../../../src/shared/types/group'
import type { GroupEvent } from '../../../src/shared/types/group-events'
import {
  applyGroupEvent,
  applyGroupEvents,
  checkBatchSeq,
  hasMessageGap,
  hydrateGroupChat,
  initialGroupChatState,
  prependOlder,
  setMembers,
  systemMessageText,
  tickCooldown,
  unreadFrom,
  visibleMessages,
  type GroupChatViewState
} from '../../../src/renderer/src/features/group/groupModel'

function message(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: 'm1',
    groupId: 'g1',
    seq: 1,
    authorId: 'u1',
    kind: 'text',
    body: '안녕하세요',
    replyTo: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    editedAt: null,
    deleted: false,
    author: { nickname: '나리', avatarColor: 'blue', avatarEmoji: '🌙' },
    ...overrides
  }
}

function member(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    groupId: 'g1',
    userId: 'u2',
    role: 'member',
    joinedAt: '2026-08-06T00:00:00.000Z',
    nickname: '달기',
    avatarColor: 'gold',
    avatarEmoji: '🐰',
    ...overrides
  }
}

function run(
  events: GroupEvent[],
  from: GroupChatViewState = initialGroupChatState
): GroupChatViewState {
  return applyGroupEvents(from, events)
}

describe('checkBatchSeq', () => {
  test('applies the first batch whatever its seq', () => {
    expect(checkBatchSeq(null, 7)).toBe('apply')
  })

  test('applies the immediate successor', () => {
    expect(checkBatchSeq(3, 4)).toBe('apply')
  })

  test('drops a replayed or out-of-order batch as stale', () => {
    expect(checkBatchSeq(4, 4)).toBe('stale')
    expect(checkBatchSeq(4, 2)).toBe('stale')
  })

  test('reports a gap when a frame was missed', () => {
    // A gap means the reducer cannot be trusted — the caller rehydrates.
    expect(checkBatchSeq(4, 6)).toBe('gap')
  })
})

describe('hasMessageGap', () => {
  test('is false before anything is known', () => {
    expect(hasMessageGap(0, 42)).toBe(false)
  })

  test('is false for the next message and for replays', () => {
    expect(hasMessageGap(4, 5)).toBe(false)
    expect(hasMessageGap(4, 4)).toBe(false)
    expect(hasMessageGap(4, 3)).toBe(false)
  })

  test('is true when a message seq was skipped', () => {
    expect(hasMessageGap(4, 6)).toBe(true)
  })
})

describe('message ingestion', () => {
  test('appends a message and advances lastSeq', () => {
    const state = run([{ type: 'message', message: message({ seq: 5 }) }])
    expect(state.messages).toHaveLength(1)
    expect(state.lastSeq).toBe(5)
  })

  test('orders by seq, not arrival order', () => {
    // Clock skew is real; arrival order is not the truth, seq is.
    const state = run([
      { type: 'message', message: message({ id: 'b', seq: 3 }) },
      { type: 'message', message: message({ id: 'a', seq: 1 }) },
      { type: 'message', message: message({ id: 'c', seq: 2 }) }
    ])
    expect(state.messages.map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
  })

  test('re-delivering the same message id does not duplicate it', () => {
    const state = run([
      { type: 'message', message: message({ id: 'a', seq: 1 }) },
      { type: 'message', message: message({ id: 'a', seq: 1 }) }
    ])
    expect(state.messages).toHaveLength(1)
  })

  test('lastSeq never moves backwards', () => {
    const state = run([
      { type: 'message', message: message({ id: 'b', seq: 9 }) },
      { type: 'message', message: message({ id: 'a', seq: 2 }) }
    ])
    expect(state.lastSeq).toBe(9)
  })

  test('a deleted message arrives with a null body', () => {
    const state = run([
      { type: 'message', message: message({ deleted: true, body: 'secret' }) }
    ])
    expect(state.messages[0]?.body).toBeNull()
    expect(state.messages[0]?.deleted).toBe(true)
  })
})

describe('message-updated', () => {
  test('soft delete keeps the row but drops the body', () => {
    const base = run([{ type: 'message', message: message({ id: 'a' }) }])
    const state = applyGroupEvent(base, {
      type: 'message-updated',
      messageId: 'a',
      body: null,
      deleted: true
    })
    // The slot survives: removing it would shift everything on screen.
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.deleted).toBe(true)
    expect(state.messages[0]?.body).toBeNull()
  })

  test('an edit replaces the body and marks it edited', () => {
    const base = run([{ type: 'message', message: message({ id: 'a' }) }])
    const state = applyGroupEvent(base, {
      type: 'message-updated',
      messageId: 'a',
      body: '고쳤어요',
      deleted: false
    })
    expect(state.messages[0]?.body).toBe('고쳤어요')
    expect(state.messages[0]?.edited).toBe(true)
  })

  test('an update for an unknown id is ignored', () => {
    const state = applyGroupEvent(initialGroupChatState, {
      type: 'message-updated',
      messageId: 'nope',
      body: 'x',
      deleted: false
    })
    expect(state).toBe(initialGroupChatState)
  })
})

describe('local echo lifecycle', () => {
  test('an echo becomes a pending bubble', () => {
    const state = run([
      {
        type: 'local-echo',
        localId: 'L1',
        body: '보내는 중',
        createdAt: '2026-08-06T00:01:00.000Z'
      }
    ])
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]?.state).toBe('sending')
  })

  test('pending bubbles always render after committed messages', () => {
    // They have no seq yet, so last is the only honest position.
    const state = run([
      { type: 'message', message: message({ id: 'a', seq: 9 }) },
      {
        type: 'local-echo',
        localId: 'L1',
        body: '나중',
        createdAt: '2026-08-06T00:01:00.000Z'
      }
    ])
    const views = visibleMessages(state)
    expect(views[0]?.kind).toBe('committed')
    expect(views[1]?.kind).toBe('pending')
  })

  test('settling removes the bubble and advances lastSeq', () => {
    const state = run([
      {
        type: 'local-echo',
        localId: 'L1',
        body: 'x',
        createdAt: '2026-08-06T00:01:00.000Z'
      },
      {
        type: 'local-echo-settled',
        localId: 'L1',
        messageId: 'm9',
        seq: 9
      }
    ])
    expect(state.pending).toHaveLength(0)
    expect(state.lastSeq).toBe(9)
  })

  test('the broadcast echo of our own message replaces the bubble by id', () => {
    // The outbox id IS the remote message id, so this is a pure id match —
    // no timestamp heuristics, no duplicate window.
    const state = run([
      {
        type: 'local-echo',
        localId: 'L1',
        body: 'x',
        createdAt: '2026-08-06T00:01:00.000Z'
      },
      { type: 'message', message: message({ id: 'L1', seq: 4 }) }
    ])
    expect(state.pending).toHaveLength(0)
    expect(state.messages).toHaveLength(1)
  })

  test('failure marks the bubble and keeps the text recoverable', () => {
    const state = run([
      {
        type: 'local-echo',
        localId: 'L1',
        body: '중요한 내용',
        createdAt: '2026-08-06T00:01:00.000Z'
      },
      { type: 'local-echo-failed', localId: 'L1', reason: 'network' }
    ])
    expect(state.pending[0]?.state).toBe('failed')
    expect(state.pending[0]?.failure).toBe('network')
    expect(state.pending[0]?.body).toBe('중요한 내용')
  })

  test('a rate-limit failure starts the composer cooldown', () => {
    const state = run([
      {
        type: 'local-echo',
        localId: 'L1',
        body: 'x',
        createdAt: '2026-08-06T00:01:00.000Z'
      },
      {
        type: 'local-echo-failed',
        localId: 'L1',
        reason: 'rate-limit',
        retryAfter: 12
      }
    ])
    expect(state.sendCooldown).toBe(12)
  })

  test('retrying replaces the failed bubble instead of stacking a copy', () => {
    const state = run([
      {
        type: 'local-echo',
        localId: 'L1',
        body: 'x',
        createdAt: '2026-08-06T00:01:00.000Z'
      },
      { type: 'local-echo-failed', localId: 'L1', reason: 'network' },
      {
        type: 'local-echo',
        localId: 'L1',
        body: 'x',
        createdAt: '2026-08-06T00:02:00.000Z'
      }
    ])
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0]?.state).toBe('sending')
  })
})

describe('presence, membership and connection', () => {
  test('presence replaces the online set wholesale', () => {
    const state = run([
      { type: 'presence', online: [{ userId: 'u1' }, { userId: 'u2' }] },
      { type: 'presence', online: [{ userId: 'u1' }] }
    ])
    expect(state.onlineUserIds).toEqual(['u1'])
  })

  test('member-joined is an upsert, not an append', () => {
    const joined = member({ userId: 'u2' })
    const state = run([
      { type: 'member-joined', member: joined },
      { type: 'member-joined', member: { ...joined, role: 'admin' } }
    ])
    expect(state.members).toHaveLength(1)
    expect(state.members[0]?.role).toBe('admin')
  })

  test('member-left removes them from both the roster and presence', () => {
    const state = run([
      { type: 'member-joined', member: member({ userId: 'u2' }) },
      { type: 'presence', online: [{ userId: 'u2' }] },
      { type: 'member-left', userId: 'u2' }
    ])
    expect(state.members).toHaveLength(0)
    expect(state.onlineUserIds).toEqual([])
  })

  test('connection state is carried through', () => {
    const state = run([{ type: 'connection', state: 'degraded-polling' }])
    expect(state.connection).toBe('degraded-polling')
  })
})

describe('hydration and paging', () => {
  test('hydrate sorts by seq and seeds lastSeq from the newest', () => {
    const state = hydrateGroupChat({
      messages: [message({ id: 'b', seq: 3 }), message({ id: 'a', seq: 1 })],
      members: [member()],
      pending: [
        {
          localId: 'L1',
          groupId: 'g1',
          body: '큐에 남은 것',
          replyTo: null,
          createdAt: '2026-08-06T00:01:00.000Z',
          state: 'failed',
          attempts: 6,
          lastError: 'network'
        }
      ],
      connection: 'connected'
    })
    expect(state.messages.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(state.lastSeq).toBe(3)
    // A failed send survives an app restart — the outbox is a table (§4.4).
    expect(state.pending[0]?.state).toBe('failed')
  })

  test('prependOlder inserts an older page and drops duplicates', () => {
    const base = hydrateGroupChat({
      messages: [message({ id: 'c', seq: 3 })],
      members: [],
      pending: [],
      connection: 'connected'
    })
    const state = prependOlder(base, [
      message({ id: 'a', seq: 1 }),
      message({ id: 'c', seq: 3 })
    ])
    expect(state.messages.map((entry) => entry.id)).toEqual(['a', 'c'])
  })

  test('prependOlder with nothing new returns the same object', () => {
    const base = hydrateGroupChat({
      messages: [message({ id: 'a', seq: 1 })],
      members: [],
      pending: [],
      connection: 'connected'
    })
    expect(prependOlder(base, [])).toBe(base)
    expect(prependOlder(base, [message({ id: 'a', seq: 1 })])).toBe(base)
  })

  test('setMembers replaces the roster', () => {
    const state = setMembers(initialGroupChatState, [member(), member({ userId: 'u3' })])
    expect(state.members).toHaveLength(2)
  })
})

describe('derived helpers', () => {
  test('unreadFrom counts messages past the read cursor', () => {
    const state = hydrateGroupChat({
      messages: [
        message({ id: 'a', seq: 1 }),
        message({ id: 'b', seq: 2 }),
        message({ id: 'c', seq: 3 })
      ],
      members: [],
      pending: [],
      connection: 'connected'
    })
    expect(unreadFrom(state, 1)).toBe(2)
    expect(unreadFrom(state, 3)).toBe(0)
  })

  test('tickCooldown counts down and stops at zero', () => {
    const at2 = tickCooldown({ ...initialGroupChatState, sendCooldown: 2 })
    expect(at2.sendCooldown).toBe(1)
    const at0 = tickCooldown({ ...initialGroupChatState, sendCooldown: 0 })
    expect(at0.sendCooldown).toBe(0)
  })

  test('system copy is built in the renderer from the stored event code', () => {
    // The server stores 'joined', not Korean prose, so wording changes are
    // never migrations (supabase/README.md §8-⑨).
    expect(systemMessageText('joined', '달기')).toContain('달기')
    expect(systemMessageText('code_auto_revoked', '')).toContain('초대 코드')
    expect(systemMessageText('who-knows', '나리')).toBe('알림')
  })
})

describe('immutability', () => {
  test('the reducer never mutates the input state', () => {
    const before = hydrateGroupChat({
      messages: [message({ id: 'a', seq: 1 })],
      members: [],
      pending: [],
      connection: 'connected'
    })
    const snapshot = JSON.stringify(before)
    applyGroupEvent(before, { type: 'message', message: message({ id: 'b', seq: 2 }) })
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
