import { create } from 'zustand'
import type { FriendEntry } from '../../../shared/types/group'
import { invoke, onPush } from '../lib/ipc'

interface FriendsState {
  friends: FriendEntry[]
  loading: boolean
  error: string | null
  initialized: boolean
  init: () => Promise<void>
  load: () => Promise<void>
  request: (nickname: string) => Promise<void>
  respond: (requesterId: string, accept: boolean) => Promise<void>
  remove: (userId: string) => Promise<void>
}

let subscribed = false
let initialization: Promise<void> | null = null
let accountEpoch = 0

export const useFriendsStore = create<FriendsState>()((set, get) => ({
  friends: [],
  loading: false,
  error: null,
  initialized: false,
  init: async () => {
    if (!subscribed) {
      subscribed = true
      onPush('groups:invalidated', ({ reason }) => {
        if (reason === 'profile') void get().load()
      })
      onPush('auth:changed', (auth) => {
        accountEpoch += 1
        initialization = null
        if (auth.phase === 'signed-in') {
          set({ initialized: false })
          void get().load()
        } else {
          set({
            friends: [],
            loading: false,
            error: null,
            initialized: false
          })
        }
      })
    }
    if (initialization === null) {
      const request = get().load()
      initialization = request
      void request.finally(() => {
        if (initialization === request) initialization = null
      })
    }
    await initialization
  },
  load: async () => {
    const epoch = accountEpoch
    set({ loading: true })
    try {
      const friends = await invoke('friends:list', {})
      if (epoch !== accountEpoch) return
      set({ friends, loading: false, error: null, initialized: true })
    } catch (error) {
      if (epoch !== accountEpoch) return
      set({
        loading: false,
        initialized: true,
        error: error instanceof Error ? error.message : '친구 목록을 불러오지 못했어요.'
      })
    }
  },
  request: async (nickname) => {
    await invoke('friends:request', { nickname: nickname.trim() })
    await get().load()
  },
  respond: async (requesterId, accept) => {
    await invoke('friends:respond', { requesterId, accept })
    await get().load()
  },
  remove: async (userId) => {
    await invoke('friends:remove', { userId })
    set({ friends: get().friends.filter((friend) => friend.userId !== userId) })
  }
}))

/** Test-only: reset module latches and cached account projection. */
export function resetFriendsStoreForTests(): void {
  subscribed = false
  initialization = null
  accountEpoch = 0
  useFriendsStore.setState({
    friends: [],
    loading: false,
    error: null,
    initialized: false
  })
}
