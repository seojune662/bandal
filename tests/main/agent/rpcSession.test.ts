import { afterEach, describe, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { createRpcSession } from '../../../src/main/features/agent/rpcSession'
import type { AgentEvent, AgentStartSessionOptions } from '../../../src/shared/types/agent-events'
function fixture(provider: 'codex' | 'gemini', resume?: string, overrides: Partial<AgentStartSessionOptions> = {}) {
  const child = new EventEmitter() as ChildProcess
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
  const messages: any[] = [], events: AgentEvent[] = []
  const deferred = new Set<string>(), results: Record<string, any> = {}
  let turn = 0
  const send = (message: any): void => { child.stdout!.emit('data', Buffer.from(JSON.stringify(message) + '\n')) }
  child.stdin.on('data', chunk => {
    const msg = JSON.parse(String(chunk)); messages.push(msg)
    if (!msg.method || msg.id === undefined || deferred.has(msg.method)) return
    let result: any = {}
    if (msg.method === 'initialize') result = { agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } }
    if (msg.method === 'thread/start' || msg.method === 'thread/resume') result = { thread: { id: resume ?? 'thread-1' }, model: 'gpt-real' }
    if (msg.method === 'turn/start') result = { turn: { id: `turn-${++turn}` } }
    if (msg.method === 'session/new') result = { sessionId: 'gemini-1', models: { currentModelId: 'auto' } }
    if (msg.method === 'session/prompt') return
    queueMicrotask(() => send({ id: msg.id, result: results[msg.method] ?? result }))
  })
  const session = createRpcSession({ courseId: 'course', cwd: '/tmp/course', ...(resume ? { resumeCliSessionId: resume } : {}), ...overrides }, provider, () => child)
  session.on(event => events.push(event))
  return { session, child, send, messages, events, deferred, results }
}
test.each([undefined, 'existing-study'])('Codex learning search stays native and preserves approval policy on thread %s', async resume => {
  const f = fixture('codex', resume, { webSearch: 'live' })
  f.session.sendMessage('find a public article')
  await f.session.sessionId
  const request = f.messages.find(message => message.method === (resume ? 'thread/resume' : 'thread/start'))
  expect(request.params).toMatchObject({ config: { web_search: 'live' }, approvalPolicy: 'untrusted', approvalsReviewer: 'user' })
  f.send({ method: 'item/started', params: { threadId: resume ?? 'thread-1', item: { id: 'search-1', type: 'webSearch', action: { type: 'search', query: 'NASA science' } } } })
  f.send({ method: 'item/completed', params: { threadId: resume ?? 'thread-1', item: { id: 'search-1', type: 'webSearch', status: 'completed' } } })
  expect(f.events).toContainEqual(expect.objectContaining({ type: 'tool-start', toolName: 'webSearch', toolCallId: 'search-1' }))
  expect(f.events.filter(event => event.type === 'permission-request')).toHaveLength(0)
  f.session.dispose()
})
test('ordinary Codex threads inherit their existing search configuration', async () => {
  const f = fixture('codex')
  f.session.sendMessage('ordinary chat')
  await f.session.sessionId
  expect(f.messages.find(message => message.method === 'thread/start').params).not.toHaveProperty('config')
  f.session.dispose()
})
for (const provider of ['codex', 'gemini'] as const) describe(provider, () => {
  test('streams real image input and resolves each approval only once', async () => {
    const f = fixture(provider)
    f.session.sendMessage('Explain', [{ mediaType: 'image/png', dataBase64: 'aW1hZ2U=' }])
    await vi.waitFor(() => expect(f.messages.some(m => m.method === (provider === 'codex' ? 'turn/start' : 'session/prompt'))).toBe(true))
    expect(JSON.stringify(f.messages)).toContain('aW1hZ2U=')
    const method = provider === 'codex' ? 'item/commandExecution/requestApproval' : 'session/request_permission'
    const request = { id: 'approval-1', method, params: { threadId: 'thread-1', toolCall: { title: 'write_file' }, options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } }
    f.send(request); f.send(request)
    expect(f.events.filter(e => e.type === 'permission-request')).toHaveLength(1)
    const event = f.events.find(e => e.type === 'permission-request')!
    if (event.type !== 'permission-request') throw new Error('missing')
    f.session.respondPermission(event.requestId, { behavior: 'allow' })
    f.session.respondPermission(event.requestId, { behavior: 'deny' })
    f.send(request) // Replay after resolution must never execute again.
    expect(f.events.filter(e => e.type === 'permission-request')).toHaveLength(1)
    expect(f.messages.filter(m => m.id === 'approval-1' && m.result)).toHaveLength(1)
    const answer = f.messages.find(m => m.id === 'approval-1').result
    expect(provider === 'codex' ? answer.decision : answer.outcome.optionId).toBe(provider === 'codex' ? 'accept' : 'yes')
    f.session.dispose()
  })
  test('resumes the original session and rejects overlapping sends', async () => {
    const f = fixture(provider, 'existing-session')
    f.session.sendMessage('Next')
    expect(() => f.session.sendMessage('Duplicate')).toThrow()
    await expect(f.session.sessionId).resolves.toBe('existing-session')
    expect(f.messages.some(m => m.method === (provider === 'codex' ? 'thread/resume' : 'session/load'))).toBe(true)
    f.session.cancel(); f.session.dispose()
  })
  test('denies outstanding approvals on cancellation and ignores late duplicate completion', async () => {
    const f = fixture(provider); f.session.sendMessage('test'); await f.session.sessionId
    await vi.waitFor(() => expect(f.messages.some(m => /turn\/start|session\/prompt/.test(m.method))).toBe(true))
    const method = provider === 'codex' ? 'item/fileChange/requestApproval' : 'session/request_permission'
    f.send({ id: 90, method, params: { options: [{ optionId: 'no', kind: 'reject_once' }] } })
    f.session.cancel()
    expect(f.messages.filter(m => m.id === 90 && m.result)).toHaveLength(1)
    if (provider === 'codex') { f.send({ method: 'turn/completed', params: { turn: { status: 'interrupted' } } }); f.send({ method: 'turn/completed', params: { turn: { status: 'completed' } } }) }
    else { const request = f.messages.find(m => m.method === 'session/prompt'); f.send({ id: request.id, result: { stopReason: 'cancelled' } }); await Promise.resolve() }
    expect(f.events.filter(e => e.type === 'turn-complete')).toHaveLength(1)
    f.session.dispose()
  })
})


