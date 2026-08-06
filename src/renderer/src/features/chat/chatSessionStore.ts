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
}

interface ChatSessionStoreState {
  sessions: Record<string, ChatSessionSnapshot>
}

interface CourseRuntime {
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
  models: []
}

const runtimes = new Map<string, CourseRuntime>()

export const useChatSessionStore = create<ChatSessionStoreState>(() => ({
  sessions: {}
}))

function runtimeFor(courseId: string): CourseRuntime {
  let runtime = runtimes.get(courseId)
  if (runtime === undefined) {
    runtime = {
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
    runtimes.set(courseId, runtime)
  }
  return runtime
}

function snapshotFor(courseId: string): ChatSessionSnapshot {
  return useChatSessionStore.getState().sessions[courseId] ?? EMPTY_SNAPSHOT
}

function updateSnapshot(
  courseId: string,
  update: (current: ChatSessionSnapshot) => ChatSessionSnapshot
): void {
  useChatSessionStore.setState((store) => {
    const current = store.sessions[courseId] ?? EMPTY_SNAPSHOT
    const next = update(current)
    if (next === current) {
      return store
    }
    return { sessions: { ...store.sessions, [courseId]: next } }
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '채팅을 여는 중 문제가 발생했습니다.'
}

function flushQueue(courseId: string): void {
  const runtime = runtimeFor(courseId)
  runtime.raf = null
  if (runtime.hydrating || runtime.queue.length === 0) {
    return
  }
  const events = runtime.queue
  runtime.queue = []
  startTransition(() => {
    updateSnapshot(courseId, (current) => ({
      ...current,
      state: applyAgentEvents(current.state, events)
    }))
  })
}

function scheduleFlush(courseId: string): void {
  const runtime = runtimeFor(courseId)
  if (runtime.raf !== null || runtime.refCount === 0) {
    return
  }
  runtime.raf = requestAnimationFrame(() => flushQueue(courseId))
}

function loadModels(courseId: string, provider: AgentProvider): void {
  const runtime = runtimeFor(courseId)
  if (
    runtime.modelsPromise !== null ||
    (runtime.modelsProvider === provider && snapshotFor(courseId).models.length > 0)
  ) {
    return
  }
  runtime.modelsProvider = provider
  runtime.modelsPromise = invoke('agent:models', { provider })
    .then(({ models }) => {
      updateSnapshot(courseId, (current) => ({ ...current, models }))
    })
    .catch(() => {
      // Main normally returns a fallback. Keep the selector usable if IPC is
      // unavailable during teardown or in an older preload.
    })
    .finally(() => {
      runtime.modelsPromise = null
    })
}

async function openCourse(
  courseId: string,
  opts: { discardQueue: boolean }
): Promise<void> {
  const runtime = runtimeFor(courseId)
  const version = ++runtime.openVersion
  runtime.hydrating = true
  if (opts.discardQueue) {
    runtime.queue = []
  }
  try {
    const result = await invoke('chat:open', { courseId })
    if (version !== runtime.openVersion) {
      return
    }
    updateSnapshot(courseId, (current) => ({
      ...current,
      provider: result.sessionInfo?.provider ?? current.provider,
      availability: result.availability,
      openError: null,
      state: hydrateFromHistory(
        result.history,
        result.sessionInfo?.model ?? null
      ),
      phase: 'ready'
    }))
    loadModels(
      courseId,
      result.sessionInfo?.provider ?? snapshotFor(courseId).provider
    )
  } catch (error) {
    if (version !== runtime.openVersion) {
      return
    }
    updateSnapshot(courseId, (current) => ({
      ...current,
      openError: errorMessage(error),
      phase: 'error'
    }))
  } finally {
    if (version === runtime.openVersion) {
      runtime.hydrating = false
      scheduleFlush(courseId)
    }
  }
}

function handleBatch(
  courseId: string,
  batch: { courseId: string; seq: number; events: AgentEvent[] }
): void {
  if (batch.courseId !== courseId) {
    return
  }
  const runtime = runtimeFor(courseId)
  const check = checkBatchSeq(runtime.lastSeq, batch.seq)
  if (check === 'stale') {
    return
  }
  runtime.lastSeq = batch.seq
  if (check === 'gap') {
    void openCourse(courseId, { discardQueue: true })
    return
  }
  runtime.queue.push(...batch.events)
  scheduleFlush(courseId)
}

/** Retains the sole push listener for a course and preserves state on release. */
export function acquireChatSession(courseId: string): () => void {
  const runtime = runtimeFor(courseId)
  if (useChatSessionStore.getState().sessions[courseId] === undefined) {
    updateSnapshot(courseId, (current) => ({ ...current }))
  }
  const wasUnused = runtime.refCount === 0
  runtime.refCount += 1
  if (wasUnused) {
    runtime.lastSeq = null
    runtime.queue = []
    runtime.unsubscribe = onPush('chat:event-batch', (batch) => {
      handleBatch(courseId, batch)
    })
    void openCourse(courseId, { discardQueue: false })
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
  content: string,
  attachments: ChatAttachment[] = []
): void {
  const text = content.trim()
  if (text === '' && attachments.length === 0) {
    return
  }
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  updateSnapshot(courseId, (current) => ({
    ...current,
    state: appendLocalUserMessage(current.state, localId, text, attachments)
  }))
  const request = {
    courseId,
    content: text,
    ...(attachments.length === 0 ? {} : { attachments })
  }
  void invoke('chat:send', request).catch(() => {
    updateSnapshot(courseId, (current) => ({
      ...current,
      state: markSendFailed(current.state)
    }))
  })
}

export function cancelChatTurn(courseId: string): void {
  void invoke('chat:cancel', { courseId }).catch(() => {
    // Best-effort: turn-complete(interrupted) is authoritative.
  })
}

export function respondToChatPermission(
  courseId: string,
  requestId: string,
  response: PermissionResponse
): void {
  updateSnapshot(courseId, (current) => ({
    ...current,
    state: applyLocalPermissionResponse(
      current.state,
      requestId,
      response.behavior
    )
  }))
  void invoke('chat:respondPermission', {
    courseId,
    requestId,
    response
  }).catch(() => {
    // A dropped response remains pending in the CLI and is surfaced there.
  })
}

export function refreshChatSession(courseId: string): void {
  void openCourse(courseId, { discardQueue: false })
}

export function dismissChatNotice(courseId: string): void {
  updateSnapshot(courseId, (current) => ({
    ...current,
    state: clearNotice(current.state)
  }))
}

export function setChatModel(courseId: string, model: string): void {
  void invoke('chat:setModel', { courseId, model })
    .then(() => {
      updateSnapshot(courseId, (current) => ({
        ...current,
        state: { ...current.state, model }
      }))
    })
    .catch(() => {
      // Keep the previously confirmed selection when changing the model fails.
    })
}

/** Saves the preferred provider, closes the old runtime, then re-opens chat. */
export function setChatProvider(
  courseId: string,
  provider: AgentProvider
): void {
  const runtime = runtimeFor(courseId)
  runtime.modelsProvider = null
  updateSnapshot(courseId, (current) => ({
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
        await invoke('chat:close', { courseId })
      } catch {
        // The provider setting is authoritative. An older main process may not
        // have a live course session to close, so continue with a fresh open.
      }
      if (snapshotFor(courseId).provider === provider) {
        await openCourse(courseId, { discardQueue: true })
      }
    })
    .catch((error: unknown) => {
      if (snapshotFor(courseId).provider !== provider) {
        return
      }
      updateSnapshot(courseId, (current) => ({
        ...current,
        phase: 'error',
        openError: errorMessage(error)
      }))
    })
}

export function selectChatSession(courseId: string): ChatSessionSnapshot {
  return snapshotFor(courseId)
}
