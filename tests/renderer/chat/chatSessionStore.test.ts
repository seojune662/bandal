import { afterEach, expect, test, vi } from 'vitest'
import { acquireChatSession, selectChatSession, useChatSessionStore } from '../../../src/renderer/src/features/chat/chatSessionStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

let release: (() => void) | undefined
afterEach(() => {
  release?.()
  release = undefined
  useChatSessionStore.setState({ sessions: {} })
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
