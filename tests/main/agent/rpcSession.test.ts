import { describe, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { createRpcSession } from '../../../src/main/features/agent/rpcSession'
import type { AgentEvent, AgentStartSessionOptions } from '../../../src/shared/types/agent-events'
function fixture(provider: 'codex' | 'gemini', resume?: string, overrides: Partial<AgentStartSessionOptions> = {}) {
  const child = new EventEmitter() as ChildProcess
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
  const messages: any[] = [], events: AgentEvent[] = []
  const send = (message: any): void => { child.stdout!.emit('data', Buffer.from(JSON.stringify(message) + '\n')) }
  child.stdin.on('data', chunk => {
    const msg = JSON.parse(String(chunk)); messages.push(msg)
    if (!msg.method || msg.id === undefined) return
    let result: any = {}
    if (msg.method === 'initialize') result = { agentCapabilities: { loadSession: true, promptCapabilities: { image: true } } }
    if (msg.method === 'thread/start' || msg.method === 'thread/resume') result = { thread: { id: resume ?? 'thread-1' } }
    if (msg.method === 'turn/start') result = { turn: { id: 'turn-1' } }
    if (msg.method === 'session/new') result = { sessionId: 'gemini-1' }
    if (msg.method === 'session/prompt') return
    queueMicrotask(() => send({ id: msg.id, result }))
  })
  const session = createRpcSession({ courseId: 'course', cwd: '/tmp/course', ...(resume ? { resumeCliSessionId: resume } : {}), ...overrides }, provider, () => child)
  session.on(event => events.push(event))
  return { session, child, send, messages, events }
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
