import { startTransition } from 'react'
import { create } from 'zustand'
import type {
  AgentAvailability,
  AgentEvent,
  AgentProvider,
  PermissionResponse
} from '../../../../shared/types/agent-events'
import type {
  AgentModelOption,
  ChatAttachment
} from '../../../../shared/types/chat'
import { invoke, onPush, type Unsubscribe } from '../../lib/ipc'
import {
  appendLocalUserMessage,
  applyAgentEvents,
  applyLocalPermissionResponse,
  checkBatchSeq,
  clearNotice,
  hydrateFromHistory,
  initialChatViewState,
  markSendFailed,
  type ChatViewState
} from './chatModel'

export type ChatPhase = 'loading' | 'ready' | 'error'

export interface ChatSessionSnapshot {
  state: ChatViewState
  phase: ChatPhase
  provider: AgentProvider
  availability: AgentAvailability | null
  openError: string | null
  models: AgentModelOption[]
  /** Conversation title (first user message). Null until the first send. */
  title: string | null
}

/** Result of setChatProvider: an in-use conversation cannot switch provider. */
export interface SetChatProviderResult {
  needsNewConversation: boolean
}

interface ChatSessionStoreState {
  /** Keyed by CONVERSATION id, not course — one course holds many. */
  sessions: Record<string, ChatSessionSnapshot>
}

interface ConversationRuntime {
  /** The course this conversation belongs to (needed for reopen). */
  courseId: string
  refCount: number
  unsubscribe: Unsubscribe | null
  lastSeq: number | null
  queue: AgentEvent[]
  raf: number | null
  hydrating: boolean
  openVersion: number
  modelsPromise: Promise<void> | null
  modelsProvider: AgentProvider | null
}

const EMPTY_SNAPSHOT: ChatSessionSnapshot = {
  state: initialChatViewState,
  phase: 'loading',
  provider: 'claude-code',
  availability: null,
  openError: null,
  models: [],
  title: null
}

const runtimes = new Map<string, ConversationRuntime>()

export const useChatSessionStore = create<ChatSessionStoreState>(() => ({
  sessions: {}
}))

function runtimeFor(courseId: string, conversationId: string): ConversationRuntime {
  let runtime = runtimes.get(conversationId)
  if (runtime === undefined) {
    runtime = {
      courseId,
      refCount: 0,
      unsubscribe: null,
      lastSeq: null,
      queue: [],
      raf: null,
      hydrating: false,
      openVersion: 0,
      modelsPromise: null,
      modelsProvider: null
    }
    runtimes.set(conversationId, runtime)
  }
  return runtime
}

function snapshotFor(conversationId: string): ChatSessionSnapshot {
  return useChatSessionStore.getState().sessions[conversationId] ?? EMPTY_SNAPSHOT
}

