/**
 * Destructive app tools use this confirmation gate instead of a CLI permission
 * prompt. Codex has no interactive approval (`CodexAdapter.respondPermission`
 * is a no-op), so relying on provider permission cards would leave it unguarded.
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentConfirmRequest,
  AgentConfirmResponse
} from '../../../shared/types/agentTools'

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000

interface PendingConfirmation {
  resolve: (approved: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

export interface AgentConfirmer {
  confirm(input: Omit<AgentConfirmRequest, 'requestId'>): Promise<boolean>
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

      return new Promise<boolean>((resolve) => {
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
      confirmation.resolve(response.approved === true)
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
