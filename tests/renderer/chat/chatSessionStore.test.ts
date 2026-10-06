import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { acquireChatSession, refreshChatSession, selectChatSession, setChatProvider, useChatSessionStore } from '../../../src/renderer/src/features/chat/chatSessionStore'
import { refreshAgentConnection, refreshAgentConnectionAfterMutation, resetAgentConnectionsForTests, seedAgentAvailability, startAgentLogin } from '../../../src/renderer/src/features/chat/agentConnectionStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

let release: (() => void) | undefined
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn()) })
afterEach(() => {
  release?.()
  release = undefined
  useChatSessionStore.setState({ sessions: {} })
  resetAgentConnectionsForTests()
  setIpcAdapter(null)
  vi.unstubAllGlobals()
})

test('settles buffered streaming events before inserting a generated file result', async () => {
  const handlers = new Map<string, (payload: unknown) => void>()
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  setIpcAdapter({
    invoke: async (channel: string) => channel === 'chat:open'
      ? { history: [], sessionInfo: null, availability: { installed: true, loggedIn: true } }
      : { models: [] },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(channel, handler)
      return () => handlers.delete(channel)
    }
  } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'artifact-conversation')
  await vi.waitFor(() => expect(selectChatSession('artifact-conversation').phase).toBe('ready'))

  handlers.get('chat:event-batch')!({
    courseId: 'course', sessionId: 'artifact-conversation', seq: 1,
    events: [
      { type: 'turn-started', turnSeq: 1 },
      { type: 'text-final', blockId: 'answer', text: '파일을 만들었어요.' },
      { type: 'turn-complete', stopReason: 'success' }
    ]
  })
  const result = {
    sessionId: 'artifact-conversation',
    message: {
      id: 'output', courseId: 'course', sessionId: 'artifact-conversation', role: 'assistant', turnSeq: 1,
      createdAt: '2026-09-17T00:00:00Z',
      blocks: [{ id: 'file', messageId: 'output', ord: 0, kind: 'artifact', payload: { courseId: 'course', relPath: '생성 결과/summary.pdf', name: 'summary.pdf', kind: 'pdf' } }]
    }
  }
  handlers.get('chat:message')!(result)
  handlers.get('chat:message')!(result)
  const state = selectChatSession('artifact-conversation').state
  expect(state.streaming).toBe(false)
  expect(state.messages).toHaveLength(2)
  expect(state.messages[0]).toMatchObject({ streaming: false, blocks: [{ text: '파일을 만들었어요.' }] })
  expect(state.messages[1]?.blocks[0]?.kind).toBe('artifact')
})

