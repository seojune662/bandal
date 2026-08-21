/**
 * Destructive app tools use this confirmation gate instead of a CLI permission
 * prompt. Codex has no interactive approval (`CodexAdapter.respondPermission`
 * is a no-op), so relying on provider permission cards would leave it unguarded.
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentConfirmRequest,
  AgentConfirmResponse,
  AgentConfirmScope
} from '../../../shared/types/agentTools'

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000

interface PendingConfirmation {
  resolve: (outcome: AgentConfirmScope | false) => void
  timer: ReturnType<typeof setTimeout>
}

export interface AgentConfirmer {
  /**
   * Resolves with the scope the student picked, or `false` for a refusal.
   *
   * A request that offered no `scopes` resolves to `'once'` on approval —
   * callers that only care about yes/no can compare against `false`.
   */
  confirm(
    input: Omit<AgentConfirmRequest, 'requestId'>
  ): Promise<AgentConfirmScope | false>
  resolve(response: AgentConfirmResponse): void
  /** Denies every outstanding request when its owning session ends. */
  disposeAll(): void
}

export function createAgentConfirmer(deps: {
  emit: (request: AgentConfirmRequest) => void
  timeoutMs?: number
}): AgentConfirmer {
  const pending = new Map<string, PendingConfirmation>()
  const configuredTimeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout >= 0
      ? configuredTimeout
      : 0

  return {
    confirm(input) {
      const requestId = randomUUID()

      return new Promise<AgentConfirmScope | false>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          resolve(false)
        }, timeoutMs)

        pending.set(requestId, { resolve, timer })

        try {
          deps.emit({ ...input, requestId })
        } catch {
          const confirmation = pending.get(requestId)
          if (confirmation !== undefined) {
            pending.delete(requestId)
            clearTimeout(confirmation.timer)
            confirmation.resolve(false)
          }
        }
      })
    },

    resolve(response) {
      const confirmation = pending.get(response.requestId)
      if (confirmation === undefined) return

      pending.delete(response.requestId)
      clearTimeout(confirmation.timer)
      // Treat malformed or ambiguous runtime responses as a denial.
      // A request with no scope choice resolves to 'once' — the narrowest
      // truthful answer, so a caller that only wanted yes/no is unaffected.
      confirmation.resolve(
        response.approved === true ? (response.scope ?? 'once') : false
      )
    },

    disposeAll() {
      const confirmations = [...pending.values()]
      pending.clear()

      for (const confirmation of confirmations) {
        clearTimeout(confirmation.timer)
        confirmation.resolve(false)
      }
    }
  }
}
