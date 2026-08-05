/**
 * Pure view-model for the AI tutor chat: an ordered block tree derived by
 * folding AgentEvents (M4-H contract) over immutable state.
 *
 * Handoff rules implemented here:
 *  - `tool-start` is an UPSERT keyed by toolCallId (bare label first, then a
 *    refreshed event with full input + rich label). Order is preserved.
 *  - There is no `thinking-final`: a thinking block is finalized when another
 *    block starts or the turn completes.
 *  - `text-final` REPLACES all accumulated text-delta content for a blockId.
 *  - The user's own message is never echoed by the stream — the hook appends
 *    it locally via `appendLocalUserMessage`.
 */

import type {
  AgentErrorCode,
  AgentEvent,
  PermissionSuggestion,
  ToolResultSummary,
  Usage
} from '../../../../shared/types/agent-events'
import type { ChatMessage, MessageBlock } from '../../../../shared/types/chat'

// -- view types ---------------------------------------------------------------

export interface TextBlockView {
  kind: 'text'
  id: string
  text: string
  streaming: boolean
}

export interface ThinkingBlockView {
  kind: 'thinking'
  id: string
  text: string
  streaming: boolean
}

export type ToolStatus = 'running' | 'ok' | 'error'

export interface ToolBlockView {
  kind: 'tool'
  id: string
  toolName: string
  label: string
  input?: unknown
  partialInput?: string
  status: ToolStatus
  result?: ToolResultSummary
}

export interface PermissionBlockView {
  kind: 'permission'
  id: string
  toolName: string
  input: unknown
  suggestions?: PermissionSuggestion[]
  /** Undefined while the request is unanswered. */
  behavior?: 'allow' | 'deny'
}

export type BlockView =
  | TextBlockView
  | ThinkingBlockView
  | ToolBlockView
  | PermissionBlockView

export interface TurnStats {
  durationMs?: number
  costUsd?: number
  usage?: Usage
}

export interface MessageView {
  id: string
  role: 'user' | 'assistant'
  blocks: BlockView[]
  streaming: boolean
  interrupted: boolean
  stats?: TurnStats
}

export interface ChatNotice {
  code: AgentErrorCode
  message: string
  fatal: boolean
}

export interface LimitInfo {
  message: string
  resetsAt?: string
}

export interface ChatViewState {
  messages: MessageView[]
  /** True while an assistant turn is in flight. */
  streaming: boolean
  pendingPermissionId: string | null
  limit: LimitInfo | null
  notice: ChatNotice | null
  model: string | null
  counter: number
}

export const initialChatViewState: ChatViewState = {
  messages: [],
  streaming: false,
  pendingPermissionId: null,
  limit: null,
  notice: null,
  model: null,
  counter: 0
}

// -- seq gap detection --------------------------------------------------------

export type SeqCheck = 'apply' | 'stale' | 'gap'

/** Per-course batch seq is monotonic; a jump means we missed a frame. */
export function checkBatchSeq(lastSeq: number | null, seq: number): SeqCheck {
  if (lastSeq === null) {
    return 'apply'
  }
  if (seq <= lastSeq) {
    return 'stale'
  }
  return seq === lastSeq + 1 ? 'apply' : 'gap'
}

// -- internal helpers ---------------------------------------------------------

/**
 * Marks streaming text/thinking blocks as finalized, except the one the
 * current event is still writing into ("finalize on next block start").
 */
function settleStreamingBlocks(
  blocks: readonly BlockView[],
  except: { kind: 'text' | 'thinking'; id: string } | null
): BlockView[] {
  return blocks.map((block) => {
    if (block.kind !== 'text' && block.kind !== 'thinking') {
      return block
    }
    if (!block.streaming) {
      return block
    }
    if (except !== null && block.kind === except.kind && block.id === except.id) {
      return block
    }
    return { ...block, streaming: false }
  })
}

