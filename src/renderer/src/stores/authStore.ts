/**
 * Projected auth state in the renderer.
 *
 * Structurally identical to how `uiStore` handles settings: explicit
 * hydration + push invalidation, and deliberately NO zustand persist
 * middleware — a persisted copy of "signed in" that outlives the actual
 * session is a lie the UI would then act on (docs/phase2-community.md §1.3).
 *
 * Before hydration, `phase === 'unconfigured'` is only a neutral placeholder;
 * after hydration it means the account sign-in is unavailable because this build
 * cannot provide it. `hydrated` deliberately distinguishes those two states.
 */

import { create } from 'zustand'
import type {
  AuthProvider,
  AuthSignInResult,
  AuthState,
  MyProfile
} from '../../../shared/types/auth'
import { invoke, onPush } from '../lib/ipc'

interface AuthStoreState {
  auth: AuthState
  /** False until the first `auth:getState` resolves. */
  hydrated: boolean
  /** True only while the deliberately lazy session restore is in flight. */
  initializing: boolean
  lastSignInResult: AuthSignInResult | null
  init: () => Promise<void>
  signIn: (provider: AuthProvider) => Promise<AuthSignInResult>
  signOut: () => Promise<void>
  setNickname: (nickname: string) => Promise<MyProfile>
}

const INITIAL: AuthState = {
  // Start unconfigured as a neutral, unresolved placeholder. Starting at
  // 'signed-out' would falsely show a login card before lazy restoration.
  phase: 'unconfigured',
  profile: null,
  email: null,
  avatarUrl: null,
  online: false,
  errorCode: null
}

let initialization: Promise<void> | null = null

export const useAuthStore = create<AuthStoreState>()((set, get) => ({
  auth: INITIAL,
  hydrated: false,
  initializing: false,
  lastSignInResult: null,

  init: async () => {
    if (initialization === null) {
      initialization = (async () => {
        set({ initializing: true })
        const auth = await invoke('auth:getState', {})
        set({ auth, hydrated: true, initializing: false })
        onPush('auth:changed', (next) => {
          set({ auth: next })
        })
      })()
    }
    const pending = initialization
    try {
      await pending
    } catch (error) {
      if (initialization === pending) initialization = null
      // A failure here must never break the app: stay unconfigured, which
      // leaves local study features available.
      console.error('[Bandal] 로그인 상태를 불러오지 못했습니다.', error)
      set({ hydrated: true, initializing: false })
    }
  },

  signIn: async (provider) => {
    const result = await invoke('auth:signIn', { provider })
    set({ lastSignInResult: result })
    return result
  },

  signOut: async () => {
    await invoke('auth:signOut', {})
    set({ auth: { ...get().auth, phase: 'signed-out', profile: null, email: null, avatarUrl: null } })
  },

  setNickname: async (nickname) => {
    const profile = await invoke('auth:setNickname', { nickname })
    const auth = get().auth
    if (auth.phase === 'signed-in' && auth.profile?.id === profile.id) set({ auth: { ...auth, profile } })
    return profile
  }
}))

/** Test-only: drop the memoized init so a fresh store can hydrate again. */
export function resetAuthStoreForTests(): void {
  initialization = null
  useAuthStore.setState({
    auth: INITIAL,
    hydrated: false,
    initializing: false,
    lastSignInResult: null
  })
}
