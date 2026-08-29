import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginMaterialFileDrag,
  clearMaterialFileDrag,
  getMaterialFileDrag,
  subscribeMaterialFileDrag
} from '../../../src/renderer/src/features/materials/materialFileDrag'

const STATE = { courseId: 'c1', relPath: 'a.pdf', kind: 'pdf' as const }

// node 환경이므로 window 를 EventTarget + setTimeout 으로 스텁한다
// (useMaterialConnections.test.ts 와 같은 방식).
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

function makeWindowStub(): EventTarget & { setTimeout: typeof setTimeout } {
  const target = new EventTarget() as EventTarget & {
    setTimeout: typeof setTimeout
  }
  target.setTimeout = ((handler: () => void, delay?: number) =>
    setTimeout(handler, delay)) as typeof setTimeout
  return target
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: makeWindowStub()
  })
})

afterEach(() => {
  clearMaterialFileDrag()
  vi.useRealTimers()
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window
  } else {
    Object.defineProperty(globalThis, 'window', originalWindow)
  }
})

describe('materialFileDrag', () => {
  test('begin exposes the state and notifies subscribers', () => {
    const listener = vi.fn()
    const stop = subscribeMaterialFileDrag(listener)

    beginMaterialFileDrag(STATE)
    expect(getMaterialFileDrag()).toEqual(STATE)
    expect(listener).toHaveBeenCalledTimes(1)

    clearMaterialFileDrag()
    expect(getMaterialFileDrag()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
  })

  test('clear is idempotent and silent when nothing is dragging', () => {
    const listener = vi.fn()
    const stop = subscribeMaterialFileDrag(listener)
    clearMaterialFileDrag()
    expect(listener).not.toHaveBeenCalled()
    stop()
  })

  test('a window mouseup clears a stale drag', () => {
    beginMaterialFileDrag(STATE)
    window.dispatchEvent(new Event('mouseup'))
    expect(getMaterialFileDrag()).toBeNull()
  })

  test('a window blur clears a stale drag', () => {
    beginMaterialFileDrag(STATE)
    window.dispatchEvent(new Event('blur'))
    expect(getMaterialFileDrag()).toBeNull()
  })

  test('window drop clears only after the same-cycle handlers ran', () => {
    vi.useFakeTimers()
    beginMaterialFileDrag(STATE)
    window.dispatchEvent(new Event('drop'))
    // 버블 drop 직후에는 아직 상태가 남아 드롭존 핸들러가 읽을 수 있다.
    expect(getMaterialFileDrag()).toEqual(STATE)
    vi.runAllTimers()
    expect(getMaterialFileDrag()).toBeNull()
  })

  test('unsubscribed listeners stop receiving updates', () => {
    const listener = vi.fn()
    const stop = subscribeMaterialFileDrag(listener)
    stop()
    beginMaterialFileDrag(STATE)
    expect(listener).not.toHaveBeenCalled()
  })
})