/** Turn-end settle: everything stops streaming; orphaned tools become errors. */
function settleAllBlocks(blocks: readonly BlockView[]): BlockView[] {
  return blocks.map((block) => {
    if (block.kind === 'text' || block.kind === 'thinking') {
      return block.streaming ? { ...block, streaming: false } : block
    }
    if (block.kind === 'tool' && block.status === 'running') {
      return { ...block, status: 'error' as const }
    }
    return block
  })
}

/**
 * Applies `update` to the live assistant message (the streaming tail
 * message), creating one when the stream starts a new turn.
 */
function updateLiveMessage(
  state: ChatViewState,
  update: (message: MessageView) => MessageView
): ChatViewState {
  const last = state.messages[state.messages.length - 1]
  if (last !== undefined && last.role === 'assistant' && last.streaming) {
    return {
      ...state,
      streaming: true,
      messages: [...state.messages.slice(0, -1), update(last)]
    }
  }
  const counter = state.counter + 1
  const fresh: MessageView = {
    id: `assistant-${counter}`,
    role: 'assistant',
    blocks: [],
    streaming: true,
    interrupted: false
  }
  return {
    ...state,
    streaming: true,
    counter,
    messages: [...state.messages, update(fresh)]
  }
}

function upsertBlock<K extends BlockView['kind']>(
  blocks: readonly BlockView[],
  kind: K,
  id: string,
  update: (existing: Extract<BlockView, { kind: K }> | null) => BlockView
): BlockView[] {
  const index = blocks.findIndex(
    (block) => block.kind === kind && block.id === id
  )
  if (index < 0) {
    return [...blocks, update(null)]
  }
  const existing = blocks[index] as Extract<BlockView, { kind: K }>
  return [
    ...blocks.slice(0, index),
    update(existing),
    ...blocks.slice(index + 1)
  ]
}

// -- event reducer ------------------------------------------------------------

function applyTextDelta(
  state: ChatViewState,
  blockId: string,
  text: string,
  kind: 'text' | 'thinking'
): ChatViewState {
  return updateLiveMessage(state, (message) => ({
    ...message,
    blocks: upsertBlock(
      settleStreamingBlocks(message.blocks, { kind, id: blockId }),
      kind,
      blockId,
      (existing) =>
        existing === null
          ? { kind, id: blockId, text, streaming: true }
          : { ...existing, text: existing.text + text }
    )
  }))
}

function applyTextFinal(
  state: ChatViewState,
  blockId: string,
  text: string
): ChatViewState {
  return updateLiveMessage(state, (message) => ({
    ...message,
    blocks: upsertBlock(message.blocks, 'text', blockId, (existing) =>
      existing === null
        ? { kind: 'text', id: blockId, text, streaming: false }
        : { ...existing, text, streaming: false }
    )
  }))
}

function applyToolStart(
  state: ChatViewState,
  event: Extract<AgentEvent, { type: 'tool-start' }>
): ChatViewState {
  return updateLiveMessage(state, (message) => ({
    ...message,
    blocks: upsertBlock(
      settleStreamingBlocks(message.blocks, null),
      'tool',
      event.toolCallId,
      (existing) => ({
        kind: 'tool',
        id: event.toolCallId,
        toolName: event.toolName,
        label: event.label,
        status: existing?.status ?? 'running',
        ...(existing?.partialInput === undefined
          ? {}
          : { partialInput: existing.partialInput }),
        ...(existing?.result === undefined ? {} : { result: existing.result }),
        ...(event.input !== undefined
          ? { input: event.input }
          : existing?.input !== undefined
            ? { input: existing.input }
            : {})
      })
    )
  }))
}

function applyToolInputDelta(
  state: ChatViewState,
  toolCallId: string,
  partialInput: string
): ChatViewState {
  return updateLiveMessage(state, (message) => ({
    ...message,
    blocks: upsertBlock(message.blocks, 'tool', toolCallId, (existing) =>
      existing === null
        ? {
            kind: 'tool',
            id: toolCallId,
            toolName: 'unknown',
            label: '',
            status: 'running',
            partialInput
          }
        : {
            ...existing,
            partialInput: (existing.partialInput ?? '') + partialInput
          }
    )
  }))
}

