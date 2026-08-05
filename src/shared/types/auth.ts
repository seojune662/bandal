/**
 * [P2-A/C6] Auth state projected from main → renderer.
 *
 * The renderer NEVER sees tokens or e-mail addresses (docs/phase2-community
 * §1.3): main owns the Supabase client and hands over this shape only.
 *
 * `phase` drives the entire 함께하기 surface:
 *   'unconfigured' → the community UI is ABSENT (not disabled) — §1.4-4
 *   'signed-out'   → login card
 *   'signing-in'   → system browser was opened, waiting for the deep link
 *   'signed-in'    → full UI; `profile.nickname === null` means the user still
 *                    has to pick a nickname before joining anything
 *   'error'        → `errorCode` explains why
 */

export type AuthPhase =
  | 'unconfigured'
  | 'signed-out'
  | 'signing-in'
  | 'signed-in'
  | 'error'

export type AuthErrorCode =
  | 'oauth-cancelled'
  | 'network'
  | 'provider'
  | 'storage'
  /** The build has no MAIN_VITE_SUPABASE_* keys, or OAuth is not wired yet. */
  | 'not-configured'

export type AuthProvider = 'google' | 'kakao'

/** Public profile of the signed-in user. No token, no e-mail. */
export interface MyProfile {
  id: string
  /** null = nickname not chosen yet → renderer shows the nickname step. */
  nickname: string | null
  avatarColor: string
  avatarEmoji: string
}

export interface AuthState {
  phase: AuthPhase
  profile: MyProfile | null
  online: boolean
  errorCode: AuthErrorCode | null
}

/**
 * `auth:signIn` returns as soon as the system browser has been opened —
 * `{ ok: true }` means "the browser is up", NOT "signed in". The session only
 * lands when `bandal://auth/callback` comes back and main exchanges the code.
 *
 * Refusals are *typed values*, never thrown errors, so the renderer can render
 * a card without try/catch noise.
 *
 * `oauth-not-wired` is retained for compatibility and is no longer produced.
 */
export type AuthSignInResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'not-configured'
        | 'already-signed-in'
        | 'oauth-not-wired'
        /** Supabase/the provider refused to hand out an authorize URL. */
        | 'provider'
        /** Could not reach the auth endpoint, or the OS refused the browser. */
        | 'network'
    }

export const SIGNED_OUT_AUTH_STATE: AuthState = {
  phase: 'signed-out',
  profile: null,
  online: false,
  errorCode: null
}

export const UNCONFIGURED_AUTH_STATE: AuthState = {
  phase: 'unconfigured',
  profile: null,
  online: false,
  errorCode: null
}
