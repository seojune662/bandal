import * as React from 'react'
import type {
  DependencyList,
  Dispatch,
  EffectCallback,
  MutableRefObject,
  SetStateAction
} from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ChatEventBatch } from '../../../src/shared/ipc/events'
import type { AgentConfirmRequest } from '../../../src/shared/types/agentTools'
import { useAssistantActivity } from '../../../src/renderer/src/features/assistant/useAssistantActivity'
import { useAgentToolActivityStore } from '../../../src/renderer/src/features/chat/agentToolActivityStore'
import { initialChatViewState } from '../../../src/renderer/src/features/chat/chatModel'
import { useChatSessionStore } from '../../../src/renderer/src/features/chat/chatSessionStore'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

interface HookSlot {
  initialized?: boolean
  value?: unknown
  ref?: MutableRefObject<unknown>
  deps?: DependencyList
  cleanup?: void | (() => void)
  callback?: unknown
}

interface ReactInternals {
  ReactCurrentDispatcher: { current: unknown }
}

const internals = (
  React as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: ReactInternals
  }
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

function sameDependencies(
  previous: DependencyList | undefined,
  next: DependencyList | undefined
): boolean {
  return (
    previous !== undefined &&
    next !== undefined &&
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]))
  )
}

function createActivityHarness(): {
  render: (popupOpen?: boolean) => ReturnType<typeof useAssistantActivity>
  unmount: () => void
} {
  const slots: HookSlot[] = []
  let cursor = 0
  let pendingEffects: Array<() => void> = []

  const nextSlot = (): HookSlot => {
    const index = cursor
    cursor += 1
    slots[index] ??= {}
    return slots[index]!
  }

  const dispatcher = {
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const slot = nextSlot()
      if (slot.initialized !== true) {
        slot.initialized = true
        slot.value =
          typeof initialState === 'function'
            ? (initialState as () => S)()
            : initialState
      }
      const setState: Dispatch<SetStateAction<S>> = (next) => {
        const current = slot.value as S
        slot.value =
          typeof next === 'function'
            ? (next as (value: S) => S)(current)
            : next
      }
      return [slot.value as S, setState]
    },
    useRef<T>(initialValue: T): MutableRefObject<T> {
      const slot = nextSlot()
      slot.ref ??= { current: initialValue }
      return slot.ref as MutableRefObject<T>
    },
    useEffect(effect: EffectCallback, deps?: DependencyList): void {
      const slot = nextSlot()
      if (sameDependencies(slot.deps, deps)) return
      slot.deps = deps
      pendingEffects.push(() => {
        slot.cleanup?.()
        slot.cleanup = effect()
      })
    },
    useCallback<T>(callback: T, deps: DependencyList): T {
      const slot = nextSlot()
      if (!sameDependencies(slot.deps, deps)) {
        slot.deps = deps
        slot.callback = callback
      }
      return slot.callback as T
    }
  }

  return {
    render: (popupOpen = false) => {
      cursor = 0
      pendingEffects = []
      const previousDispatcher = internals.ReactCurrentDispatcher.current
      internals.ReactCurrentDispatcher.current = dispatcher
      let result: ReturnType<typeof useAssistantActivity>
      try {
        result = useAssistantActivity({ courseId: 'course-1', popupOpen })
      } finally {
        internals.ReactCurrentDispatcher.current = previousDispatcher
      }
      for (const runEffect of pendingEffects) runEffect()
      return result
    },
    unmount: () => {
      for (const slot of slots) slot.cleanup?.()
    }
  }
}

afterEach(() => {
  useAgentToolActivityStore.setState({ conversations: {} })
  useChatSessionStore.setState({ sessions: {} })
  setIpcAdapter(null)
})

