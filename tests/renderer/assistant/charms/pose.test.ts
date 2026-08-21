import { describe, expect, test } from 'vitest'
import {
  createRope,
  type RopeConfig
} from '../../../../src/renderer/src/features/assistant/charms/physics/rope'
import {
  computePose,
  lagAngle
} from '../../../../src/renderer/src/features/assistant/charms/physics/pose'

const CONFIG: RopeConfig = {
  segments: 2,
  segmentLength: 10,
  gravity: 1000,
  drag: 1,
  iterations: 2,
  tipMass: 1
}

describe('computePose', () => {
  test('hanging straight below → angle 0; tip swung right → positive angle', () => {
    const rope = createRope(CONFIG, { x: 0, y: 0 })
    expect(computePose(rope, null, 1 / 120, 'below').angle).toBeCloseTo(0)
    rope.x[2] = 7
    rope.y[2] = 17
    expect(computePose(rope, null, 1 / 120, 'below').angle).toBeGreaterThan(0)
  })

  test('balloon above: straight up → 0; swung right → positive', () => {
    const up = { ...CONFIG, gravity: -1000 }
    const rope = createRope(up, { x: 0, y: 0 })
    expect(computePose(rope, null, 1 / 120, 'above').angle).toBeCloseTo(0)
    rope.x[2] = 7
    rope.y[2] = -17
    expect(computePose(rope, null, 1 / 120, 'above').angle).toBeGreaterThan(0)
  })

  test('angular velocity follows the change in angle', () => {
    const rope = createRope(CONFIG, { x: 0, y: 0 })
    const first = computePose(rope, null, 1 / 120, 'below')
    rope.x[2] = 5
    const second = computePose(rope, first, 1 / 120, 'below')
    expect(second.angularVelocity).toBeGreaterThan(0)
  })
})

describe('lagAngle', () => {
  test('converges monotonically towards the target', () => {
    let current = 0
    let prev = 0
    for (let i = 0; i < 60; i += 1) {
      current = lagAngle(1, current, 1 / 60, 8, 2)
      expect(current).toBeGreaterThanOrEqual(prev)
      prev = current
    }
    expect(current).toBeCloseTo(1, 1)
  })

  test('never exceeds the limit', () => {
    let current = 0
    for (let i = 0; i < 200; i += 1) current = lagAngle(10, current, 1 / 60, 20, 0.5)
    expect(current).toBeLessThanOrEqual(0.5 + 1e-9)
  })
})
