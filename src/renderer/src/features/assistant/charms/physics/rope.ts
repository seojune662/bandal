/**
 * Position-Verlet rope: point 0 is pinned to the orb, the rest hang under
 * gravity and are held together by distance constraints. Pure and
 * deterministic — no DOM, no time source — so it runs in Node tests.
 *
 * Moving the pin each step is what produces the swing: point 1 is dragged
 * through its constraint, the rest follow with inertia. No explicit pivot
 * velocity is injected.
 */

export interface Vec2 {
  x: number
  y: number
}

export interface RopeConfig {
  /** Number of links; points = segments + 1, point 0 pinned. */
  segments: number
  /** Rest length of one link, px. */
  segmentLength: number
  /** px/s², +y down. Negative for a balloon that floats above the orb. */
  gravity: number
  /** Velocity loss, 1/s — per-step keep factor is exp(-drag·dt). */
  drag: number
  /** Constraint relaxation passes per step (3–6 is plenty). */
  iterations: number
  /** Mass of the tip point; other points weigh 1. Heavier tip = pendulum. */
  tipMass: number
  /**
   * 0 (or absent) = rigid links. >0 leaves |d − L| ≤ stretch·L uncorrected
   * so the rope can overshoot elastically (bungee).
   */
  stretch?: number
}

export interface RopeState {
  x: Float64Array
  y: Float64Array
  px: Float64Array
  py: Float64Array
}

function gravitySign(config: RopeConfig): number {
  return config.gravity < 0 ? -1 : 1
}

/** Straight rest pose along the gravity direction, hanging from `pivot`. */
export function createRope(config: RopeConfig, pivot: Vec2): RopeState {
  const n = config.segments + 1
  const state: RopeState = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    px: new Float64Array(n),
    py: new Float64Array(n)
  }
  resetRope(state, config, pivot)
  return state
}

/** Snap every point to the rest pose (reduced motion, theme switch). */
export function resetRope(
  state: RopeState,
  config: RopeConfig,
  pivot: Vec2
): void {
  const sign = gravitySign(config)
  for (let i = 0; i < state.x.length; i += 1) {
    const y = pivot.y + sign * i * config.segmentLength
    state.x[i] = pivot.x
    state.y[i] = y
    state.px[i] = pivot.x
    state.py[i] = y
  }
}

export function stepRope(
  state: RopeState,
  config: RopeConfig,
  dt: number,
  pivot: Vec2
): void {
  const { x, y, px, py } = state
  const n = x.length
  const last = n - 1
  const keep = Math.exp(-config.drag * dt)
  const fall = config.gravity * dt * dt
  const L = config.segmentLength
  const slack = (config.stretch ?? 0) * L

  x[0] = pivot.x
  y[0] = pivot.y
  px[0] = pivot.x
  py[0] = pivot.y

  for (let i = 1; i < n; i += 1) {
    const xi = x[i] ?? 0
    const yi = y[i] ?? 0
    const vx = (xi - (px[i] ?? 0)) * keep
    const vy = (yi - (py[i] ?? 0)) * keep
    px[i] = xi
    py[i] = yi
    x[i] = xi + vx
    y[i] = yi + vy + fall
  }

  for (let pass = 0; pass < config.iterations; pass += 1) {
    for (let i = 1; i < n; i += 1) {
      const a = i - 1
      const xa = x[a] ?? 0
      const ya = y[a] ?? 0
      const xi = x[i] ?? 0
      const yi = y[i] ?? 0
      const dx = xi - xa
      const dy = yi - ya
      const d = Math.hypot(dx, dy)
      if (d === 0) continue
      const excess = d - L
      if (Math.abs(excess) <= slack) continue
      const corrected = excess - Math.sign(excess) * slack
      const ratio = corrected / d
      if (a === 0) {
        x[i] = xi - dx * ratio
        y[i] = yi - dy * ratio
        continue
      }
      const massA = 1
      const massB = i === last ? config.tipMass : 1
      const wA = massB / (massA + massB)
      const wB = massA / (massA + massB)
      x[a] = xa + dx * ratio * wA
      y[a] = ya + dy * ratio * wA
      x[i] = xi - dx * ratio * wB
      y[i] = yi - dy * ratio * wB
    }
  }

  x[0] = pivot.x
  y[0] = pivot.y
}

/** Σ ½ m v² using the Verlet velocity (x − px)/dt. Diagnostics and tests. */
export function ropeKineticEnergy(
  state: RopeState,
  config: RopeConfig,
  dt: number
): number {
  let energy = 0
  const last = state.x.length - 1
  for (let i = 1; i <= last; i += 1) {
    const vx = ((state.x[i] ?? 0) - (state.px[i] ?? 0)) / dt
    const vy = ((state.y[i] ?? 0) - (state.py[i] ?? 0)) / dt
    const mass = i === last ? config.tipMass : 1
    energy += 0.5 * mass * (vx * vx + vy * vy)
  }
  return energy
}

/** Largest |link length − rest length|, px. */
export function ropeLengthError(state: RopeState, config: RopeConfig): number {
  let worst = 0
  for (let i = 1; i < state.x.length; i += 1) {
    const d = Math.hypot(
      (state.x[i] ?? 0) - (state.x[i - 1] ?? 0),
      (state.y[i] ?? 0) - (state.y[i - 1] ?? 0)
    )
    worst = Math.max(worst, Math.abs(d - config.segmentLength))
  }
  return worst
}

/** True when no point moved more than `epsilon` px during the last step. */
export function isRopeAtRest(state: RopeState, epsilon: number): boolean {
  for (let i = 1; i < state.x.length; i += 1) {
    if (
      Math.abs((state.x[i] ?? 0) - (state.px[i] ?? 0)) > epsilon ||
      Math.abs((state.y[i] ?? 0) - (state.py[i] ?? 0)) > epsilon
    ) {
      return false
    }
  }
  return true
}

export function ropeTip(state: RopeState): Vec2 {
  const last = state.x.length - 1
  return { x: state.x[last] ?? 0, y: state.y[last] ?? 0 }
}
