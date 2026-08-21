import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  createWhiteboardService,
  type SupabaseClientLike,
  type WhiteboardService
} from '../../../src/main/features/whiteboard/whiteboardService'
import { createWhiteboardRepo } from '../../../src/main/features/whiteboard/whiteboardRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

class FakeQuery {
  select(): this {
    return this
  }

  eq(): this {
    return this
  }

  maybeSingle(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({
      data: {
        id: 'board-1',
        group_id: 'group-1',
        title: '화이트보드',
        created_by: 'user-1',
        created_at: '2026-08-22T00:00:00.000Z',
        updated_at: '2026-08-22T00:00:00.000Z'
      },
      error: null
    })
  }

  order(): Promise<{ data: unknown[]; error: null }> {
    return Promise.resolve({ data: [], error: null })
  }
}

function fakeChannel(): RealtimeChannel {
  return {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
    unsubscribe: vi.fn(() => Promise.resolve('ok'))
  } as unknown as RealtimeChannel
}

describe('whiteboard auth lifecycle', () => {
  let testDb: TestDb
  let service: WhiteboardService | null

  beforeEach(() => {
    testDb = createTestDb()
    service = null
  }, 30_000)

  afterEach(() => {
    service?.dispose()
    testDb.cleanup()
  })

  test('auth reset closes the old channel and reopens active boards after login', async () => {
    let userId: string | null = 'user-1'
    const channels: RealtimeChannel[] = []
    const channel = vi.fn(() => {
      const created = fakeChannel()
      channels.push(created)
      return created
    })
    const client = {
      from: (_table: string) => new FakeQuery(),
      channel,
      removeChannel: vi.fn(() => Promise.resolve('ok'))
    } as unknown as SupabaseClientLike
    service = createWhiteboardService({
      repo: createWhiteboardRepo(testDb.db),
      getClient: () => client,
      getUserId: () => userId,
      emit: vi.fn()
    })

    await service.open('group-1')
    expect(channel).toHaveBeenCalledTimes(1)

    userId = null
    service.resetForAuthChange()
    expect(channels[0]?.unsubscribe).toHaveBeenCalledTimes(1)
    expect(channel).toHaveBeenCalledTimes(1)

    userId = 'user-2'
    service.resetForAuthChange()
    expect(channel).toHaveBeenCalledTimes(2)
  })
})
