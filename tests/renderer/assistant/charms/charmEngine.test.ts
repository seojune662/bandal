import { describe, expect, test } from 'vitest'
import {
  CharmEngine,
  type CharmSink
} from '../../../../src/renderer/src/features/assistant/charms/charmEngine'
import type { RopeConfig } from '../../../../src/renderer/src/features/assistant/charms/physics/rope'

const CONFIG: RopeConfig = {
  segments: 6,
  segmentLength: 10,
  gravity: 1400,
  drag: 1.5,
  iterations: 6,
  tipMass: 2
}

function harness(initialPivot = { x: 100, y: 100 }) {
  let pivot: { x: number; y: number } | null = initialPivot
  const frames: number[] = []
  let pending: ((t: number) => void) | null = null
  let handles = 0
  const sink: CharmSink = {
    readPivot: () => pivot,
    writeFrame: (_state, _pose, dt) => {
      frames.push(dt)
    }
  }
  const engine = new CharmEngine({ rope: CONFIG, anchor: 'below' }, sink, {
    now: () => 0,
    raf: (cb) => {
      pending = cb
      handles += 1
      return handles
    },
    caf: () => {
      pending = null
    }
  })
  const tick = (time: number): boolean => {
    const cb = pending
    pending = null
    if (cb === null) return false
    cb(time)
    return true
  }
  return {
    engine,
    frames,
    tick,
    movePivot: (next: { x: number; y: number } | null) => {
      pivot = next
    },
    get scheduled() {
      return pending !== null
    }
  }
}

describe('CharmEngine', () => {
  test('a 33 ms frame integrates three whole 1/120 s steps and carries the rest', () => {
    const h = harness()
    h.engine.wake()
    h.tick(0) // wake frame: one primed step
    h.frames.length = 0
    h.tick(33)
    expect(h.frames).toHaveLength(1)
    expect(h.frames[0]).toBeCloseTo(3 / 120, 5)
    h.tick(66)
    expect(h.frames[1]).toBeCloseTo(4 / 120, 5)
  })

  test('a 2 s gap is clamped to the maximum frame', () => {
    const h = harness()
    h.engine.wake()
    h.tick(0)
    h.frames.length = 0
    h.tick(2000)
    expect(h.frames[0]).toBeLessThanOrEqual(0.1 + 1e-9)
  })

  test('sleeps once the rope is at rest and wakes on demand', () => {
    const h = harness()
    h.engine.wake()
    let t = 0
    let ticks = 0
    while (h.tick(t) && ticks < 2000) {
      t += 16
      ticks += 1
    }
    expect(ticks).toBeLessThan(2000)
    expect(h.engine.sleeping).toBe(true)
    expect(h.scheduled).toBe(false)

    h.movePivot({ x: 300, y: 100 })
    h.engine.wake()
    expect(h.scheduled).toBe(true)
    h.engine.wake() // idempotent
    expect(h.scheduled).toBe(true)
  })

  test('reduced motion never schedules a frame and draws once per wake', () => {
    const h = harness()
    h.engine.setReducedMotion(true)
    expect(h.frames).toHaveLength(1)
    expect(h.scheduled).toBe(false)
    h.movePivot({ x: 200, y: 50 })
    h.engine.wake()
    expect(h.frames).toHaveLength(2)
    expect(h.scheduled).toBe(false)
  })

  test('pauses when the orb is not mounted', () => {
    const h = harness()
    h.engine.wake()
    h.movePivot(null)
    h.tick(0)
    expect(h.scheduled).toBe(false)
    expect(h.engine.sleeping).toBe(true)
  })

  test('dispose stops everything', () => {
    const h = harness()
    h.engine.wake()
    h.engine.dispose()
    expect(h.scheduled).toBe(false)
    h.engine.wake()
    expect(h.scheduled).toBe(false)
  })
})
