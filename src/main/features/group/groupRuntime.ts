/**
 * The lazy assembly point for the entire Phase-2 group runtime.
 *
 * `registerHandlers` holds ONLY this factory. The Supabase client, the
 * encrypted session file, the realtime manager and the outbox are all built on
 * the first `auth:*` / `groups:*` invoke and never before — which is what
 * makes "logged out, offline, unconfigured → Phase 1 is untouched" a
 * structural property rather than a promise (docs/phase2-community.md §1.4).
 *
 * A build with no keys still constructs: the client is null, auth reports
 * `unconfigured`, the local repo still answers (empty), and the renderer hides
 * the 함께하기 section entirely.
 */

import { app, safeStorage, shell } from 'electron'
import type { Database } from 'better-sqlite3'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthState } from '../../../shared/types/auth'
import type { GroupsInvalidationReason } from '../../../shared/types/group'
import type { GroupEventBatch } from '../../../shared/ipc/events'
import { createAuthService } from './authService'
import { createGroupEventBatcher } from './groupEventBatcher'
import { createGroupRealtimeManager } from './GroupRealtimeManager'
import { createGroupRepo } from './groupRepo'
import { createGroupService, type GroupService } from './GroupService'
import { createOutboxUploader } from './OutboxUploader'
import { createRateGuard } from './rateGuard'
import {
  createSessionStore,
  destroySessionFile,
  sessionFilePath
} from './sessionStore'
import { createSupabaseClient } from './supabaseClient'
import { insertMessage } from './groupRpc'

export interface GroupRuntimeDeps {
  db: Database
  broadcastAuth: (state: AuthState) => void
  broadcastBatch: (batch: GroupEventBatch) => void
  broadcastInvalidated: (reason: GroupsInvalidationReason) => void
}

export interface GroupRuntime {
  /** Builds on first call, then returns the same instance. */
  service(): GroupService
  /** True once `service()` has actually been constructed. */
  isStarted(): boolean
  /** Safe to call unconditionally from `before-quit`. */
  dispose(): void
}

export function createGroupRuntime(deps: GroupRuntimeDeps): GroupRuntime {
  let service: GroupService | null = null
  let disposeInner: (() => void) | null = null

  function build(): GroupService {
    const repo = createGroupRepo(deps.db)
    const batcher = createGroupEventBatcher({ send: deps.broadcastBatch })

    const storage = createSessionStore({
      filePath: sessionFilePath(app.getPath('userData')),
      encryptor: safeStorage
    })
    const client: SupabaseClient | null = createSupabaseClient({ storage })

    const auth = createAuthService({
      client,
      onChanged: (state) => {
        deps.broadcastAuth(state)
        // Every channel carries the JWT it was subscribed with; a new session
        // means every one of them has to be rebuilt or it silently receives
        // nothing (supabase/README.md §5.3).
        realtime.resetAll()
      },
      destroySession: () =>
        destroySessionFile(sessionFilePath(app.getPath('userData'))),
      // The system browser, never an app window: Google blocks embedded
      // user-agents, and an in-app window would expose the auth code.
      openExternal: (url) => shell.openExternal(url)
    })

    const realtime = createGroupRealtimeManager({
      getClient: () => client,
      getUserId: () => auth.userId(),
      emit: (groupId, event) => batcher.push(groupId, event),
      catchUp: (groupId, afterSeq) => built.catchUp(groupId, afterSeq),
      localMaxSeq: (groupId) => repo.maxSeq(groupId),
      drainOutbox: () => outbox.drain()
    })

    const outbox = createOutboxUploader({
      repo,
      canSend: () => client !== null && auth.userId() !== null,
      emit: (groupId, event) => batcher.push(groupId, event),
      send: async (message) => {
        const userId = auth.userId()
        if (client === null || userId === null) {
          return { kind: 'retry', error: 'not-signed-in' }
        }
        try {
          const inserted = await insertMessage(client, {
            id: message.localId,
            groupId: message.groupId,
            authorId: userId,
            body: message.body,
            replyTo: message.replyTo
          })
          return inserted === null
            ? { kind: 'duplicate' }
            : { kind: 'sent', messageId: inserted.id, seq: inserted.seq }
        } catch (error) {
          return built.classifySendError(error)
        }
      }
    })

    const built = createGroupService({
      repo,
      auth,
      realtime,
      outbox,
      rateGuard: createRateGuard(),
      getClient: () => client,
      emit: (groupId, event) => batcher.push(groupId, event),
      invalidate: deps.broadcastInvalidated
    })

    disposeInner = () => {
      built.dispose()
      batcher.dispose()
    }

    // Restoring the session is fire-and-forget: it must never delay the
    // invoke that triggered construction, and every failure is non-fatal.
    void built.restoreSession().catch((error: unknown) => {
      console.error('[group] session restore rejected', error)
    })

    return built
  }

  return {
    service() {
      if (service === null) service = build()
      return service
    },
    isStarted: () => service !== null,
    dispose() {
      disposeInner?.()
      disposeInner = null
      service = null
    }
  }
}
