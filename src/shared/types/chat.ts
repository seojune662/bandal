/**
 * Chat domain types: persisted message history and session metadata for a
 * course's AI-agent chat.
 */

import type { AgentAvailability, AgentProvider, Usage } from './agent-events'

export type MessageRole = 'user' | 'assistant'

export type MessageBlockKind = 'text' | 'thinking' | 'tool' | 'permission'

/** One ordered block within a message (text, thinking, tool call, ...). */
export interface MessageBlock {
  id: string
  messageId: string
  ord: number
  kind: MessageBlockKind
  /** Kind-specific payload, persisted as JSON. */
  payload: unknown
}

export interface ChatMessage {
  id: string
  courseId: string
  sessionId: string
  role: MessageRole
  turnSeq: number
  blocks: MessageBlock[]
  createdAt: string
}

export type AgentSessionStatus = 'idle' | 'running' | 'error' | 'closed'

export interface ChatSessionInfo {
  id: string
  courseId: string
  provider: AgentProvider
  /** Session id assigned by the CLI, for resuming. */
  cliSessionId: string | null
  model: string | null
  status: AgentSessionStatus
  lastUsedAt: string | null
}

export interface ChatOpenResult {
  history: ChatMessage[]
  sessionInfo: ChatSessionInfo | null
  availability: AgentAvailability
}

export interface ChatSendInput {
  courseId: string
  content: string
}

export interface ChatTurnSummary {
  turnSeq: number
  usage?: Usage
}
