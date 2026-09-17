import { randomUUID } from 'node:crypto'
import type { AgentConfirmRequest, AgentConfirmResponse, AgentConfirmScope, AgentConfirmationState } from '../../../shared/types/agentTools'

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
interface PendingConfirmation {
  request: AgentConfirmRequest
  resolve: (outcome: AgentConfirmScope | false) => void
  timer: ReturnType<typeof setTimeout>
}
export interface AgentConfirmer {
  confirm(input: Omit<AgentConfirmRequest, 'requestId'>): Promise<AgentConfirmScope | false>
  resolve(response: AgentConfirmResponse): AgentConfirmationState | null
  list(conversationId: string): AgentConfirmationState[]
  cancelConversation(conversationId: string): void
  disposeAll(): void
}
export function createAgentConfirmer(deps: {
  emit: (request: AgentConfirmRequest) => void
  changed?: (state: AgentConfirmationState) => void
  timeoutMs?: number
}): AgentConfirmer {
  const pending = new Map<string, PendingConfirmation>()
  const states = new Map<string, AgentConfirmationState>()
  let revision = 0
  const configuredTimeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 0 ? configuredTimeout : 0
  function publish(request: AgentConfirmRequest, status: AgentConfirmationState['status'], scope?: AgentConfirmScope): AgentConfirmationState {
    const state: AgentConfirmationState = { request, status, revision: ++revision, ...(scope ? { scope } : {}) }
    states.set(request.requestId, state)
    if (states.size > 1000) {
      for (const [id, old] of states) {
        if (old.status !== 'pending') { states.delete(id); break }
      }
    }
    try { deps.changed?.(state) } catch (error) { console.error('[agent] confirmation notification failed', error) }
    return state
  }
  function settle(id: string, status: Exclude<AgentConfirmationState['status'], 'pending'>, scope?: AgentConfirmScope): AgentConfirmationState | null {
    const item = pending.get(id)
    if (!item) return states.get(id) ?? null
    pending.delete(id)
    clearTimeout(item.timer)
    const state = publish(item.request, status, scope)
    item.resolve(status === 'approved' ? scope ?? 'once' : false)
    return state
  }
  return {
    confirm(input) {
      const request = { ...input, requestId: randomUUID() }
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(request.requestId, 'expired'), timeoutMs)
        pending.set(request.requestId, { request, resolve, timer })
        try { publish(request, 'pending'); deps.emit(request) }
        catch { settle(request.requestId, 'cancelled') }
      })
    },
    resolve(response) {
      const item = pending.get(response.requestId)
      if (item && response.approved === true && response.scope !== undefined && !(item.request.scopes ?? ['once']).includes(response.scope)) {
        throw new Error('이 요청에서 선택할 수 없는 승인 범위예요.')
      }
      return settle(response.requestId, response.approved === true ? 'approved' : 'denied', response.scope)
    },
    list(conversationId) { return [...states.values()].filter((state) => state.request.conversationId === conversationId) },
    cancelConversation(conversationId) {
      for (const [id, item] of pending) if (item.request.conversationId === conversationId) settle(id, 'cancelled')
    },
    disposeAll() { for (const id of pending.keys()) settle(id, 'cancelled') }
  }
}
