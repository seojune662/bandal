import { app, shell } from 'electron'
import { createLocalAccessStore } from './localAccessStore'
import { runtimeSafeStorage } from '../../lib/safeStorageGate'
import { createAuthService } from './authService'
import { createSessionStore, sessionFilePath } from './sessionStore'
import { createSupabaseClient } from './supabaseClient'
import type { AuthState } from '../../../shared/types/auth'
/** Account authentication has no social subscriptions, message outbox, or shared boards. */
export function createAccountRuntime(onChanged: (state: AuthState) => void) {
  let runtime: ReturnType<typeof build> | undefined
  function build() {
    const filePath = sessionFilePath(app.getPath('userData'))
    const storage = createSessionStore({ filePath, encryptor: runtimeSafeStorage() })
    const client = createSupabaseClient({ storage })
    const localAccess = createLocalAccessStore(app.getPath('userData'))
    const auth = createAuthService({ localAccess, client, onChanged, destroySession: () => storage.clear(), openExternal: url => shell.openExternal(url) })
    void auth.restore()
    return { client, auth }
  }
  const get = () => runtime ??= build()
  return { auth: () => get().auth, getClient: () => {
    const current = get(), access = current.auth.getState().localAccess
    return access?.allowed && current.auth.userId() === access.boundUserID ? current.client : null
  }, dispose: () => runtime?.auth.dispose() }
}
