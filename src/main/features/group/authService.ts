/**
 * Auth state machine (docs/phase2-community.md §1.2–1.4).
 *
 * ⚠ OAuth IS DELIBERATELY NOT WIRED YET. Everything around it is real:
 * the state shape, the safeStorage-backed session store, session restore, the
 * `auth:changed` broadcast, the lazy Supabase client, and the profile RPC
 * calls. `signIn()` returns a TYPED refusal (`not-configured` /
 * `oauth-not-wired`) instead of opening a browser. Wiring it later is confined
 * to the block marked "OAUTH WIRING POINT" below plus a `bandal://` deep-link
 * handler in `src/main/index.ts`; no caller of this module changes.
 *
 * THE NON-NEGOTIABLE RULE (§1.4): with auth stubbed or signed out, every
 * Phase-1 feature works exactly as it does today. Which is why:
 *   - nothing here runs unless an `auth:*` / `groups:*` invoke arrives
 *   - a missing key set is `phase: 'unconfigured'`, not an error
 *   - every session-restore failure (network, expiry, corrupt file) degrades
 *     to `signed-out` and the app boots normally
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AuthProvider,
  AuthSignInResult,
  AuthState,
  MyProfile
} from '../../../shared/types/auth'
import {
  SIGNED_OUT_AUTH_STATE,
  UNCONFIGURED_AUTH_STATE
} from '../../../shared/types/auth'

export interface AuthServiceDeps {
  /** null when the build has no Supabase keys → 'unconfigured' forever. */
  client: SupabaseClient | null
  /** Broadcast `auth:changed` to every window. */
  onChanged: (state: AuthState) => void
  /** Removes the encrypted session file on sign-out. */
  destroySession: () => void
}

export interface AuthService {
  getState(): AuthState
  /** Restores a persisted session. Never throws; never blocks boot. */
  restore(): Promise<AuthState>
  signIn(provider: AuthProvider): Promise<AuthSignInResult>
  signOut(): Promise<void>
  setNickname(nickname: string): Promise<MyProfile>
  setAvatar(patch: { color?: string; emoji?: string }): Promise<MyProfile>
  /** Current access token for `realtime.setAuth()`. */
  accessToken(): string | null
  userId(): string | null
  setOnline(online: boolean): void
  dispose(): void
}

/** §2.1 — 2..16 of 한글/영문/숫자/underscore, checked before the round trip. */
const NICKNAME_SHAPE = /^[가-힣a-zA-Z0-9_]{2,16}$/

export function isValidNickname(value: string): boolean {
  return NICKNAME_SHAPE.test(value)
}

