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