afterEach(() => vi.useRealTimers())
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve() }

for (const provider of ['codex', 'gemini'] as const) {
  test(`${provider} child failure while approval is pending never writes to the closed transport`, async () => {
    const f = fixture(provider)
    f.session.on(event => { if (event.type === 'error' && event.fatal) f.session.dispose() })
    f.session.sendMessage('test'); await f.session.sessionId; await flush()
    f.send({ id: 500, method: provider === 'codex' ? 'item/fileChange/requestApproval' : 'session/request_permission', params: { toolCall: { kind: 'edit', toolCallId: 'edit' }, options: [] } })
    expect(() => f.child.emit('close', 1, null)).not.toThrow()
    expect(f.session.closed).toBe(true)
    expect(f.events.filter(event => event.type === 'error')).toHaveLength(1)
    expect(f.messages.filter(message => message.id === 500 && message.result)).toHaveLength(0)
    expect(f.events).toContainEqual({ type: 'permission-resolved', requestId: `${provider}:number:500`, behavior: 'deny' })
  })
  test(`${provider} default selection never becomes a provider model ID`, async () => {
    const f = fixture(provider, undefined, { model: 'default' })
    f.session.sendMessage('test'); await f.session.sessionId; await flush()
    for (const request of f.messages.filter(message => ['thread/start', 'turn/start'].includes(message.method))) expect(request.params).not.toHaveProperty('model')
    expect(f.messages.some(message => message.method === 'session/set_model')).toBe(false)
    expect(f.events).toContainEqual(expect.objectContaining({ type: 'session-started', model: provider === 'codex' ? 'gpt-real' : 'auto' }))
    f.session.dispose()
  })
  test(`${provider} ignored cancellation closes the connection once and completes interrupted`, async () => {
    vi.useFakeTimers()
    const f = fixture(provider); f.session.sendMessage('test'); await f.session.sessionId; await flush()
    f.session.cancel(); await vi.advanceTimersByTimeAsync(5000)
    expect(f.session.closed).toBe(true)
    expect(f.events.filter(event => event.type === 'turn-complete')).toEqual([expect.objectContaining({ stopReason: 'interrupted' })])
    expect(f.events.filter(event => event.type === 'error')).toHaveLength(0)
    expect(() => f.session.sendMessage('retry on closed transport')).toThrow('닫혔어요')
    f.session.dispose()
  })
  test(`${provider} cancellation during initialize prevents a prompt after the late handshake`, async () => {
    vi.useFakeTimers()
    const f = fixture(provider); f.deferred.add('initialize'); f.session.sendMessage('test'); f.session.cancel()
    await vi.advanceTimersByTimeAsync(5000)
    const request = f.messages.find(message => message.method === 'initialize')
    f.send({ id: request.id, result: { agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } }); await flush()
    expect(f.messages.some(message => ['thread/start', 'session/new', 'turn/start', 'session/prompt'].includes(message.method))).toBe(false)
    expect(f.events.filter(event => event.type === 'turn-complete')).toHaveLength(1)
    f.session.dispose()
  })
}

