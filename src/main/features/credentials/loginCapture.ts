import {
  LOGIN_CAPTURE_GLOBAL,
  type SavedLoginSummary
} from '../../../shared/types/credentials'
import type { CredentialStore } from './credentialStore'
import {
  currentOrigin,
  defaultFromId,
  resolveGuest,
  type LoginFillerDeps
} from './loginFiller'

export interface LoginCaptureRequest {
  origin: string
  guestWebContentsId: number
  autoSubmit?: boolean
}

/** Enough for any real credential; a guard against a hostile page's payload. */
const MAX_USERNAME = 10_000
const MAX_PASSWORD = 100_000

/**
 * Calls the capture function the browser tab installed in the page. It only
 * answers for the top frame, and only after a trusted keystroke reached the
 * password field — so a page cannot use it to hand us a value of its choosing
 * and have it stored under its own origin.
 */
const CAPTURE_SOURCE = `(() => {
  if (window.top !== window) return null;
  const capture = window[${JSON.stringify(LOGIN_CAPTURE_GLOBAL)}];
  return typeof capture === 'function' ? capture() : null;
})()`

function parse(value: unknown): { username: string; password: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const captured = value as Record<string, unknown>
  const username = captured['username']
  const password = captured['password']
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.trim() === '' ||
    password === '' ||
    username.length > MAX_USERNAME ||
    password.length > MAX_PASSWORD
  ) {
    return null
  }
  return { username, password }
}

/**
 * Reads the login the student just typed and stores it, entirely inside main.
 * The renderer names the tab and gets back a summary; the password itself
 * never crosses the IPC boundary in either direction.
 */
export function createLoginCapturer(
  store: Pick<CredentialStore, 'save'>,
  deps?: LoginFillerDeps
): (request: LoginCaptureRequest) => Promise<SavedLoginSummary | null> {
  const resolved = deps ?? { fromId: defaultFromId }

  return async (request): Promise<SavedLoginSummary | null> => {
    const target = resolveGuest(resolved, request)
    if (target === null) return null

    let captured: { username: string; password: string } | null
    try {
      captured = parse(await target.guest.executeJavaScript(CAPTURE_SOURCE))
    } catch {
      // Never surface the failure detail — it can quote page content.
      return null
    }
    if (captured === null) return null

    // The page could have navigated during the await. Storing a password
    // against the wrong origin would then offer it to that other site.
    if (currentOrigin(target.guest) !== target.origin) return null

    try {
      return store.save({
        origin: target.origin,
        username: captured.username,
        password: captured.password,
        autoSubmit: request.autoSubmit ?? false
      })
    } catch {
      return null
    }
  }
}
