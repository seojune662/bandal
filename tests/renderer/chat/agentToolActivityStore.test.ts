import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentAction } from '../../../src/shared/types/agentTools'
import {
  acquireAgentToolActivity,
  respondToAgentConfirm,
  undoAgentTurn,
  useAgentToolActivityStore
} from '../../../src/renderer/src/features/chat/agentToolActivityStore'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

type PushHandler = (payload: never) => void

const releases: Array<() => void> = []

afterEach(() => {
  for (const release of releases.splice(0)) {
    release()
  }
  useAgentToolActivityStore.setState({ conversations: {} })
  setIpcAdapter(null)
})

function installAdapter(
  invoke: (channel: string, request: unknown) => Promise<unknown>
): Map<string, PushHandler> {
  const handlers = new Map<string, PushHandler>()
  setIpcAdapter({
    invoke: vi.fn(invoke),
    on: vi.fn((channel: string, handler: PushHandler) => {
      handlers.set(channel, handler)
      return () => handlers.delete(channel)
    })
  } as unknown as IpcAdapter)
  return handlers
}

describe('assistant tool activity store wiring', () => {
  test('keeps a destructive confirmation after sending the response', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const handlers = installAdapter(invoke)
    releases.push(acquireAgentToolActivity('chat-1'))

    handlers.get('agentTools:confirm')?.({
      requestId: 'confirm-1',
      courseId: 'course-1',
      conversationId: 'chat-1',
      tool: 'delete_course',
      summary: '과목을 삭제할까요?',
      details: ['강의자료도 함께 사라져요.']
    } as never)
    respondToAgentConfirm('chat-1', 'confirm-1', false)

    await vi.waitFor(() => {
      const item = useAgentToolActivityStore.getState().conversations['chat-1']
        ?.items[0]
      expect(item?.kind).toBe('confirmation')
      expect(item?.kind === 'confirmation' ? item.response : null).toBe(false)
    })
    expect(invoke).toHaveBeenCalledWith('agentTools:respondConfirm', {
      requestId: 'confirm-1',
      approved: false
    })
  })

  test('loads changed actions and sends at most one effective undo', async () => {
    let wasUndone = false
    let undoCalls = 0
    const savedAction: AgentAction = {
      id: 'action-1',
      courseId: 'course-1',
      turnId: 'turn-1',
      tool: 'create_course',
      targetKind: 'course',
      targetId: 'created-course',
      label: '과목 «고체역학»',
      undoable: true,
      undoneAt: null,
      createdAt: '2026-08-11T00:00:00.000Z'
    }
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'agentTools:changes') {
        return {
          turnId: 'turn-1',
          actions: [
            {
              ...savedAction,
              undoneAt: wasUndone ? '2026-08-11T01:00:00.000Z' : null
            }
          ]
        }
      }
      if (channel === 'agentTools:undo') {
        undoCalls += 1
        wasUndone = true
        return { undone: 1 }
      }
      return { ok: true }
    })
    const handlers = installAdapter(invoke)
    releases.push(acquireAgentToolActivity('chat-1'))

    handlers.get('agentTools:changed')?.({
      courseId: 'course-1',
      conversationId: 'chat-1',
      turnId: 'turn-1'
    } as never)
    await vi.waitFor(() => {
      const item = useAgentToolActivityStore.getState().conversations['chat-1']
        ?.items[0]
      expect(item?.kind === 'changes' ? item.actions : []).toHaveLength(1)
    })

    undoAgentTurn('chat-1', 'turn-1')
    undoAgentTurn('chat-1', 'turn-1')

    await vi.waitFor(() => {
      const item = useAgentToolActivityStore.getState().conversations['chat-1']
        ?.items[0]
      expect(item?.kind === 'changes' ? item.undoState : 'idle').toBe(
        'complete'
      )
      expect(
        item?.kind === 'changes' ? item.actions[0]?.undoneAt : null
      ).not.toBeNull()
    })
    undoAgentTurn('chat-1', 'turn-1')

    expect(undoCalls).toBe(1)
  })
})

describe('conversation isolation', () => {
  test('a confirmation lands only in the conversation that asked', async () => {
    // The reported bug: approval cards appeared in EVERY past conversation of
    // the same course. `AgentConfirmRequest` carried only `courseId`, so the
    // store had nothing else to key on and one card rendered in every
    // ChatSurface mounted for that course.
    const invoke = vi.fn(async () => ({ ok: true }))
    const handlers = installAdapter(invoke)
    releases.push(acquireAgentToolActivity('chat-1'))

    handlers.get('agentTools:confirm')?.({
      requestId: 'confirm-9',
      courseId: 'course-1',
      conversationId: 'chat-2',
      tool: 'browser_access',
      summary: 'my.snu.ac.kr 을 읽고 다룰까요?',
      details: []
    } as never)

    await vi.waitFor(() => {
      expect(
        useAgentToolActivityStore.getState().conversations['chat-1']
      ).toBeUndefined()
    })
  })

  test('two conversations of one course keep separate cards', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const handlers = installAdapter(invoke)
    releases.push(acquireAgentToolActivity('chat-1'))

    handlers.get('agentTools:confirm')?.({
      requestId: 'confirm-a',
      courseId: 'course-1',
      conversationId: 'chat-1',
      tool: 'browser_access',
      summary: '읽고 다룰까요?',
      details: []
    } as never)

    await vi.waitFor(() => {
      expect(
        useAgentToolActivityStore.getState().conversations['chat-1']?.items
      ).toHaveLength(1)
    })
    expect(
      useAgentToolActivityStore.getState().conversations['chat-2']
    ).toBeUndefined()
  })
})
