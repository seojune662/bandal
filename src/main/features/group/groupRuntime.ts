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

import { app, shell } from 'electron'
import { runtimeSafeStorage } from '../../lib/safeStorageGate'
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
import { createWhiteboardRepo } from '../whiteboard/whiteboardRepo'
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
  /**
   * [M13] The shared whiteboard talks to the same project as the group chat,
   * so it borrows this client rather than building a second one — two clients
   * would hold two sessions and disagree about who is signed in.
   * null when the build has no Supabase keys.
   */
  getClient(): SupabaseClient | null
  /** Remote user id, or null when signed out. */
  getUserId(): string | null
  /** Subscribe a sibling service to auth transitions. */
  onAuthChanged(listener: (state: AuthState) => void): () => void
  /** Safe to call unconditionally from `before-quit`. */
  dispose(): void
}

export function createGroupRuntime(deps: GroupRuntimeDeps): GroupRuntime {
  let service: GroupService | null = null
  let disposeInner: (() => void) | null = null
  let sharedClient: SupabaseClient | null = null
  let currentUserId: (() => string | null) | null = null
  const authChangeListeners = new Set<(state: AuthState) => void>()

  function build(): GroupService {
    const repo = createGroupRepo(deps.db)
    const whiteboardRepo = createWhiteboardRepo(deps.db)
    const batcher = createGroupEventBatcher({ send: deps.broadcastBatch })

    const storage = createSessionStore({
      filePath: sessionFilePath(app.getPath('userData')),
      encryptor: runtimeSafeStorage()
    })
    const client: SupabaseClient | null = createSupabaseClient({ storage })
    sharedClient = client

    const auth = createAuthService({
      client,
      onChanged: (state) => {
        deps.broadcastAuth(state)
        // Every channel carries the JWT it was subscribed with; a new session
        // means every one of them has to be rebuilt or it silently receives
        // nothing (supabase/README.md §5.3).
        realtime.resetAll()
        for (const listener of authChangeListeners) listener(state)
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
      whiteboardRepo,
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

    currentUserId = () => auth.userId()
    return built
  }

  return {
    service() {
      if (service === null) service = build()
      return service
    },
    isStarted: () => service !== null,
    getClient() {
      if (service === null) service = build()
      return sharedClient
    },
    getUserId() {
      if (service === null) service = build()
      return currentUserId?.() ?? null
    },
    onAuthChanged(listener) {
      authChangeListeners.add(listener)
      return () => authChangeListeners.delete(listener)
    },
    dispose() {
      disposeInner?.()
      disposeInner = null
      service = null
      sharedClient = null
      currentUserId = null
      authChangeListeners.clear()
    }
  }
}