test('Codex keeps an errored turn active until its terminal notification and ignores its later events', async () => {
  const f = fixture('codex'); f.session.sendMessage('first'); await f.session.sessionId; await flush()
  f.send({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: false, error: { message: 'model request failed' } } })
  expect(() => f.session.sendMessage('too early')).toThrow('진행 중')
  f.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed' } } })
  f.session.sendMessage('second'); await flush()
  f.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } })
  f.send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'old', delta: 'old text' } })
  f.send({ id: 'stale', method: 'item/fileChange/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1' } })
  expect(f.events.filter(event => event.type === 'turn-complete')).toHaveLength(1)
  expect(f.events.some(event => event.type === 'text-delta' && event.text === 'old text')).toBe(false)
  expect(f.events.filter(event => event.type === 'permission-request')).toHaveLength(0)
  expect(() => f.session.sendMessage('overlap')).toThrow('진행 중')
  f.session.dispose()
})

test('Codex cancellation before turn/start acknowledges interrupts the returned turn', async () => {
  const f = fixture('codex'); f.deferred.add('turn/start'); f.session.sendMessage('test'); await f.session.sessionId; await flush()
  f.session.cancel()
  const request = f.messages.find(message => message.method === 'turn/start')
  f.send({ id: request.id, result: { turn: { id: 'late-turn' } } }); await flush()
  expect(f.messages.find(message => message.method === 'turn/interrupt')?.params).toMatchObject({ turnId: 'late-turn' })
  f.session.dispose()
})

test('Codex preserves nonzero command exits, bounded result text and final turn usage', async () => {
  const f = fixture('codex'); f.session.sendMessage('test'); await f.session.sessionId; await flush()
  f.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'bad-command', type: 'commandExecution', status: 'completed', exitCode: 1, aggregatedOutput: 'failed\n' + 'x'.repeat(3000) } } })
  const usage = { inputTokens: 21, outputTokens: 8, cachedInputTokens: 5 }
  f.send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', tokenUsage: { last: usage } } })
  f.send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', tokenUsage: { last: usage } } })
  f.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } })
  expect(f.events).toContainEqual(expect.objectContaining({ type: 'tool-end', ok: false, result: { summary: 'failed', preview: expect.any(String), truncated: true } }))
  const tool = f.events.find(event => event.type === 'tool-end')
  if (tool?.type !== 'tool-end') throw new Error('missing result')
  expect(tool.result?.preview?.length).toBe(2000)
  expect(f.events).toContainEqual(expect.objectContaining({ type: 'turn-complete', usage: { inputTokens: 21, outputTokens: 8, cacheReadTokens: 5 } }))
  f.session.dispose()
})

test('Gemini ACP edit approvals use kind and actual locations rather than the display title', async () => {
  const f = fixture('gemini'); f.session.sendMessage('test'); await f.session.sessionId; await flush()
  f.send({ id: 'edit-approval', method: 'session/request_permission', params: { sessionId: 'gemini-1', toolCall: { toolCallId: 'edit-1', title: 'WriteFile(notes.md)', kind: 'edit', locations: [{ path: '/tmp/course/notes.md' }], content: [{ type: 'diff', path: '/tmp/course/notes.md', oldText: '', newText: 'note' }] }, options: [{ kind: 'allow_once', optionId: 'once' }] } })
  expect(f.events).toContainEqual(expect.objectContaining({ type: 'permission-request', toolName: 'fileChange', input: { title: 'WriteFile(notes.md)', paths: ['/tmp/course/notes.md'] } }))
  expect(f.events).toContainEqual(expect.objectContaining({ type: 'tool-start', toolName: 'fileChange', toolCallId: 'edit-1' }))
  f.session.dispose()
})

