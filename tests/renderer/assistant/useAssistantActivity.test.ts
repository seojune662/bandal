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
import { useAssistantActivity } from '../../../src/renderer/src/features/assistant/useAssistantActivity'
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
      expect(activity).toMatchObject({ busy: false, alert: false })

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
})
