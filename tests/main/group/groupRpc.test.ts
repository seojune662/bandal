import { describe, expect, test } from 'vitest'
import {
  rpcEnsureDirectChat,
  selectPendingInvites
} from '../../../src/main/features/group/groupRpc'
import type { SupabaseClient } from '@supabase/supabase-js'

interface CapturedFilters {
  table: string | null
  eq: Array<[string, string]>
}

function fakeClient(rows: unknown[], captured: CapturedFilters): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: (column: string, value: string) => {
      captured.eq.push([column, value])
      return builder
    },
    then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rows, error: null })
  }
  return {
    from: (table: string) => {
      captured.table = table
      return builder
    }
  } as unknown as SupabaseClient
}

describe('selectPendingInvites', () => {
  test('only fetches invites addressed to the caller', async () => {
    const captured: CapturedFilters = { table: null, eq: [] }
    await selectPendingInvites(fakeClient([], captured), 'me-uid')

    expect(captured.table).toBe('group_invites')
    // Without the invitee filter, RLS's member-visibility branch returns the
    // inviter's own outgoing invite — the "초대장이 나한테 와" bug.
    expect(captured.eq).toContainEqual(['invitee_id', 'me-uid'])
    expect(captured.eq).toContainEqual(['status', 'pending'])
  })

  test('maps rows to PendingGroupInvite', async () => {
    const captured: CapturedFilters = { table: null, eq: [] }
    const rows = [
      {
        id: 'inv-1',
        group_id: 'grp-1',
        created_at: '2026-08-18T00:00:00Z',
        study_groups: { name: '알고리즘 스터디', color: 'forest' },
        profiles: { nickname: '하늘' }
      }
    ]
    const invites = await selectPendingInvites(fakeClient(rows, captured), 'me-uid')

    expect(invites).toEqual([
      {
        inviteId: 'inv-1',
        groupId: 'grp-1',
        groupName: '알고리즘 스터디',
        groupColor: 'forest',
        inviterNickname: '하늘',
        createdAt: '2026-08-18T00:00:00Z'
      }
    ])
  })
})

describe('rpcEnsureDirectChat', () => {
  test('uses the friend-only RPC and maps the peer profile', async () => {
    const rpc = async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('ensure_direct_chat')
      expect(args).toEqual({ p_peer_id: 'friend-1' })
      return {
        data: {
          groupId: 'direct-1',
          peer: {
            userId: 'friend-1',
            nickname: '하늘',
            avatarColor: 'blue',
            avatarEmoji: '☁️'
          }
        },
        error: null
      }
    }
    const client = { rpc } as unknown as SupabaseClient

    await expect(rpcEnsureDirectChat(client, 'friend-1')).resolves.toEqual({
      groupId: 'direct-1',
      peer: {
        userId: 'friend-1',
        nickname: '하늘',
        avatarColor: 'blue',
        avatarEmoji: '☁️',
        status: 'accepted',
        direction: 'outgoing'
      }
    })
  })
})
