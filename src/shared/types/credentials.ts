/**
 * Saved site logins for the in-app browser.
 *
 * Session-cookie persistence already keeps a student signed in for as long as
 * the portal's own session lasts (see main/features/browser/sessionStore.ts).
 * This is the other half: the portals that expire nightly, where the student
 * retypes a password every single morning.
 *
 * Non-negotiables, enforced in main rather than trusted to the UI:
 *  - Secrets live only inside an OS-keychain-encrypted blob. If the platform
 *    cannot encrypt, the feature turns itself OFF — there is no plaintext
 *    fallback, because a plaintext password file is worse than retyping.
 *  - Bound to an exact https origin. A saved credential is never offered to a
 *    different origin, and never over http.
 *  - Filling is not submitting. Auto-submit is opt-in per site, because a
 *    wrong stored password submitted on every visit locks the account out of
 *    a university portal, and that is a very expensive way to fail.
 *  - Passwords never cross the IPC boundary back to the renderer, never enter
 *    a log line, and never appear in an error message.
 */

export interface SavedLoginSummary {
  /** `https://portal.example.ac.kr` — scheme + host, no path. */
  origin: string
  username: string
  /** Submit the form after filling. Defaults to false. */
  autoSubmit: boolean
  updatedAt: string
}

export interface SaveLoginInput {
  origin: string
  username: string
  /** Only ever travels renderer → main. Never returned. */
  password: string
  autoSubmit?: boolean
}

export interface FillLoginResult {
  /** False when nothing is stored for the origin, or encryption is off. */
  filled: boolean
  /** True only when the site is configured to submit automatically. */
  submitted: boolean
}

export type CredentialsAvailability =
  | { state: 'ready' }
  /** No OS keychain — the feature is off rather than insecure. */
  | { state: 'unavailable'; reason: string }
