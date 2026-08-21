import { describe, expect, test } from 'vitest'
import {
  CharmEngine,
  type CharmRig,
  type CharmSink,
  type SubRopeFrame
} from '../../../../src/renderer/src/features/assistant/charms/charmEngine'
import type { RopeConfig } from '../../../../src/renderer/src/features/assistant/charms/physics/rope'
import { yoyoTheme } from '../../../../src/renderer/src/features/assistant/charms/themes/yoyo'
import { windchimeTheme } from '../../../../src/renderer/src/features/assistant/charms/themes/windchime'

function drive(rig: CharmRig, start: { x: number; y: number }) {
  let pivot = start
  let pending: ((t: number) => void) | null = null
  let lastSubs: readonly SubRopeFrame[] = []
  const sink: CharmSink = {
    readPivot: () => pivot,
    writeFrame: (_s, _p, _dt, subs) => {
      lastSubs = subs
    }
  }
  const engine = new CharmEngine(rig, sink, {
    now: () => 0,
    raf: (cb) => {
      pending = cb
      return 1
    },
    caf: () => {
      pending = null
    }
  })
  engine.wake()
  let t = 0
  const tick = (): void => {
    const cb = pending
    pending = null
    cb?.(t)
    t += 16
  }
  return {
    engine,
    tick,
    setPivot: (p: { x: number; y: number }) => {
      pivot = p
    },
    subs: () => lastSubs
  }
}

describe('yo-yo adjustRope', () => {
  test('string lets out under fast movement and winds back at rest', () => {
    const h = drive(yoyoTheme, { x: 100, y: 100 })
    const rest = yoyoTheme.rope.segmentLength
    h.tick()
    for (let i = 0; i < 60; i += 1) {
      h.setPivot({ x: 100 + i * 12, y: 100 })
      h.tick()
    }
    const dropped = h.engine.ropeConfig.segmentLength
    expect(dropped).toBeGreaterThan(rest * 1.5)
    for (let i = 0; i < 60 * 6; i += 1) h.tick()
    expect(h.engine.ropeConfig.segmentLength).toBeLessThan(dropped)
    expect(h.engine.ropeConfig.segmentLength).toBeLessThan(rest + 0.5)
  })

  test('returns the same config object when nothing changes', () => {
    const config: RopeConfig = { ...yoyoTheme.rope }
    const still = { x: 0, y: 0, angle: 0, angularVelocity: 0, speed: 0 }
    expect(yoyoTheme.adjustRope?.(config, still, 1 / 120)).toBe(config)
  })
})

describe('wind chime sub ropes', () => {
  test('each tube hangs under its bar slot and follows the bar', () => {
    const h = drive(windchimeTheme, { x: 200, y: 100 })
    for (let i = 0; i < 240; i += 1) h.tick()
    const subs = h.subs()
    expect(subs).toHaveLength(windchimeTheme.subRopes?.count ?? 0)
    const xs = subs.map((s) => s.pose.x)
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1] ?? 0)
    }
    expect(subs[2]?.pose.x).toBeCloseTo(200, 0)

    h.setPivot({ x: 400, y: 100 })
    h.engine.wake()
    for (let i = 0; i < 600; i += 1) h.tick()
    expect(h.subs()[2]?.pose.x).toBeCloseTo(400, 0)
    expect(h.engine.sleeping).toBe(true)
  })
})
