import { useCallback, useEffect } from 'react'
import type {
  AgentAvailability,
  AgentProvider,
  PermissionResponse
} from '../../../../shared/types/agent-events'
import type {
  AgentModelOption,
  ChatAttachment
} from '../../../../shared/types/chat'
import type { ChatViewState } from './chatModel'
import {
  acquireChatSession,
  cancelChatTurn,
  dismissChatNotice,
  refreshChatSession,
  respondToChatPermission,
  selectChatSession,
  sendChatMessage,
  setChatProvider,
  setChatModel,
  useChatSessionStore
} from './chatSessionStore'

export type { ChatPhase } from './chatSessionStore'

export interface ChatSessionApi {
  state: ChatViewState
  phase: 'loading' | 'ready' | 'error'
  provider: AgentProvider
  availability: AgentAvailability | null
  openError: string | null
  models: AgentModelOption[]
  send: (content: string, attachments?: ChatAttachment[]) => void
  cancel: () => void
  respondPermission: (
    requestId: string,
    response: PermissionResponse
  ) => void
  refresh: () => void
  dismissNotice: () => void
  setModel: (model: string) => void
  setProvider: (provider: AgentProvider) => void
}

export function useChatSession(courseId: string): ChatSessionApi {
  const snapshot = useChatSessionStore(
    useCallback(
      (store) => store.sessions[courseId] ?? selectChatSession(courseId),
      [courseId]
    )
  )

  useEffect(() => acquireChatSession(courseId), [courseId])

  const send = useCallback(
    (content: string, attachments?: ChatAttachment[]) => {
      sendChatMessage(courseId, content, attachments)
    },
    [courseId]
  )
  const cancel = useCallback(() => cancelChatTurn(courseId), [courseId])
  const respondPermission = useCallback(
    (requestId: string, response: PermissionResponse) => {
      respondToChatPermission(courseId, requestId, response)
    },
    [courseId]
  )
  const refresh = useCallback(() => refreshChatSession(courseId), [courseId])
  const dismissNotice = useCallback(
    () => dismissChatNotice(courseId),
    [courseId]
  )
  const setModel = useCallback(
    (model: string) => setChatModel(courseId, model),
    [courseId]
  )
  const setProvider = useCallback(
    (provider: AgentProvider) => setChatProvider(courseId, provider),
    [courseId]
  )

  return {
    ...snapshot,
    send,
    cancel,
    respondPermission,
    refresh,
    dismissNotice,
    setModel,
    setProvider
  }
}
