/**
 * Fixed-timestep rAF loop around one rope (plus optional sub ropes hanging
 * off the character). React is not involved: the engine reads the orb's
 * rect through the sink, steps the ropes, and writes SVG attributes. It
 * sleeps when everything is at rest so an idle orb costs nothing; the hook
 * wakes it when the orb moves.
 */

import { computePose } from './physics/pose'
import type { CharmAnchor, CharmPose } from './physics/pose'
import { createRope, isRopeAtRest, resetRope, stepRope } from './physics/rope'
import type { RopeConfig, RopeState, Vec2 } from './physics/rope'
import type { SubRopes } from './types'

export const STEP_SECONDS = 1 / 120
/** Longest frame we integrate; a backgrounded tab returns with one big gap. */
const MAX_FRAME_SECONDS = 0.1
const REST_EPSILON_PX = 0.02
const REST_FRAMES_BEFORE_SLEEP = 30
const MAX_STEPS_PER_FRAME = Math.ceil(MAX_FRAME_SECONDS / STEP_SECONDS)

export interface SubRopeFrame {
  state: RopeState
  pose: CharmPose
}

export interface CharmSink {
  /** Attach point in viewport px, or null when the orb is not mounted. */
  readPivot(): Vec2 | null
  writeFrame(
    state: RopeState,
    pose: CharmPose,
    dt: number,
    subRopes: readonly SubRopeFrame[]
  ): void
}

export interface CharmRig {
  rope: RopeConfig
  anchor: CharmAnchor
  adjustRope?: (config: RopeConfig, pose: CharmPose | null, dt: number) => RopeConfig
  subRopes?: SubRopes
}

export interface CharmEngineOptions {
  raf?: (callback: (time: number) => void) => number
  caf?: (handle: number) => void
}

function rotateOffset(offset: Vec2, pose: CharmPose, anchor: CharmAnchor): Vec2 {
  const rotation = anchor === 'below' ? pose.angle : -pose.angle
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: pose.x + offset.x * cos - offset.y * sin,
    y: pose.y + offset.x * sin + offset.y * cos
  }
}

export class CharmEngine {
  private readonly rope: RopeState
  private config: RopeConfig
  private pose: CharmPose | null = null
  private readonly subStates: RopeState[] = []
  private readonly subPoses: Array<CharmPose | null> = []
  private pivot: Vec2 = { x: 0, y: 0 }
  private lastTime: number | null = null
  private accumulator = 0
  private restFrames = 0
  private handle: number | null = null
  private reducedMotion = false
  private disposed = false
  private readonly raf: (callback: (time: number) => void) => number
  private readonly caf: (handle: number) => void

  constructor(
    private readonly rig: CharmRig,
    private readonly sink: CharmSink,
    options: CharmEngineOptions = {}
  ) {
    this.raf = options.raf ?? ((cb) => window.requestAnimationFrame(cb))
    this.caf = options.caf ?? ((h) => window.cancelAnimationFrame(h))
    this.config = rig.rope
    const pivot = this.sink.readPivot() ?? this.pivot
    this.rope = createRope(rig.rope, pivot)
    const subs = rig.subRopes
    if (subs !== undefined) {
      const pose = computePose(this.rope, null, STEP_SECONDS, rig.anchor)
      for (let i = 0; i < subs.count; i += 1) {
        const subPivot = rotateOffset(subs.offset(i), pose, rig.anchor)
        this.subStates.push(createRope(subs.config, subPivot))
        this.subPoses.push(null)
      }
    }
  }

  get sleeping(): boolean {
    return this.handle === null
  }

  /** Current rope config (after any `adjustRope`). Diagnostics and tests. */
  get ropeConfig(): RopeConfig {
    return this.config
  }

  /** Idempotent: starts the loop if asleep, or draws once under reduced motion. */
  wake(): void {
    if (this.disposed) return
    if (this.reducedMotion) {
      this.drawStill()
      return
    }
    if (this.handle !== null) return
    this.lastTime = null
    this.accumulator = STEP_SECONDS
    this.restFrames = 0
    this.schedule()
  }