function updateSnapshot(
  conversationId: string,
  update: (current: ChatSessionSnapshot) => ChatSessionSnapshot
): void {
  useChatSessionStore.setState((store) => {
    const current = store.sessions[conversationId] ?? EMPTY_SNAPSHOT
    const next = update(current)
    if (next === current) {
      return store
    }
    return { sessions: { ...store.sessions, [conversationId]: next } }
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '채팅을 여는 중 문제가 발생했습니다.'
}

function flushQueue(courseId: string, conversationId: string): void {
  const runtime = runtimeFor(courseId, conversationId)
  runtime.raf = null
  if (runtime.hydrating || runtime.queue.length === 0) {
    return
  }
  const events = runtime.queue
  runtime.queue = []
  startTransition(() => {
    updateSnapshot(conversationId, (current) => ({
      ...current,
      state: applyAgentEvents(current.state, events)
    }))
  })
}

function scheduleFlush(courseId: string, conversationId: string): void {
  const runtime = runtimeFor(courseId, conversationId)
  if (runtime.raf !== null || runtime.refCount === 0) {
    return
  }
  runtime.raf = requestAnimationFrame(() => flushQueue(courseId, conversationId))
}

function loadModels(
  courseId: string,
  conversationId: string,
  provider: AgentProvider
): void {
  const runtime = runtimeFor(courseId, conversationId)
  if (
    runtime.modelsPromise !== null ||
    (runtime.modelsProvider === provider &&
      snapshotFor(conversationId).models.length > 0)
  ) {
    return
  }
  runtime.modelsProvider = provider
  runtime.modelsPromise = invoke('agent:models', { provider })
    .then(({ models }) => {
      updateSnapshot(conversationId, (current) => ({ ...current, models }))
    })
    .catch(() => {
      // Main normally returns a fallback. Keep the selector usable if IPC is
      // unavailable during teardown or in an older preload.
    })
    .finally(() => {
      runtime.modelsPromise = null
    })
}

async function openConversation(
  courseId: string,
  conversationId: string,
  opts: { discardQueue: boolean }
): Promise<void> {
  const runtime = runtimeFor(courseId, conversationId)
  const version = ++runtime.openVersion
  runtime.hydrating = true
  if (opts.discardQueue) {
    runtime.queue = []
  }
  try {
    const result = await invoke('chat:open', {
      courseId,
      sessionId: conversationId
    })
    if (version !== runtime.openVersion) {
      return
    }
    updateSnapshot(conversationId, (current) => ({
      ...current,
      provider: result.sessionInfo?.provider ?? current.provider,
      availability: result.availability,
      openError: null,
      title: result.sessionInfo?.title ?? current.title,
      state: hydrateFromHistory(
        result.history,
        result.sessionInfo?.model ?? null
      ),
      phase: 'ready'
    }))
    loadModels(
      courseId,
      conversationId,
      result.sessionInfo?.provider ?? snapshotFor(conversationId).provider
    )
  } catch (error) {
    if (version !== runtime.openVersion) {
      return
    }
    updateSnapshot(conversationId, (current) => ({
      ...current,
      openError: errorMessage(error),
      phase: 'error'
    }))
  } finally {
    if (version === runtime.openVersion) {
      runtime.hydrating = false
      scheduleFlush(courseId, conversationId)
    }
  }
}

function handleBatch(
  courseId: string,
  conversationId: string,
  batch: { sessionId: string; seq: number; events: AgentEvent[] }
): void {
  if (batch.sessionId !== conversationId) {
    return
  }
  const runtime = runtimeFor(courseId, conversationId)
  const check = checkBatchSeq(runtime.lastSeq, batch.seq)
  if (check === 'stale') {
    return
  }
  runtime.lastSeq = batch.seq
  if (check === 'gap') {
    void openConversation(courseId, conversationId, { discardQueue: true })
    return
  }
  runtime.queue.push(...batch.events)
  scheduleFlush(courseId, conversationId)
}

/**
 * Retains the sole push listener for a conversation and preserves state on
 * release. Refcounted per conversation: the same conversation mounted twice
 * (tab + popup) shares one listener.
 */
export function acquireChatSession(
  courseId: string,
  conversationId: string
): () => void {
  const runtime = runtimeFor(courseId, conversationId)
  runtime.courseId = courseId
  if (useChatSessionStore.getState().sessions[conversationId] === undefined) {
    updateSnapshot(conversationId, (current) => ({ ...current }))
  }
  const wasUnused = runtime.refCount === 0
  runtime.refCount += 1
  if (wasUnused) {
    runtime.lastSeq = null
    runtime.queue = []
    runtime.unsubscribe = onPush('chat:event-batch', (batch) => {
      handleBatch(courseId, conversationId, batch)
    })
    void openConversation(courseId, conversationId, { discardQueue: false })
  }

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    runtime.refCount = Math.max(0, runtime.refCount - 1)
    if (runtime.refCount !== 0) {
      return
    }
    runtime.unsubscribe?.()
    runtime.unsubscribe = null
    runtime.openVersion += 1
    runtime.hydrating = false
    runtime.lastSeq = null
    runtime.queue = []
    if (runtime.raf !== null) {
      cancelAnimationFrame(runtime.raf)
      runtime.raf = null
    }
  }
}

export function sendChatMessage(
  courseId: string,
  conversationId: string,
  content: string,
  attachments: ChatAttachment[] = []
): void {
  const text = content.trim()
  if (text === '' && attachments.length === 0) {
    return
  }
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  // First message doubles as the title — optimistic, and identical to the rule
  // main applies in setTitleIfEmpty, so the next open confirms it unchanged.
  const derivedTitle = text.replace(/\s+/g, ' ').trim().slice(0, 60)
  updateSnapshot(conversationId, (current) => ({
    ...current,
    title: current.title ?? (derivedTitle === '' ? null : derivedTitle),
    state: appendLocalUserMessage(current.state, localId, text, attachments)
  }))
  const request = {
    courseId,
    sessionId: conversationId,
    content: text,
    ...(attachments.length === 0 ? {} : { attachments })
  }
  void invoke('chat:send', request).catch(() => {
    updateSnapshot(conversationId, (current) => ({
      ...current,
      state: markSendFailed(current.state)
    }))
  })
}

export function cancelChatTurn(courseId: string, conversationId: string): void {
  void invoke('chat:cancel', { courseId, sessionId: conversationId }).catch(() => {
    // Best-effort: turn-complete(interrupted) is authoritative.
  })
}

export function respondToChatPermission(
  courseId: string,
  conversationId: string,
  requestId: string,
  response: PermissionResponse
): void {
  updateSnapshot(conversationId, (current) => ({
    ...current,
    state: applyLocalPermissionResponse(
      current.state,
      requestId,
      response.behavior
    )
  }))
  void invoke('chat:respondPermission', {
    courseId,
    sessionId: conversationId,
    requestId,
    response
  }).catch(() => {
    // A dropped response remains pending in the CLI and is surfaced there.
  })
}

export function refreshChatSession(
  courseId: string,
  conversationId: string
): void {
  void openConversation(courseId, conversationId, { discardQueue: false })
}

export function dismissChatNotice(
  _courseId: string,
  conversationId: string
): void {
  updateSnapshot(conversationId, (current) => ({
    ...current,
    state: clearNotice(current.state)
  }))
}

export function setChatModel(
  courseId: string,
  conversationId: string,
  model: string
): void {
  void invoke('chat:setModel', { courseId, sessionId: conversationId, model })
    .then(() => {
      updateSnapshot(conversationId, (current) => ({
        ...current,
        state: { ...current.state, model }
      }))
    })
    .catch(() => {
      // Keep the previously confirmed selection when changing the model fails.
    })
}

/**
 * Saves the preferred provider. A conversation with no messages yet is simply
 * reopened in place under the new provider; one that already has history
 * cannot switch (its CLI transcript belongs to the old provider), so the
 * caller gets `{ needsNewConversation: true }` and decides what to do.
 */
export function setChatProvider(
  courseId: string,
  conversationId: string,
  provider: AgentProvider
): SetChatProviderResult {
  const hasMessages = snapshotFor(conversationId).state.messages.length > 0
  if (hasMessages) {
    // Still persist the preference: the NEW conversation the caller opens
    // next is what follows settings' agentProvider.
    void invoke('settings:set', { agentProvider: provider }).catch(() => {
      // The caller surfaces provider problems on the next open.
    })
    return { needsNewConversation: true }
  }

  const runtime = runtimeFor(courseId, conversationId)
  runtime.modelsProvider = null
  updateSnapshot(conversationId, (current) => ({
    ...current,
    provider,
    phase: 'loading',
    availability: null,
    openError: null,
    models: []
  }))
  void invoke('settings:set', { agentProvider: provider })
    .then(async () => {
      try {
        await invoke('chat:close', { courseId, sessionId: conversationId })
      } catch {
        // The provider setting is authoritative. An older main process may not
        // have a live session to close, so continue with a fresh open.
      }
      if (snapshotFor(conversationId).provider === provider) {
        await openConversation(courseId, conversationId, { discardQueue: true })
      }
    })
    .catch((error: unknown) => {
      if (snapshotFor(conversationId).provider !== provider) {
        return
      }
      updateSnapshot(conversationId, (current) => ({
        ...current,
        phase: 'error',
        openError: errorMessage(error)
      }))
    })
  return { needsNewConversation: false }
}

export function selectChatSession(conversationId: string): ChatSessionSnapshot {
  return snapshotFor(conversationId)
}
