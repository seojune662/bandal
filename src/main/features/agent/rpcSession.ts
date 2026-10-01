import type { ChildProcess } from 'node:child_process'
import type { AgentEvent, AgentProvider, AgentSession, AgentStartSessionOptions, PermissionResponse } from '../../../shared/types/agent-events'
import type { ChatAttachment } from '../../../shared/types/chat'
import { createJsonRpc, type RpcMessage, type RpcObject } from './jsonRpc'
import { killProcessTree } from './platform'

/** One process and configuration per conversation; no shared mutable settings. */
export function createRpcSession(options: AgentStartSessionOptions, provider: 'codex' | 'gemini', spawn: () => ChildProcess, cleanup: () => void = () => {}): AgentSession {
  const listeners = new Set<(event: AgentEvent) => void>()
  const queues = new Set<{ items: AgentEvent[]; wake?: (() => void) | undefined }>()
  let child: ChildProcess | null = null, rpc: ReturnType<typeof createJsonRpc> | null = null
  let disposed = false, running = false, cancelled = false, started = false, sessionKey = '', turnId = '', turnSequence = 0
  let initialization: Promise<void> | null = null
  let executionTimer: ReturnType<typeof setTimeout> | undefined
  const armExecutionTimeout = (): void => {
    clearTimeout(executionTimer)
    if (!running || approvals.size) return
    executionTimer = setTimeout(() => {
      fail(new Error('AI 작업이 5분 동안 응답하지 않았어요. 다시 보내면 대화를 이어갈 수 있어요.'))
      if (child?.pid) killProcessTree(child.pid, 'SIGTERM')
    }, 5 * 60 * 1000)
    executionTimer.unref()
  }
  let resolveId!: (id: string) => void, rejectId!: (error: Error) => void
  const sessionId = new Promise<string>((resolve, reject) => { resolveId = resolve; rejectId = reject })
  void sessionId.catch(() => {})
  const approvals = new Map<string, { id: string | number; method: string; params: RpcObject }>()
  const resolvedApprovals = new Set<string>()
  const completedItems = new Set<string>()
  const emit = (event: AgentEvent): void => { if (disposed) return; for (const listener of listeners) listener(event); for (const queue of queues) { queue.items.push(event); queue.wake?.() } }
  const finish = (reason: 'success' | 'interrupted' | 'error'): void => {
    if (!running) return
    running = false; turnId = ''; clearTimeout(executionTimer)
    for (const [key] of approvals) answer(key, { behavior: 'deny' })
    emit({ type: 'turn-complete', stopReason: reason })
  }
  const fail = (error: Error): void => {
    if (disposed) return
    rejectId(error)
    const message = /no longer supported.*Gemini Code Assist/i.test(error.message) ? '현재 Google 계정의 Gemini Code Assist 연결이 서버에서 지원 종료로 거절됐어요. 설정 → AI에서 Gemini API 키를 연결하거나 다른 제공자를 선택해 주세요.' : error.message
    emit({ type: 'error', code: 'process-crashed', message, fatal: true })
    finish(cancelled ? 'interrupted' : 'error')
  }
  function answer(key: string, response: PermissionResponse): void {
    const pending = approvals.get(key)
    if (!pending || !rpc) return
    const allow = response.behavior === 'allow'
    let result: unknown
    if (provider === 'gemini') {
      const options = pending.params.options as { optionId: string; kind: string }[] | undefined
      const selected = options?.find(option => option.kind === (allow ? 'allow_once' : 'reject_once'))
      result = selected ? { outcome: { outcome: 'selected', optionId: selected.optionId } } : { outcome: { outcome: 'cancelled' } }
    } else if (pending.method === 'item/permissions/requestApproval') {
      // Never silently broaden the provider's sandbox beyond the user's scope.
      result = { permissions: allow ? pending.params.permissions ?? {} : {}, scope: 'turn' }
    } else if (pending.method === 'mcpServer/elicitation/request') result = { action: allow ? 'accept' : 'decline', content: null }
    else result = { decision: allow ? 'accept' : 'decline' }
    rpc.respond(pending.id, result)
    approvals.delete(key)
    resolvedApprovals.add(key)
    armExecutionTimeout()
    emit({ type: 'permission-resolved', requestId: key, behavior: response.behavior })
  }
  function receive(message: RpcMessage): void {
    const p = message.params ?? {}, method = message.method ?? ''
    if (running && message.id === undefined) armExecutionTimeout()
    if (message.id !== undefined) {
      const supported = provider === 'gemini' ? method === 'session/request_permission' : ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'mcpServer/elicitation/request'].includes(method)
      if (!supported) { rpc?.reject(message.id, '이 요청은 반달에서 지원하지 않아요. 대화로 필요한 내용을 물어봐 주세요.'); return }
      const key = `${provider}:${typeof message.id}:${message.id}`
      if (approvals.has(key) || resolvedApprovals.has(key)) return
      clearTimeout(executionTimer)
      approvals.set(key, { id: message.id, method, params: p })
      const tool = provider === 'gemini' ? p.toolCall?.title ?? p.toolCall?.kind ?? 'Gemini 작업' : method.includes('commandExecution') ? 'Bash' : method.includes('fileChange') ? 'fileChange' : '추가 접근'
      emit({ type: 'permission-request', requestId: key, toolName: tool, input: provider === 'gemini' ? p.toolCall?.rawInput ?? p.toolCall : p })
      return
    }
    if (provider === 'codex') {
      if (p.threadId && sessionKey && p.threadId !== sessionKey) return
      if (method === 'turn/started') turnId = p.turn?.id ?? turnId
      if (method === 'item/agentMessage/delta') emit({ type: 'text-delta', blockId: p.itemId, text: p.delta ?? '' })
      if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') emit({ type: 'thinking-delta', blockId: p.itemId, text: p.delta ?? '' })
      if (method === 'item/started' || method === 'item/completed') {
        const item = p.item ?? {}, id = item.id ?? ''
        if (method === 'item/completed' && completedItems.has(id)) return
        if (method === 'item/completed') completedItems.add(id)
        if (item.type === 'agentMessage' && method === 'item/completed') emit({ type: 'text-final', blockId: id, text: item.text ?? '' })
        else if (['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch', 'imageGeneration'].includes(item.type)) {
          if (method === 'item/started') emit({ type: 'tool-start', toolCallId: id, toolName: item.tool ?? item.type, label: item.command ?? item.tool ?? item.type, input: item.arguments ?? item })
          else emit({ type: 'tool-end', toolCallId: id, ok: !['failed', 'declined'].includes(item.status) && !item.error })
        }
      }
      if (method === 'serverRequest/resolved') {
        const key = `codex:${typeof p.requestId}:${p.requestId}`
        if (approvals.delete(key)) { resolvedApprovals.add(key); armExecutionTimeout(); emit({ type: 'permission-resolved', requestId: key, behavior: 'deny' }) }
      }
      if (method === 'thread/tokenUsage/updated') {
        const u = p.tokenUsage?.last
        if (u) emit({ type: 'usage', usage: { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, cacheReadTokens: u.cachedInputTokens ?? 0 } })
      }
      if (method === 'turn/completed') {
        if (p.turn?.error) emit({ type: 'error', code: 'unknown', message: p.turn.error.message ?? '응답을 완료하지 못했어요.', fatal: false })
        finish(p.turn?.status === 'interrupted' ? 'interrupted' : p.turn?.status === 'failed' ? 'error' : 'success')
      }
      if (method === 'error' && !p.willRetry) { emit({ type: 'error', code: 'unknown', message: p.error?.message ?? 'Codex 연결 오류', fatal: false }); finish('error') }
    } else if (method === 'session/update' && started && running) {
      if (p.sessionId && sessionKey && p.sessionId !== sessionKey) return
      const u = p.update ?? {}, id = u.toolCallId ?? `gemini-${turnSequence}`
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') emit({ type: 'text-delta', blockId: id, text: u.content.text })
      if (u.sessionUpdate === 'agent_thought_chunk' && u.content?.type === 'text') emit({ type: 'thinking-delta', blockId: `${id}-thinking`, text: u.content.text })
      if (u.sessionUpdate === 'tool_call') emit({ type: 'tool-start', toolCallId: id, toolName: u.title ?? u.kind ?? 'tool', label: u.title ?? '작업 중', input: u.rawInput })
      if (u.sessionUpdate === 'tool_call_update' && ['completed', 'failed'].includes(u.status) && !completedItems.has(id)) { completedItems.add(id); emit({ type: 'tool-end', toolCallId: id, ok: u.status === 'completed' }) }
    }
  }
  async function initialize(): Promise<void> {
    child = spawn()
    rpc = createJsonRpc(child, receive, fail)
    // Drain stderr without ever surfacing environment tokens or noisy progress.
    child.stderr?.on('data', () => {})
    if (provider === 'codex') {
      await rpc.request('initialize', { clientInfo: { name: 'bandal', title: 'Bandal', version: '0.60.0' }, capabilities: {} })
      rpc.notify('initialized')
      const common = { cwd: options.cwd, model: options.model, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: options.accessPolicy?.mode === 'ask' ? 'read-only' : 'workspace-write', developerInstructions: options.systemPromptAppend ?? null }
      const result = await rpc.request(options.resumeCliSessionId ? 'thread/resume' : 'thread/start', { ...common, ...(options.resumeCliSessionId ? { threadId: options.resumeCliSessionId } : {}) })
      sessionKey = result.thread.id
    } else {
      const initialized = await rpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'bandal', version: '0.60.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
      if (!initialized.agentCapabilities?.promptCapabilities?.image) throw new Error('이 Gemini CLI는 이미지 ACP 입력을 지원하지 않아요. 설정 → AI에서 업데이트해 주세요.')
      if (options.resumeCliSessionId && !initialized.agentCapabilities?.loadSession) throw new Error('이 Gemini CLI는 대화 재개를 지원하지 않아요. 설정 → AI에서 업데이트해 주세요.')
      const params = { cwd: options.cwd, mcpServers: [], ...(options.resumeCliSessionId ? { sessionId: options.resumeCliSessionId } : {}) }
      const result = await rpc.request(options.resumeCliSessionId ? 'session/load' : 'session/new', params)
      sessionKey = options.resumeCliSessionId ?? result.sessionId
      if (options.model) await rpc.request('session/set_model', { sessionId: sessionKey, modelId: options.model })
    }
    started = true; resolveId(sessionKey)
    emit({ type: 'session-started', sessionId: sessionKey, model: options.model ?? 'default', provider: provider as AgentProvider })
  }
  return {
    sessionId,
    on(callback) { listeners.add(callback); return () => listeners.delete(callback) },
    events: { [Symbol.asyncIterator]() { const queue = { items: [] as AgentEvent[], wake: undefined as (() => void) | undefined }; queues.add(queue); return {
      async next(): Promise<IteratorResult<AgentEvent>> { while (!disposed) { const item = queue.items.shift(); if (item) return { value: item, done: false }; await new Promise<void>(resolve => { queue.wake = resolve }) } return { value: undefined, done: true } },
      async return(): Promise<IteratorResult<AgentEvent>> { queues.delete(queue); return { value: undefined, done: true } }
    } } },
    sendMessage(content: string, attachments: ChatAttachment[] = []) {
      if (disposed || running) throw new Error('진행 중인 응답을 마친 뒤 보내 주세요.')
      running = true; cancelled = false; turnSequence++; completedItems.clear()
      const first = !started
      armExecutionTimeout()
      initialization ??= initialize()
      void initialization.then(async () => {
        if (cancelled || disposed) { finish('interrupted'); return }
        if (provider === 'codex') {
          const result = await rpc!.request('turn/start', { threadId: sessionKey, input: [{ type: 'text', text: content }, ...attachments.map(image => ({ type: 'image', url: `data:${image.mediaType};base64,${image.dataBase64}` }))], model: options.model, effort: options.effort })
          if (running) turnId = result.turn?.id ?? turnId
        } else {
          const text = first && options.systemPromptAppend ? `${options.systemPromptAppend}\n\n${content}` : content
          const result = await rpc!.request('session/prompt', { sessionId: sessionKey, prompt: [{ type: 'text', text }, ...attachments.map(image => ({ type: 'image', mimeType: image.mediaType, data: image.dataBase64 }))] }, 0)
          finish(cancelled || result.stopReason === 'cancelled' ? 'interrupted' : 'success')
        }
      }).catch(fail)
    },
    respondPermission: answer,
    cancel() {
      cancelled = true
      for (const [key] of approvals) answer(key, { behavior: 'deny' })
      if (rpc && sessionKey) {
        if (provider === 'gemini') rpc.notify('session/cancel', { sessionId: sessionKey })
        else if (turnId) void rpc.request('turn/interrupt', { threadId: sessionKey, turnId }).catch(fail)
      }
      const timer = setTimeout(() => { if (running && cancelled) { finish('interrupted'); if (child?.pid) killProcessTree(child.pid, 'SIGTERM') } }, 5000)
      timer.unref()
    },
    dispose() {
      if (disposed) return
      disposed = true; clearTimeout(executionTimer); rpc?.dispose(); rejectId(new Error('대화를 닫았어요.'))
      if (child?.pid) { const pid = child.pid; killProcessTree(pid, 'SIGTERM'); const timer = setTimeout(() => killProcessTree(pid, 'SIGKILL'), 3000); timer.unref() }
      for (const queue of queues) queue.wake?.()
      cleanup()
    }
  }
}
