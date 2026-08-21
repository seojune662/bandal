import { describe, expect, test, vi } from 'vitest'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { createGroupRealtimeManager } from '../../../src/main/features/group/GroupRealtimeManager'

function fakeChannel(): RealtimeChannel {
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
    unsubscribe: vi.fn(() => Promise.resolve('ok')),
    presenceState: vi.fn(() => ({})),
    track: vi.fn(() => Promise.resolve('ok'))
  }
  return channel as unknown as RealtimeChannel
}

describe('group realtime auth lifecycle', () => {
  test('login → logout → login rebuilds channels without disposing the manager', async () => {
    let userId: string | null = 'user-1'
    const channels: RealtimeChannel[] = []
    const channel = vi.fn(() => {
      const created = fakeChannel()
      channels.push(created)
      return created
    })
    const client = {
      channel,
      removeChannel: vi.fn(() => Promise.resolve('ok'))
    } as unknown as SupabaseClient
    const manager = createGroupRealtimeManager({
      getClient: () => client,
      getUserId: () => userId,
      emit: vi.fn(),
      catchUp: () => Promise.resolve(),
      localMaxSeq: () => 0,
      drainOutbox: () => Promise.resolve()
    })

    await manager.open('group-1')
    expect(channel).toHaveBeenCalledTimes(1)

    manager.closeAll()
    expect(channels[0]?.unsubscribe).toHaveBeenCalledTimes(1)

    userId = null
    manager.resetAll()
    expect(channel).toHaveBeenCalledTimes(1)

    userId = 'user-2'
    manager.resetAll()
    expect(channel).toHaveBeenCalledTimes(2)
    expect(channel).toHaveBeenLastCalledWith('group:group-1', {
      config: { private: true, presence: { key: 'user-2' } }
    })

    manager.disposeAll()
  })
})