test('a text-only Gemini transport remains usable and rejects only an unsupported image prompt', async () => {
  const f = fixture('gemini'); f.results.initialize = { agentCapabilities: { loadSession: true, promptCapabilities: { image: false } } }
  f.session.sendMessage('image', [{ mediaType: 'image/png', dataBase64: 'aW1hZ2U=' }]); await f.session.sessionId; await flush()
  expect(f.events).toContainEqual(expect.objectContaining({ type: 'error', fatal: false }))
  expect(f.session.closed).toBe(false)
  f.session.sendMessage('text'); await flush()
  expect(f.messages.some(message => message.method === 'session/prompt')).toBe(true)
  f.session.dispose()
})


test('Codex completion before turn/start response still fences late previous-turn notifications', async () => {
  const f = fixture('codex'); f.deferred.add('turn/start'); f.session.sendMessage('first'); await f.session.sessionId; await flush()
  const oldStart = f.messages.find(message => message.method === 'turn/start')
  f.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'fast-turn', status: 'completed' } } })
  f.session.sendMessage('second'); await flush()
  f.send({ id: oldStart.id, result: { turn: { id: 'fast-turn' } } })
  f.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'fast-turn', status: 'completed' } } })
  f.send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'fast-turn', tokenUsage: { last: { inputTokens: 99, outputTokens: 99 } } } })
  expect(f.events.filter(event => event.type === 'turn-complete')).toHaveLength(1)
  expect(f.events.filter(event => event.type === 'usage')).toHaveLength(0)
  expect(() => f.session.sendMessage('overlap')).toThrow('진행 중')
  f.session.dispose()
})


test.each([
  ['ask', true, 'read-only'], ['auto', true, 'read-only'], ['full', false, 'read-only'], ['full', true, 'workspace-write']
] as const)('Codex %s mode with course scope %s does not bypass the conversation approval gate', async (mode, course, sandbox) => {
  const f = fixture('codex', undefined, { accessPolicy: { mode, scope: { course, browser: false, screen: false } } })
  f.session.sendMessage('test'); await f.session.sessionId
  expect(f.messages.find(message => message.method === 'thread/start')?.params.sandbox).toBe(sandbox)
  f.session.dispose()
})

test('a provider rejection preserves the prompt error and leaves the initialized session usable', async () => {
  const f = fixture('codex'); f.deferred.add('turn/start'); f.session.sendMessage('test'); await f.session.sessionId; await flush()
  const request = f.messages.find(message => message.method === 'turn/start')
  f.send({ id: request.id, error: { code: -32602, message: 'selected model is not supported', data: { model: 'bad-model' } } }); await flush()
  expect(f.events).toContainEqual({ type: 'error', code: 'unknown', message: 'selected model is not supported', fatal: false })
  expect(f.session.closed).toBe(false)
  expect(() => f.session.sendMessage('retry')).not.toThrow()
  f.session.dispose()
})


test('Codex repeats one error in its final notification without rendering two failures', async () => {
  const f = fixture('codex'); f.session.sendMessage('first'); await f.session.sessionId; await flush()
  f.send({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: false, error: { message: 'same failure' } } })
  f.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'same failure' } } } })
  expect(f.events.filter(event => event.type === 'error')).toHaveLength(1)
  expect(f.events.filter(event => event.type === 'turn-complete')).toHaveLength(1)
  f.session.dispose()
})


test('Gemini canceled initialization does not consume the first prompt system context', async () => {
  const f = fixture('gemini', undefined, { systemPromptAppend: 'Bandal course instructions' })
  f.deferred.add('initialize'); f.session.sendMessage('canceled input'); await flush(); f.session.cancel()
  const initialize = f.messages.find(message => message.method === 'initialize')
  f.send({ id: initialize.id, result: { agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } } })
  await f.session.sessionId; await flush()
  expect(f.messages.some(message => message.method === 'session/prompt')).toBe(false)
  expect(f.events.filter(event => event.type === 'turn-complete')).toEqual([expect.objectContaining({ stopReason: 'interrupted' })])
  f.session.sendMessage('next input'); await flush()
  expect(f.messages.find(message => message.method === 'session/prompt')?.params.prompt[0]).toEqual({ type: 'text', text: 'Bandal course instructions\n\nnext input' })
  f.session.dispose()
})