  /** Tab hidden: stop the loop without snapping the rope. */
  pause(): void {
    if (this.handle !== null) {
      this.caf(this.handle)
      this.handle = null
    }
    this.lastTime = null
    this.accumulator = 0
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on
    if (on) {
      this.pause()
      this.drawStill()
    }
  }

  dispose(): void {
    this.pause()
    this.disposed = true
  }

  private schedule(): void {
    this.handle = this.raf((time) => this.frame(time))
  }

  private subFrames(): SubRopeFrame[] {
    return this.subStates.map((state, i) => ({
      state,
      pose: this.subPoses[i] ?? computePose(state, null, STEP_SECONDS, 'below')
    }))
  }

  private drawStill(): void {
    const pivot = this.sink.readPivot()
    if (pivot === null) return
    this.pivot = pivot
    resetRope(this.rope, this.config, pivot)
    const pose = computePose(this.rope, null, STEP_SECONDS, this.rig.anchor)
    this.pose = pose
    const subs = this.rig.subRopes
    if (subs !== undefined) {
      this.subStates.forEach((state, i) => {
        resetRope(state, subs.config, rotateOffset(subs.offset(i), pose, this.rig.anchor))
        this.subPoses[i] = computePose(state, null, STEP_SECONDS, 'below')
      })
    }
    this.sink.writeFrame(this.rope, pose, 0, this.subFrames())
  }

  private stepAll(pivot: Vec2): void {
    if (this.rig.adjustRope !== undefined) {
      this.config = this.rig.adjustRope(this.config, this.pose, STEP_SECONDS)
    }
    stepRope(this.rope, this.config, STEP_SECONDS, pivot)
    const subs = this.rig.subRopes
    if (subs === undefined) return
    const pose = computePose(this.rope, this.pose, STEP_SECONDS, this.rig.anchor)
    this.subStates.forEach((state, i) => {
      stepRope(
        state,
        subs.config,
        STEP_SECONDS,
        rotateOffset(subs.offset(i), pose, this.rig.anchor)
      )
    })
  }

  private allAtRest(): boolean {
    if (!isRopeAtRest(this.rope, REST_EPSILON_PX)) return false
    return this.subStates.every((state) => isRopeAtRest(state, REST_EPSILON_PX))
  }

  private frame(time: number): void {
    this.handle = null
    if (this.disposed) return
    const pivot = this.sink.readPivot()
    if (pivot === null) {
      this.pause()
      return
    }
    const pivotMoved = pivot.x !== this.pivot.x || pivot.y !== this.pivot.y
    this.pivot = pivot

    const elapsed =
      this.lastTime === null
        ? 0
        : Math.min((time - this.lastTime) / 1000, MAX_FRAME_SECONDS)
    this.lastTime = time
    this.accumulator = Math.min(this.accumulator + elapsed, MAX_FRAME_SECONDS)

    let steps = 0
    while (this.accumulator >= STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
      this.stepAll(pivot)
      this.accumulator -= STEP_SECONDS
      steps += 1
    }
    if (steps > 0) {
      const dt = steps * STEP_SECONDS
      this.pose = computePose(this.rope, this.pose, dt, this.rig.anchor)
      this.subStates.forEach((state, i) => {
        this.subPoses[i] = computePose(state, this.subPoses[i] ?? null, dt, 'below')
      })
      this.sink.writeFrame(this.rope, this.pose, dt, this.subFrames())
    }

    const atRest = !pivotMoved && this.allAtRest()
    this.restFrames = atRest ? this.restFrames + 1 : 0
    if (this.restFrames >= REST_FRAMES_BEFORE_SLEEP) {
      this.lastTime = null
      this.accumulator = 0
      return
    }
    this.schedule()
  }
}