describe('useAssistantActivity', () => {
  test('tracks chat activity and closed-popup alerts without an observed root', () => {
    let push: ((batch: ChatEventBatch) => void) | null = null
    setIpcAdapter({
      invoke: vi.fn(),
      on: vi.fn((channel, handler) => {
        if (channel === 'chat:event-batch') {
          push = handler as (batch: ChatEventBatch) => void
        }
        return () => {
          push = null
        }
      })
    } as unknown as IpcAdapter)

    const harness = createActivityHarness()
    try {
      let activity = harness.render()
      expect(activity).toMatchObject({
        busy: false,
        alert: false,
        needsApproval: false
      })

      push?.({
        courseId: 'course-1',
        sessionId: 'conversation-1',
        seq: 1,
        events: [{ type: 'text-delta', blockId: 'text-1', text: '답변' }]
      })
      activity = harness.render()
      expect(activity).toMatchObject({ busy: true, alert: false })

      push?.({
        courseId: 'course-1',
        sessionId: 'conversation-1',
        seq: 2,
        events: [{ type: 'turn-complete', stopReason: 'success' }]
      })
      activity = harness.render()
      expect(activity).toMatchObject({ busy: false, alert: true })

      activity.clearAlert()
      activity = harness.render()
      expect(activity.alert).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('keeps a v1 permission visible while the popup opens and clears it when the turn resolves', () => {
    let push: ((batch: ChatEventBatch) => void) | null = null
    setIpcAdapter({
      invoke: vi.fn(),
      on: vi.fn((channel, handler) => {
        if (channel === 'chat:event-batch') {
          push = handler as (batch: ChatEventBatch) => void
        }
        return () => {
          push = null
        }
      })
    } as unknown as IpcAdapter)

    const harness = createActivityHarness()
    try {
      let activity = harness.render()
      push?.({
        courseId: 'course-1',
        sessionId: 'conversation-1',
        seq: 1,
        events: [
          {
            type: 'permission-request',
            requestId: 'permission-1',
            toolName: 'write_file',
            input: { path: 'notes.md' }
          }
        ]
      })

      activity = harness.render(true)
      expect(activity.needsApproval).toBe(true)

      const session = {
        phase: 'ready' as const,
        provider: 'claude-code' as const,
        availability: null,
        openError: null,
        models: [],
        title: null,
        state: {
          ...initialChatViewState,
          pendingPermissionId: 'permission-1'
        }
      }
      useChatSessionStore.setState({
        sessions: { 'conversation-1': session }
      })
      useChatSessionStore.setState({
        sessions: {
          'conversation-1': {
            ...session,
            state: { ...session.state, pendingPermissionId: null }
          }
        }
      })
      activity = harness.render(true)
      expect(activity.needsApproval).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('tracks v2 confirmations from the activity store until their response resolves', () => {
    let pushConfirm: ((request: AgentConfirmRequest) => void) | null = null
    setIpcAdapter({
      invoke: vi.fn(),
      on: vi.fn((channel, handler) => {
        if (channel === 'agentTools:confirm') {
          pushConfirm = handler as (request: AgentConfirmRequest) => void
        }
        return () => {
          pushConfirm = null
        }
      })
    } as unknown as IpcAdapter)

    const harness = createActivityHarness()
    try {
      harness.render()
      pushConfirm?.({
        requestId: 'confirm-1',
        courseId: 'course-1',
        conversationId: 'conversation-1',
        tool: 'delete_course',
        summary: '과목을 삭제할까요?',
        details: []
      })

      let activity = harness.render(true)
      expect(activity.needsApproval).toBe(true)

      useAgentToolActivityStore.setState((store) => ({
        conversations: {
          ...store.conversations,
          'conversation-1': {
            items: [
              {
                kind: 'confirmation',
                request: {
                  requestId: 'confirm-1',
                  courseId: 'course-1',
                  conversationId: 'conversation-1',
                  tool: 'delete_course',
                  summary: '과목을 삭제할까요?',
                  details: []
                },
                response: false,
                isResponding: false,
                hasResponseError: false
              }
            ]
          }
        }
      }))

      activity = harness.render(true)
      expect(activity.needsApproval).toBe(false)
    } finally {
      harness.unmount()
    }
  })
})