test('opening a streaming conversation discards covered frames and appends new deltas once', async () => {
  const handlers = new Map<string, (payload: unknown) => void>()
  let resolveOpen!: (value: any) => void
  const open = new Promise(resolve => { resolveOpen = resolve })
  const frames: (() => void)[] = []
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { frames.push(fn); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  setIpcAdapter({ invoke: async (channel: string) => channel === 'chat:open' ? open : { models: [] }, on: (channel: string, handler: (payload: unknown) => void) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'transfer')
  const push = (seq: number, text: string): void => handlers.get('chat:event-batch')!({ sessionId: 'transfer', seq, events: [{ type: 'text-delta', blockId: 'answer', text }] })
  push(6, 'already included')
  push(7, ' world')
  resolveOpen({ eventSeq: 6, history: [{ id: 'live-transfer:1', courseId: 'course', sessionId: 'transfer', role: 'assistant', turnSeq: 1, createdAt: '', blocks: [{ id: 'answer', kind: 'text', ord: 0, messageId: 'live-transfer:1', payload: { text: 'Hello' } }] }], sessionInfo: { status: 'running' }, availability: { installed: true, loggedIn: true } })
  await vi.waitFor(() => expect(selectChatSession('transfer').phase).toBe('ready'))
  frames.splice(0).forEach(fn => fn())
  expect(selectChatSession('transfer').state.messages).toMatchObject([{ streaming: true, blocks: [{ id: 'answer', text: 'Hello world' }] }])
})

test('canonical user messages replace optimistic copies and synchronize other windows', async () => {
  const handlers = new Map<string, (payload: any) => void>()
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  setIpcAdapter({ invoke: async (channel: string) => channel === 'chat:open' ? { history: [], sessionInfo: null, availability: { installed: true, loggedIn: true } } : {}, on: (channel: string, handler: (payload: any) => void) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'user-sync')
  await vi.waitFor(() => expect(selectChatSession('user-sync').phase).toBe('ready'))
  const { sendChatMessage } = await import('../../../src/renderer/src/features/chat/chatSessionStore')
  await sendChatMessage('course', 'user-sync', 'Question')
  const payload = { sessionId: 'user-sync', message: { id: 'canonical', courseId: 'course', sessionId: 'user-sync', role: 'user', turnSeq: 1, createdAt: '', blocks: [{ id: 'text', ord: 0, kind: 'text', messageId: 'canonical', payload: { text: 'Question' } }] } }
  handlers.get('chat:message')!(payload); handlers.get('chat:message')!(payload)
  expect(selectChatSession('user-sync').state.messages).toMatchObject([{ id: 'canonical', role: 'user' }])
})

function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

test('retains desktop surface during refresh and provisional provider change', async () => {
  let provider = 'codex'
  const invoke = vi.fn(async (channel: string, req: any) => {
    if (channel === 'chat:setProvider') { provider = req.provider; return {} }
    if (channel === 'chat:open') return { history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { provider, surface: req.surface } }
    return { models: [] }
  })
  setIpcAdapter({ invoke, on: () => () => undefined } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'surface-retained', 'desktop')
  await vi.waitFor(() => expect(selectChatSession('surface-retained').phase).toBe('ready'))
  refreshChatSession('course', 'surface-retained'); await flush()
  await setChatProvider('course', 'surface-retained', 'gemini')
  expect(invoke.mock.calls.filter(([channel]) => channel === 'chat:open').every(([, req]) => req.surface === 'desktop')).toBe(true)
  expect(invoke).toHaveBeenCalledWith('chat:setProvider', { courseId: 'course', sessionId: 'surface-retained', provider: 'gemini', surface: 'desktop' })
})

test('A to B to A model loading does not apply an old A result over the latest catalog', async () => {
  let provider = 'codex', codexRequests = 0
  const old = deferred<any>(), latest = deferred<any>()
  const invoke = vi.fn(async (channel: string, req: any) => {
    if (channel === 'chat:setProvider') { provider = req.provider; return {} }
    if (channel === 'chat:open') return { history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { provider } }
    if (channel === 'agent:models' && req.provider === 'codex') return ++codexRequests === 1 ? old.promise : latest.promise
    return { models: [{ id: 'gemini', displayName: 'Gemini' }] }
  })
  setIpcAdapter({ invoke, on: () => () => undefined } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'model-generation')
  await vi.waitFor(() => expect(selectChatSession('model-generation').phase).toBe('ready'))
  await setChatProvider('course', 'model-generation', 'gemini')
  await setChatProvider('course', 'model-generation', 'codex')
  latest.resolve({ models: [{ id: 'new', displayName: 'New' }] }); await flush()
  old.resolve({ models: [{ id: 'old', displayName: 'Old' }] }); await flush()
  expect(selectChatSession('model-generation').models).toEqual([{ id: 'new', displayName: 'New' }])
})

test('an older settings save cannot send a provider switch after a newer A to B to A choice', async () => {
  let provider = 'codex'
  const old = deferred<any>(), latest = deferred<any>()
  const invoke = vi.fn(async (channel: string, req: any) => {
    if (channel === 'settings:set') return req.agentProvider === 'gemini' ? old.promise : latest.promise
    if (channel === 'chat:setProvider') { provider = req.provider; return {} }
    if (channel === 'chat:open') return { history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { provider } }
    return { models: [] }
  })
  setIpcAdapter({ invoke, on: () => () => undefined } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'provider-generation')
  await vi.waitFor(() => expect(selectChatSession('provider-generation').phase).toBe('ready'))
  const first = setChatProvider('course', 'provider-generation', 'gemini')
  const second = setChatProvider('course', 'provider-generation', 'codex')
  latest.resolve({}); await second
  old.resolve({}); await first
  expect(selectChatSession('provider-generation').provider).toBe('codex')
  expect(invoke.mock.calls.filter(([channel]) => channel === 'chat:setProvider')).toEqual([['chat:setProvider', { courseId: 'course', sessionId: 'provider-generation', provider: 'codex', surface: 'app' }]])
})

test('actual login readiness updates an acquired chat and loads a fresh catalog once', async () => {
  let loggedIn = false
  const invoke = vi.fn(async (channel: string) => {
    const availability = { installed: true, loggedIn }
    if (channel === 'chat:open') return { history: [], availability, sessionInfo: { provider: 'codex' } }
    if (channel === 'agent:login') return { ok: true, message: 'opened' }
    if (channel === 'agent:availability') return availability
    return { models: [{ id: loggedIn ? 'account-model' : 'fallback', displayName: 'Fixture' }] }
  })
  setIpcAdapter({ invoke, on: () => () => undefined } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'login-catalog')
  await vi.waitFor(() => expect(selectChatSession('login-catalog').phase).toBe('ready'))
  await startAgentLogin('codex')
  expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:models')).toHaveLength(0)
  loggedIn = true
  await refreshAgentConnection('codex', true); await flush()
  expect(selectChatSession('login-catalog').availability?.loggedIn).toBe(true)
  expect(selectChatSession('login-catalog').models[0]?.id).toBe('account-model')
  expect(invoke).toHaveBeenCalledWith('agent:models', { provider: 'codex', refresh: true })
  const count = invoke.mock.calls.filter(([channel]) => channel === 'agent:models').length
  await refreshAgentConnection('codex', true); await flush()
  expect(invoke.mock.calls.filter(([channel]) => channel === 'agent:models')).toHaveLength(count)
})

test('credential removal updates a streaming chat without clearing its response and invalidates pending models', async () => {
  const oldModels = deferred<any>(), handlers = new Map<string, (payload: any) => void>()
  setIpcAdapter({ invoke: async (channel: string) => channel === 'chat:open' ? { history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { provider: 'codex', status: 'running' } } : channel === 'agent:models' ? oldModels.promise : { installed: true, loggedIn: false }, on: (channel: string, handler: (payload: any) => void) => { handlers.set(channel, handler); return () => handlers.delete(channel) } } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'credential-streaming')
  await vi.waitFor(() => expect(selectChatSession('credential-streaming').phase).toBe('ready'))
  handlers.get('chat:message')!({ sessionId: 'credential-streaming', message: { id: 'answer', courseId: 'course', sessionId: 'credential-streaming', role: 'assistant', createdAt: '', blocks: [{ id: 'text', ord: 0, kind: 'text', messageId: 'answer', payload: { text: '응답을 이어 쓰는 중' } }] } })
  await refreshAgentConnectionAfterMutation('codex')
  oldModels.resolve({ models: [{ id: 'old-account', displayName: 'Old' }] }); await flush()
  expect(selectChatSession('credential-streaming').availability?.loggedIn).toBe(false)
  expect(selectChatSession('credential-streaming').state.streaming).toBe(true)
  expect(selectChatSession('credential-streaming').state.messages).toHaveLength(1)
  expect(selectChatSession('credential-streaming').models).toEqual([])
})

test('a late open result cannot restore readiness after an authoritative credential refresh', async () => {
  const open = deferred<any>()
  setIpcAdapter({ invoke: async (channel: string) => channel === 'chat:open' ? open.promise : channel === 'agent:availability' ? { installed: true, loggedIn: false } : { models: [] }, on: () => () => undefined } as unknown as IpcAdapter)
  release = acquireChatSession('course', 'stale-readiness-open')
  await refreshAgentConnectionAfterMutation('codex')
  open.resolve({ history: [], availability: { installed: true, loggedIn: true }, sessionInfo: { provider: 'codex' } })
  await vi.waitFor(() => expect(selectChatSession('stale-readiness-open').phase).toBe('ready'))
  seedAgentAvailability('codex', { installed: true, loggedIn: true })
  expect(selectChatSession('stale-readiness-open').availability?.loggedIn).toBe(false)
})
