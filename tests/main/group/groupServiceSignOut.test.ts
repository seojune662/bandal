import { describe, expect, test, vi } from 'vitest'
import { createGroupService } from '../../../src/main/features/group/GroupService'
import type { AuthService } from '../../../src/main/features/group/authService'
import type { GroupRealtimeManager } from '../../../src/main/features/group/GroupRealtimeManager'
import type { GroupRepo } from '../../../src/main/features/group/groupRepo'
import type { OutboxUploader } from '../../../src/main/features/group/OutboxUploader'
import type { RateGuard } from '../../../src/main/features/group/rateGuard'

describe('GroupService sign-out', () => {
  test('closes reusable realtime and clears group and whiteboard account caches', async () => {
    const calls: string[] = []
    const disposeAll = vi.fn()
    const service = createGroupService({
      repo: {
        clearAll: () => calls.push('group-cache')
      } as unknown as GroupRepo,
      whiteboardRepo: {
        clearAll: () => calls.push('whiteboard-cache')
      },
      auth: {
        signOut: async () => {
          calls.push('auth')
        }
      } as unknown as AuthService,
      realtime: {
        closeAll: () => calls.push('realtime-close'),
        disposeAll
      } as unknown as GroupRealtimeManager,
      outbox: {} as OutboxUploader,
      rateGuard: {} as RateGuard,
      getClient: () => null,
      emit: vi.fn(),
      invalidate: () => calls.push('invalidate')
    })

    await service.signOut()

    expect(calls).toEqual([
      'realtime-close',
      'auth',
      'group-cache',
      'whiteboard-cache',
      'invalidate'
    ])
    expect(disposeAll).not.toHaveBeenCalled()
  })
})