function profileFromRow(row: unknown, fallbackId: string): MyProfile {
  const record =
    typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {}
  const nickname = record['nickname']
  return {
    id: typeof record['id'] === 'string' ? record['id'] : fallbackId,
    // A freshly-created profile carries the temporary `user_<8hex>` handle;
    // treating it as "unset" is what triggers the nickname step in the UI.
    nickname:
      typeof nickname === 'string' && !/^user_[0-9a-f]{8}$/.test(nickname)
        ? nickname
        : null,
    avatarColor:
      typeof record['avatar_color'] === 'string' ? record['avatar_color'] : 'moon',
    avatarEmoji:
      typeof record['avatar_emoji'] === 'string' ? record['avatar_emoji'] : '🌙'
  }
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const configured = deps.client !== null
  let state: AuthState = configured
    ? { ...SIGNED_OUT_AUTH_STATE }
    : { ...UNCONFIGURED_AUTH_STATE }
  let token: string | null = null
  let uid: string | null = null
  let unsubscribe: (() => void) | null = null

  function publish(next: AuthState): AuthState {
    state = next
    deps.onChanged(state)
    return state
  }

  async function loadProfile(userId: string): Promise<MyProfile> {
    if (deps.client === null) {
      return { id: userId, nickname: null, avatarColor: 'moon', avatarEmoji: '🌙' }
    }
    const { data, error } = await deps.client
      .from('profiles')
      .select('id, nickname, avatar_color, avatar_emoji')
      .eq('id', userId)
      .maybeSingle()
    if (error !== null) throw error
    return profileFromRow(data, userId)
  }

  async function adoptSession(
    accessToken: string,
    userId: string
  ): Promise<AuthState> {
    token = accessToken
    uid = userId
    try {
      const profile = await loadProfile(userId)
      return publish({
        phase: 'signed-in',
        profile,
        online: true,
        errorCode: null
      })
    } catch (error) {
      // Signed in but the profile row is unreachable (offline right after a
      // restore). That is not a sign-in failure: keep the session, show the
      // user as signed-in-but-offline and let the next fetch fill it in.
      console.error('[group] failed to load profile', error)
      return publish({
        phase: 'signed-in',
        profile: { id: userId, nickname: null, avatarColor: 'moon', avatarEmoji: '🌙' },
        online: false,
        errorCode: null
      })
    }
  }

  function clearSession(): void {
    token = null
    uid = null
  }

  async function updateProfile(
    patch: Record<string, string>
  ): Promise<MyProfile> {
    if (deps.client === null || uid === null) {
      throw new Error('not-signed-in')
    }
    const { data, error } = await deps.client
      .from('profiles')
      .update(patch)
      .eq('id', uid)
      .select('id, nickname, avatar_color, avatar_emoji')
      .single()
    if (error !== null) throw error
    const profile = profileFromRow(data, uid)
    publish({ ...state, profile })
    return profile
  }

  return {
    getState: () => state,

    async restore() {
      if (deps.client === null) return state
      try {
        const { data, error } = await deps.client.auth.getSession()
        if (error !== null || data.session === null) {
          clearSession()
          return publish({ ...SIGNED_OUT_AUTH_STATE })
        }
        if (unsubscribe === null) {
          const { data: sub } = deps.client.auth.onAuthStateChange(
            (_event, session) => {
              if (session === null) {
                clearSession()
                publish({ ...SIGNED_OUT_AUTH_STATE })
                return
              }
              void adoptSession(session.access_token, session.user.id)
            }
          )
          unsubscribe = () => {
            sub.subscription.unsubscribe()
          }
        }
        return await adoptSession(data.session.access_token, data.session.user.id)
      } catch (error) {
        // Corrupt session file, expired refresh token, no network — all
        // non-fatal. The app is already running; we just stay signed out.
        console.error('[group] session restore failed (non-fatal)', error)
        clearSession()
        return publish({ ...SIGNED_OUT_AUTH_STATE })
      }
    },

    signIn(provider) {
      if (deps.client === null) {
        publish({ ...UNCONFIGURED_AUTH_STATE })
        return Promise.resolve({ ok: false, reason: 'not-configured' } as const)
      }
      if (state.phase === 'signed-in') {
        return Promise.resolve({ ok: false, reason: 'already-signed-in' } as const)
      }
      // ── OAUTH WIRING POINT ────────────────────────────────────────────────
      // Replace this block with:
      //   const { data } = await client.auth.signInWithOAuth({ provider,
      //     options: { redirectTo: 'bandal://auth/callback',
      //                skipBrowserRedirect: true } })
      //   await shell.openExternal(data.url)
      //   publish({ ...state, phase: 'signing-in' })
      //   return { ok: true }
      // …and route the deep link into `handleDeepLink()` below.
      console.info(`[group] sign-in with ${provider} requested (OAuth not wired)`)
      publish({
        phase: 'signed-out',
        profile: null,
        online: state.online,
        errorCode: 'not-configured'
      })
      return Promise.resolve({ ok: false, reason: 'oauth-not-wired' } as const)
    },

    async signOut() {
      if (deps.client !== null) {
        try {
          await deps.client.auth.signOut()
        } catch (error) {
          // Local sign-out must succeed even if the server call does not.
          console.error('[group] remote signOut failed', error)
        }
      }
      clearSession()
      deps.destroySession()
      publish(
        deps.client === null
          ? { ...UNCONFIGURED_AUTH_STATE }
          : { ...SIGNED_OUT_AUTH_STATE }
      )
    },

    setNickname(nickname) {
      const trimmed = nickname.trim()
      if (!isValidNickname(trimmed)) {
        return Promise.reject(
          new Error('닉네임은 한글·영문·숫자·밑줄 2~16자여야 해요.')
        )
      }
      return updateProfile({ nickname: trimmed })
    },

    setAvatar(patch) {
      const update: Record<string, string> = {}
      if (patch.color !== undefined) update['avatar_color'] = patch.color
      if (patch.emoji !== undefined) update['avatar_emoji'] = patch.emoji
      if (Object.keys(update).length === 0) {
        return Promise.reject(new Error('변경할 항목이 없어요.'))
      }
      return updateProfile(update)
    },

    accessToken: () => token,
    userId: () => uid,

    setOnline: (online) => {
      if (state.online === online) return
      publish({ ...state, online })
    },

    dispose: () => {
      unsubscribe?.()
      unsubscribe = null
    }
  }
}