function applyToolEnd(
  state: ChatViewState,
  event: Extract<AgentEvent, { type: 'tool-end' }>
): ChatViewState {
  return updateLiveMessage(state, (message) => ({
    ...message,
    blocks: upsertBlock(message.blocks, 'tool', event.toolCallId, (existing) =>
      existing === null
        ? {
            kind: 'tool',
            id: event.toolCallId,
            toolName: 'unknown',
            label: '',
            status: event.ok ? 'ok' : 'error',
            ...(event.result === undefined ? {} : { result: event.result })
          }
        : {
            ...existing,
            status: event.ok ? ('ok' as const) : ('error' as const),
            ...(event.result === undefined ? {} : { result: event.result })
          }
    )
  }))
}

function applyPermissionRequest(
  state: ChatViewState,
  event: Extract<AgentEvent, { type: 'permission-request' }>
): ChatViewState {
  const next = updateLiveMessage(state, (message) => ({
    ...message,
    blocks: upsertBlock(
      settleStreamingBlocks(message.blocks, null),
      'permission',
      event.requestId,
      () => ({
        kind: 'permission',
        id: event.requestId,
        toolName: event.toolName,
        input: event.input,
        ...(event.suggestions === undefined
          ? {}
          : { suggestions: event.suggestions })
      })
    )
  }))
  return { ...next, pendingPermissionId: event.requestId }
}

function applyTurnComplete(
  state: ChatViewState,
  event: Extract<AgentEvent, { type: 'turn-complete' }>
): ChatViewState {
  const interrupted = event.stopReason === 'interrupted'
  const stats: TurnStats = {
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.costUsd === undefined ? {} : { costUsd: event.costUsd }),
    ...(event.usage === undefined ? {} : { usage: event.usage })
  }
  const last = state.messages[state.messages.length - 1]
  const messages =
    last !== undefined && last.role === 'assistant' && last.streaming
      ? [
          ...state.messages.slice(0, -1),
          {
            ...last,
            blocks: settleAllBlocks(last.blocks),
            streaming: false,
            interrupted: last.interrupted || interrupted,
            stats
          }
        ]
      : state.messages
  return {
    ...state,
    messages,
    streaming: false,
    pendingPermissionId: null
  }
}

function applyError(
  state: ChatViewState,
  event: Extract<AgentEvent, { type: 'error' }>
): ChatViewState {
  const notice: ChatNotice | null =
    event.code === 'interrupted'
      ? state.notice
      : { code: event.code, message: event.message, fatal: event.fatal }
  if (!event.fatal) {
    return { ...state, notice }
  }
  const last = state.messages[state.messages.length - 1]
  const messages =
    last !== undefined && last.role === 'assistant' && last.streaming
      ? [
          ...state.messages.slice(0, -1),
          {
            ...last,
            blocks: settleAllBlocks(last.blocks),
            streaming: false,
            interrupted: true
          }
        ]
      : state.messages
  return {
    ...state,
    messages,
    notice,
    streaming: false,
    pendingPermissionId: null
  }
}

export function applyAgentEvent(
  state: ChatViewState,
  event: AgentEvent
): ChatViewState {
  switch (event.type) {
    case 'session-started':
      return { ...state, model: event.model }
    case 'text-delta':
      return applyTextDelta(state, event.blockId, event.text, 'text')
    case 'thinking-delta':
      return applyTextDelta(state, event.blockId, event.text, 'thinking')
    case 'text-final':
      return applyTextFinal(state, event.blockId, event.text)
    case 'tool-start':
      return applyToolStart(state, event)
    case 'tool-input-delta':
      return applyToolInputDelta(state, event.toolCallId, event.partialInput)
    case 'tool-end':
      return applyToolEnd(state, event)
    case 'permission-request':
      return applyPermissionRequest(state, event)
    case 'turn-complete':
      return applyTurnComplete(state, event)
    case 'limit':
      return {
        ...state,
        limit: {
          message: event.message,
          ...(event.resetsAt === undefined ? {} : { resetsAt: event.resetsAt })
        }
      }
    case 'error':
      return applyError(state, event)
    case 'usage':
      return state
  }
}

