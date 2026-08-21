import { useCallback, useEffect } from 'react'
import type {
  AgentAvailability,
  AgentProvider,
  PermissionResponse
} from '../../../../shared/types/agent-events'
import type {
  AgentModelOption,
  ChatAttachment,
  ChatSurface
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
  useChatSessionStore,
  type SetChatProviderResult
} from './chatSessionStore'

export type { ChatPhase } from './chatSessionStore'
export type { SetChatProviderResult } from './chatSessionStore'

export interface ChatSessionApi {
  state: ChatViewState
  phase: 'loading' | 'ready' | 'error'
  provider: AgentProvider
  availability: AgentAvailability | null
  openError: string | null
  models: AgentModelOption[]
  /** Conversation title (first user message). Null until the first send. */
  title: string | null
  send: (content: string, attachments?: ChatAttachment[]) => void
  cancel: () => void
  respondPermission: (
    requestId: string,
    response: PermissionResponse
  ) => void
  refresh: () => void
  dismissNotice: () => void
  setModel: (model: string) => void
  /**
   * Switches provider. `{ needsNewConversation: true }` means this
   * conversation already has history and cannot switch — the caller opens a
   * new conversation instead (the preference itself is already saved).
   */
  setProvider: (provider: AgentProvider) => SetChatProviderResult
}

export function useChatSession(
  courseId: string,
  conversationId: string,
  surface: ChatSurface = 'app'
): ChatSessionApi {
  const snapshot = useChatSessionStore(
    useCallback(
      (store) => store.sessions[conversationId] ?? selectChatSession(conversationId),
      [conversationId]
    )
  )

  useEffect(
    () => acquireChatSession(courseId, conversationId, surface),
    [courseId, conversationId, surface]
  )

  const send = useCallback(
    (content: string, attachments?: ChatAttachment[]) => {
      sendChatMessage(courseId, conversationId, content, attachments)
    },
    [courseId, conversationId]
  )
  const cancel = useCallback(
    () => cancelChatTurn(courseId, conversationId),
    [courseId, conversationId]
  )
  const respondPermission = useCallback(
    (requestId: string, response: PermissionResponse) => {
      respondToChatPermission(courseId, conversationId, requestId, response)
    },
    [courseId, conversationId]
  )
  const refresh = useCallback(
    () => refreshChatSession(courseId, conversationId),
    [courseId, conversationId]
  )
  const dismissNotice = useCallback(
    () => dismissChatNotice(courseId, conversationId),
    [courseId, conversationId]
  )
  const setModel = useCallback(
    (model: string) => setChatModel(courseId, conversationId, model),
    [courseId, conversationId]
  )
  const setProvider = useCallback(
    (provider: AgentProvider) =>
      setChatProvider(courseId, conversationId, provider),
    [courseId, conversationId]
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
