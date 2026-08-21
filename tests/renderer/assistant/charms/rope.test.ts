import { describe, expect, test } from 'vitest'
import {
  createRope,
  isRopeAtRest,
  ropeKineticEnergy,
  ropeLengthError,
  ropeTip,
  stepRope,
  type RopeConfig
} from '../../../../src/renderer/src/features/assistant/charms/physics/rope'

const DT = 1 / 120
const BASE: RopeConfig = {
  segments: 8,
  segmentLength: 10,
  gravity: 1400,
  drag: 1.2,
  iterations: 8,
  tipMass: 2
}
const PIVOT = { x: 100, y: 50 }

function horizontalStart(config: RopeConfig) {
  const rope = createRope(config, PIVOT)
  for (let i = 0; i < rope.x.length; i += 1) {
    rope.x[i] = PIVOT.x + i * config.segmentLength
    rope.y[i] = PIVOT.y
    rope.px[i] = rope.x[i]
    rope.py[i] = rope.y[i]
  }
  return rope
}

function run(rope: ReturnType<typeof createRope>, config: RopeConfig, steps: number, pivot = PIVOT) {
  for (let i = 0; i < steps; i += 1) stepRope(rope, config, DT, pivot)
}

describe('stepRope', () => {
  test('settles straight down under gravity and reports rest', () => {
    const rope = horizontalStart(BASE)
    run(rope, BASE, 120 * 12)
    const tip = ropeTip(rope)
    expect(tip.x).toBeCloseTo(PIVOT.x, 0)
    expect(tip.y).toBeCloseTo(PIVOT.y + BASE.segments * BASE.segmentLength, 0)
    expect(isRopeAtRest(rope, 0.02)).toBe(true)
  })

  test('keeps every link at rest length (rigid)', () => {
    const rope = horizontalStart(BASE)
    for (let i = 0; i < 240; i += 1) {
      stepRope(rope, BASE, DT, PIVOT)
      expect(ropeLengthError(rope, BASE)).toBeLessThan(0.6)
    }
    run(rope, BASE, 600)
    // Sub-pixel Gauss-Seidel residual from the per-step gravity fall is expected.
    expect(ropeLengthError(rope, BASE)).toBeLessThan(0.02 * BASE.segmentLength)
  })

  test('elastic rope stays within the stretch band', () => {
    const config = { ...BASE, stretch: 0.4 }
    const rope = horizontalStart(config)
    run(rope, config, 120 * 12)
    expect(ropeLengthError(rope, config)).toBeLessThanOrEqual(
      config.stretch * config.segmentLength + 0.02 * config.segmentLength
    )
  })

  test('drag makes swing energy decay; zero drag nearly conserves it', () => {
    const damped = horizontalStart(BASE)
    const peaks: number[] = []
    let lastEnergy = Infinity
    for (let i = 0; i < 120 * 4; i += 1) {
      stepRope(damped, BASE, DT, PIVOT)
      const e = ropeKineticEnergy(damped, BASE, DT)
      if (i % 60 === 59) {
        peaks.push(e)
      }
      lastEnergy = e
    }
    expect(lastEnergy).toBeLessThan(peaks[0])
    expect(peaks[peaks.length - 1]).toBeLessThan(peaks[0] * 0.5)

    const free = { ...BASE, drag: 0 }
    const rope = horizontalStart(free)
    let maxEnergyFirst = 0
    let maxEnergyLast = 0
    for (let i = 0; i < 240; i += 1) {
      stepRope(rope, free, DT, PIVOT)
      const e = ropeKineticEnergy(rope, free, DT)
      if (i < 120) maxEnergyFirst = Math.max(maxEnergyFirst, e)
      else maxEnergyLast = Math.max(maxEnergyLast, e)
    }
    expect(maxEnergyLast).toBeGreaterThan(maxEnergyFirst * 0.5)
  })

  test('negative gravity settles the tip above the pivot', () => {
    const config = { ...BASE, gravity: -900 }
    const rope = horizontalStart(config)
    run(rope, config, 120 * 12)
    expect(ropeTip(rope).y).toBeCloseTo(PIVOT.y - BASE.segments * BASE.segmentLength, 0)
  })

  test('a sudden pivot move leaves the tip lagging, then it catches up', () => {
    const rope = createRope(BASE, PIVOT)
    const moved = { x: PIVOT.x + 200, y: PIVOT.y }
    stepRope(rope, BASE, DT, moved)
    expect(ropeTip(rope).x).toBeLessThan(moved.x - 50)
    run(rope, BASE, 120 * 8, moved)
    expect(ropeTip(rope).x).toBeCloseTo(moved.x, 0)
  })

  test('is deterministic', () => {
    const a = horizontalStart(BASE)
    const b = horizontalStart(BASE)
    run(a, BASE, 300)
    run(b, BASE, 300)
    expect(Array.from(a.x)).toEqual(Array.from(b.x))
    expect(Array.from(a.y)).toEqual(Array.from(b.y))
  })
})
