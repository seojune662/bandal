/**
 * Projected auth state in the renderer.
 *
 * Structurally identical to how `uiStore` handles settings: explicit
 * hydration + push invalidation, and deliberately NO zustand persist
 * middleware — a persisted copy of "signed in" that outlives the actual
 * session is a lie the UI would then act on (docs/phase2-community.md §1.3).
 *
 * `phase === 'unconfigured'` is the important one: the 함께하기 UI must be
 * ABSENT, not disabled. A greyed-out button for a feature that cannot exist in
 * this build is noise (§1.4-4).
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
  lastSignInResult: AuthSignInResult | null
  init: () => Promise<void>
  signIn: (provider: AuthProvider) => Promise<AuthSignInResult>
  signOut: () => Promise<void>
  setNickname: (nickname: string) => Promise<MyProfile>
  setAvatar: (patch: { color?: string; emoji?: string }) => Promise<MyProfile>
}

const INITIAL: AuthState = {
  // Start unconfigured so the section renders NOTHING during the first frame.
  // Starting at 'signed-out' would flash a login card at every launch.
  phase: 'unconfigured',
  profile: null,
  online: false,
  errorCode: null
}

let initialization: Promise<void> | null = null

export const useAuthStore = create<AuthStoreState>()((set, get) => ({
  auth: INITIAL,
  hydrated: false,
  lastSignInResult: null,

  init: async () => {
    if (initialization === null) {
      initialization = (async () => {
        const auth = await invoke('auth:getState', {})
        set({ auth, hydrated: true })
        onPush('auth:changed', (next) => {
          set({ auth: next })
        })
      })()
    }
    try {
      await initialization
    } catch (error) {
      initialization = null
      // A failure here must never break the app: stay unconfigured, which
      // hides the community UI and leaves Phase 1 untouched.
      console.error('[Bandal] 로그인 상태를 불러오지 못했습니다.', error)
      set({ hydrated: true })
    }
  },

  signIn: async (provider) => {
    const result = await invoke('auth:signIn', { provider })
    set({ lastSignInResult: result })
    return result
  },

  signOut: async () => {
    await invoke('auth:signOut', {})
    set({ auth: { ...get().auth, phase: 'signed-out', profile: null } })
  },

  setNickname: async (nickname) => {
    const profile = await invoke('auth:setNickname', { nickname })
    set({ auth: { ...get().auth, profile } })
    return profile
  },

  setAvatar: async (patch) => {
    const profile = await invoke('auth:setAvatar', patch)
    set({ auth: { ...get().auth, profile } })
    return profile
  }
}))

/** The community surface exists at all only when the build has keys. */
export function selectCommunityAvailable(state: AuthStoreState): boolean {
  return state.auth.phase !== 'unconfigured'
}

export function selectSignedIn(state: AuthStoreState): boolean {
  return state.auth.phase === 'signed-in'
}

/** Signed in but the nickname step has not been completed yet. */
export function selectNeedsNickname(state: AuthStoreState): boolean {
  return state.auth.phase === 'signed-in' && state.auth.profile?.nickname == null
}

/** Test-only: drop the memoized init so a fresh store can hydrate again. */
export function resetAuthStoreForTests(): void {
  initialization = null
  useAuthStore.setState({
    auth: INITIAL,
    hydrated: false,
    lastSignInResult: null
  })
}
