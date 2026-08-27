import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  invoke: vi.fn(),
  onPush: vi.fn()
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useCallback: <T,>(callback: T): T => callback,
    useEffect: (effect: () => void | (() => void)): void => {
      harness.effects.push(effect)
    },
    useRef: <T,>(initial: T): { current: T } => ({ current: initial }),
    useState: <T,>(initial: T): [T, ReturnType<typeof vi.fn>] => [
      initial,
      vi.fn()
    ]
  }
})

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: harness.invoke,
  onPush: harness.onPush
}))

import {
  requestMaterialConnectionsRefresh,
  useMaterialConnections
} from '../../../src/renderer/src/features/links/useMaterialConnections'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

beforeEach(() => {
  harness.effects.length = 0
  harness.invoke.mockReset()
  harness.invoke.mockImplementation((channel: string) => {
    if (channel === 'links:forMaterial') {
      return Promise.resolve({ notes: [], boards: [] })
    }
    if (channel === 'links:listFor') {
      return Promise.resolve({ outgoing: [], incoming: [] })
    }
    return Promise.resolve({ ok: true })
  })
  harness.onPush.mockReset()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget()
  })
})

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window
  } else {
    Object.defineProperty(globalThis, 'window', originalWindow)
  }
})

describe('useMaterialConnections refreshes', () => {
  test('reloads on matching material changes and explicit note-save refreshes', async () => {
    let materialChanged: ((payload: { courseId: string }) => void) | null = null
    harness.onPush.mockImplementation(
      (_channel: string, listener: (payload: { courseId: string }) => void) => {
        materialChanged = listener
        return vi.fn()
      }
    )

    useMaterialConnections('course-1', '강의.pdf')
    const cleanups = harness.effects.map((effect) => effect())
    await Promise.resolve()

    expect(harness.invoke).toHaveBeenCalledTimes(2)
    expect(materialChanged).not.toBeNull()

    const emitMaterialChanged = (courseId: string): void => {
      if (materialChanged === null) throw new Error('listener was not registered')
      materialChanged({ courseId })
    }

    emitMaterialChanged('course-2')
    expect(harness.invoke).toHaveBeenCalledTimes(2)

    emitMaterialChanged('course-1')
    expect(harness.invoke).toHaveBeenCalledTimes(4)

    requestMaterialConnectionsRefresh('course-1')
    expect(harness.invoke).toHaveBeenCalledTimes(6)

    for (const cleanup of cleanups) cleanup?.()
  })
})
