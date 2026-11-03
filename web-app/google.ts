/**
 * Google sign-in for the web app. A browser can't keep a client secret, so
 * this uses the OAuth token flow for a "Web application" client in the same
 * Cloud project as the desktop and iPad clients. That's what makes the
 * `drive.file` Bandal folder visible here (spec v2.6, measured 2026-11-02).
 *
 * - The access token stays in sessionStorage, scoped to this tab. It is
 *   never sent anywhere except googleapis.com.
 * - Only the account email is kept in localStorage, as a `login_hint`. It
 *   lets the next visit sign in silently and open the workspace straight away.
 * - Signing out forgets the token here and does not revoke it. A revoke cuts
 *   every client in the project, including the desktop's sync and Gmail
 *   (spec 연결 해제).
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const SCOPES = ['openid', 'email', 'profile', DRIVE_SCOPE].join(' ')
const TOKEN_KEY = 'bandal:web:google-token'
const STATE_KEY = 'bandal:web:oauth-state'
const HINT_KEY = 'bandal:web:account-hint'
const SILENT_KEY = 'bandal:web:silent-attempt'

export const clientId = (): string => (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined)?.trim() ?? ''
const redirectUri = (): string => new URL(import.meta.env.BASE_URL, location.origin).href

export interface GoogleToken { access: string; expires: number }
export type RedirectOutcome =
  | { kind: 'none' }
  | { kind: 'signed-in' }
  /** Silent sign-in found no session or needs consent; show the sign-in screen without an error. */
  | { kind: 'needs-interaction' }
  | { kind: 'error'; code: 'access_denied' | 'scope_denied' | 'state_mismatch' | 'unknown' }

function session(): Storage | null {
  try { sessionStorage.setItem('bandal:web:probe', '1'); sessionStorage.removeItem('bandal:web:probe'); return sessionStorage } catch { return null }
}

export function storageAvailable(): boolean { return session() !== null }

export function currentToken(): GoogleToken | null {
  try {
    const value = JSON.parse(session()?.getItem(TOKEN_KEY) ?? 'null') as GoogleToken | null
    if (value && typeof value.access === 'string' && Number.isFinite(value.expires) && value.expires > Date.now() + 60_000) return value
  } catch { /* An unreadable token is no token. */ }
  return null
}

export function accountHint(): string | null {
  try {
    const value = localStorage.getItem(HINT_KEY)
    return value && /^[^@\s]+@[^@\s]+$/.test(value) ? value : null
  } catch { return null }
}

export function rememberAccount(email: string | null): void {
  try {
    if (email && /^[^@\s]+@[^@\s]+$/.test(email)) localStorage.setItem(HINT_KEY, email)
    else localStorage.removeItem(HINT_KEY)
  } catch { /* The hint is optional. */ }
}

/**
 * Leaves the page for Google. `silent` asks with `prompt=none`, so a person who
 * already granted access comes straight back signed in, and anyone else comes
 * back with `interaction_required`.
 */
export function signIn(options: { silent?: boolean; loginHint?: string | null } = {}): void {
  const store = session()
  if (!store) throw new Error('storage_unavailable')
  const state = crypto.randomUUID()
  store.setItem(STATE_KEY, state)
  if (options.silent) store.setItem(SILENT_KEY, String(Date.now()))
  else store.removeItem(SILENT_KEY)
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri(), response_type: 'token', scope: SCOPES, state,
    include_granted_scopes: 'true', prompt: options.silent ? 'none' : 'select_account',
    ...(options.loginHint ? { login_hint: options.loginHint } : {})
  }).toString()
  location.assign(url.href)
}

/** Whether a silent attempt already ran in this tab in the last minute: never loop through Google. */
export function silentAttemptedRecently(): boolean {
  const at = Number(session()?.getItem(SILENT_KEY) ?? 0)
  return Number.isFinite(at) && Date.now() - at < 60_000
}

/**
 * Reads a Google redirect from the URL fragment and removes it before anything
 * else runs, so the token is never left in the address bar or history.
 */
export function takeRedirect(): RedirectOutcome {
  const fragment = new URLSearchParams(location.hash.slice(1))
  if (!fragment.has('access_token') && !fragment.has('error')) return { kind: 'none' }
  history.replaceState(null, '', location.pathname + location.search)
  const store = session()
  const expected = store?.getItem(STATE_KEY)
  store?.removeItem(STATE_KEY)
  if (!expected || fragment.get('state') !== expected) return { kind: 'error', code: 'state_mismatch' }
  const error = fragment.get('error')
  if (error) {
    if (['interaction_required', 'login_required', 'consent_required', 'account_selection_required'].includes(error)) return { kind: 'needs-interaction' }
    return { kind: 'error', code: error === 'access_denied' ? 'access_denied' : 'unknown' }
  }
  const access = fragment.get('access_token') ?? ''
  const seconds = Number(fragment.get('expires_in') ?? 3600)
  const scope = (fragment.get('scope') ?? '').split(' ')
  // A person can untick Drive on the consent screen; without it there is nothing to open.
  if (!scope.includes(DRIVE_SCOPE)) return { kind: 'error', code: 'scope_denied' }
  store?.setItem(TOKEN_KEY, JSON.stringify({ access, expires: Date.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000 } satisfies GoogleToken))
  store?.removeItem(SILENT_KEY)
  return { kind: 'signed-in' }
}

export function signOut(options: { forgetAccount: boolean }): void {
  session()?.removeItem(TOKEN_KEY)
  session()?.removeItem(SILENT_KEY)
  if (options.forgetAccount) rememberAccount(null)
}
