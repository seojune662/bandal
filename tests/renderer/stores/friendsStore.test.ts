import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AuthState } from '../../../src/shared/types/auth'
import type { FriendEntry } from '../../../src/shared/types/group'

const ipc = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
  onPush: vi.fn((channel: string, listener: (payload: unknown) => void) => {
    ipc.listeners.set(channel, listener)
    return () => ipc.listeners.delete(channel)
  })
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: ipc.invoke,
  onPush: ipc.onPush
}))

import {
  resetFriendsStoreForTests,
  useFriendsStore
} from '../../../src/renderer/src/stores/friendsStore'

const friend: FriendEntry = {
  userId: 'friend-1',
  nickname: '하늘',
  avatarColor: 'blue',
  avatarEmoji: '☁️',
  status: 'accepted',
  direction: 'incoming',
  unread: 2
}

beforeEach(() => {
  resetFriendsStoreForTests()
  ipc.listeners.clear()
  vi.clearAllMocks()
  ipc.invoke.mockResolvedValue([friend])
})

describe('friends store account projection', () => {
  test('a slow earlier refresh cannot restore a cleared unread badge', async () => {
    let resolveEarlier!: (friends: FriendEntry[]) => void
    ipc.invoke.mockReturnValueOnce(new Promise<FriendEntry[]>((resolve) => { resolveEarlier = resolve }))
    const earlier = useFriendsStore.getState().load()
    ipc.invoke.mockResolvedValueOnce([{ ...friend, unread: 0, hasUnread: false }])
    await useFriendsStore.getState().load()
    resolveEarlier([friend]); await earlier
    expect(useFriendsStore.getState().friends[0]?.unread).toBe(0)
  })
  test('loads on each non-overlapping init so opening the hub refreshes requests', async () => {
    await useFriendsStore.getState().init()
    await useFriendsStore.getState().init()

    expect(ipc.invoke).toHaveBeenCalledTimes(2)
    expect(useFriendsStore.getState().friends).toEqual([friend])
  })

  test('clears the prior account immediately on sign-out', async () => {
    await useFriendsStore.getState().init()
    const authChanged = ipc.listeners.get('auth:changed')
    expect(authChanged).toBeDefined()

    authChanged?.({
      phase: 'signed-out',
      profile: null,
      online: false,
      errorCode: null
    } satisfies AuthState)

    expect(useFriendsStore.getState().friends).toEqual([])
    expect(useFriendsStore.getState().initialized).toBe(false)
  })

  test('ignores a previous account request that resolves after sign-out', async () => {
    let resolveRequest: ((friends: FriendEntry[]) => void) | null = null
    ipc.invoke.mockReturnValue(new Promise<FriendEntry[]>((resolve) => {
      resolveRequest = resolve
    }))
    const pending = useFriendsStore.getState().init()
    ipc.listeners.get('auth:changed')?.({
      phase: 'signed-out',
      profile: null,
      online: false,
      errorCode: null
    } satisfies AuthState)
    resolveRequest?.([friend])
    await pending

    expect(useFriendsStore.getState().friends).toEqual([])
  })
})