export function applyAgentEvents(
  state: ChatViewState,
  events: readonly AgentEvent[]
): ChatViewState {
  return events.reduce(applyAgentEvent, state)
}

// -- local actions ------------------------------------------------------------

/** Local echo of the user's own message (never echoed by the stream). */
export function appendLocalUserMessage(
  state: ChatViewState,
  id: string,
  text: string
): ChatViewState {
  const message: MessageView = {
    id,
    role: 'user',
    blocks: [{ kind: 'text', id: `${id}-text`, text, streaming: false }],
    streaming: false,
    interrupted: false
  }
  return {
    ...state,
    messages: [...state.messages, message],
    streaming: true,
    limit: null,
    notice: null
  }
}

/** Marks a send that failed before the stream produced any events. */
export function markSendFailed(state: ChatViewState): ChatViewState {
  return { ...state, streaming: false }
}

export function applyLocalPermissionResponse(
  state: ChatViewState,
  requestId: string,
  behavior: 'allow' | 'deny'
): ChatViewState {
  const messages = state.messages.map((message) => {
    if (
      !message.blocks.some(
        (block) => block.kind === 'permission' && block.id === requestId
      )
    ) {
      return message
    }
    return {
      ...message,
      blocks: message.blocks.map((block) =>
        block.kind === 'permission' && block.id === requestId
          ? { ...block, behavior }
          : block
      )
    }
  })
  return {
    ...state,
    messages,
    pendingPermissionId:
      state.pendingPermissionId === requestId
        ? null
        : state.pendingPermissionId
  }
}

export function clearNotice(state: ChatViewState): ChatViewState {
  return state.notice === null ? state : { ...state, notice: null }
}

// -- hydration from committed history (chat:open) -----------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function persistedBlockToView(
  block: MessageBlock
): { view: BlockView | null; interrupted: boolean } {
  const payload = asRecord(block.payload)
  const interrupted = payload['interrupted'] === true
  if (block.kind === 'text' || block.kind === 'thinking') {
    return {
      view: {
        kind: block.kind,
        id: block.id,
        text: asString(payload['text'], ''),
        streaming: false
      },
      interrupted
    }
  }
  if (block.kind === 'tool') {
    const ok = payload['ok']
    const status: ToolStatus =
      ok === true
        ? 'ok'
        : ok === false
          ? 'error'
          : payload['result'] !== undefined
            ? 'ok'
            : 'error'
    const result = payload['result']
    return {
      view: {
        kind: 'tool',
        id: asString(payload['toolCallId'], block.id),
        toolName: asString(payload['toolName'], 'unknown'),
        label: asString(payload['label'], ''),
        status,
        ...(payload['input'] === undefined ? {} : { input: payload['input'] }),
        ...(typeof result === 'object' && result !== null
          ? { result: result as ToolResultSummary }
          : {})
      },
      interrupted
    }
  }
  if (block.kind === 'permission') {
    const behavior = payload['behavior']
    return {
      view: {
        kind: 'permission',
        id: asString(payload['requestId'], block.id),
        toolName: asString(payload['toolName'], 'unknown'),
        input: payload['input'],
        ...(behavior === 'allow' || behavior === 'deny' ? { behavior } : {})
      },
      interrupted
    }
  }
  return { view: null, interrupted: false }
}

export function hydrateFromHistory(
  history: readonly ChatMessage[],
  model: string | null
): ChatViewState {
  const messages: MessageView[] = history.map((message) => {
    const sorted = [...message.blocks].sort((a, b) => a.ord - b.ord)
    let interrupted = false
    const blocks: BlockView[] = []
    for (const block of sorted) {
      const mapped = persistedBlockToView(block)
      interrupted = interrupted || mapped.interrupted
      if (mapped.view !== null) {
        blocks.push(mapped.view)
      }
    }
    return {
      id: message.id,
      role: message.role,
      blocks,
      streaming: false,
      interrupted
    }
  })
  return { ...initialChatViewState, messages, model }
}
