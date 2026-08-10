import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AuthState } from '../../../src/shared/types/auth'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {})
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)

import {
  resetAuthStoreForTests,
  useAuthStore
} from '../../../src/renderer/src/stores/authStore'

const signedIn: AuthState = {
  phase: 'signed-in',
  profile: {
    id: 'user-1',
    nickname: '반달이',
    avatarColor: 'blue',
    avatarEmoji: '🌙'
  },
  online: true,
  errorCode: null
}

beforeEach(() => {
  resetAuthStoreForTests()
  vi.clearAllMocks()
})

describe('lazy auth restoration', () => {
  test('does not read auth state until an entry point explicitly initializes it', async () => {
    ipc.invoke.mockResolvedValue(signedIn)

    expect(useAuthStore.getState().hydrated).toBe(false)
    expect(ipc.invoke).not.toHaveBeenCalled()

    await useAuthStore.getState().init()

    expect(ipc.invoke).toHaveBeenCalledTimes(1)
    expect(ipc.invoke).toHaveBeenCalledWith('auth:getState', {})
    expect(useAuthStore.getState().auth).toEqual(signedIn)
    expect(useAuthStore.getState().hydrated).toBe(true)
  })

  test('shares one in-flight restore across simultaneous entry points', async () => {
    let resolveAuth: ((auth: AuthState) => void) | undefined
    ipc.invoke.mockReturnValue(
      new Promise<AuthState>((resolve) => {
        resolveAuth = resolve
      })
    )

    const first = useAuthStore.getState().init()
    const second = useAuthStore.getState().init()

    expect(ipc.invoke).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().initializing).toBe(true)

    resolveAuth?.(signedIn)
    await Promise.all([first, second])

    expect(useAuthStore.getState().initializing).toBe(false)
    expect(useAuthStore.getState().hydrated).toBe(true)
  })
})
