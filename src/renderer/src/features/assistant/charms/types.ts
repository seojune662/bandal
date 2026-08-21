import type { OrbCharmId } from '../../../../../shared/orbCharm'
import type { BandalOrbState } from '../BandalOrbMark'
import type { CharmAnchor, CharmPose } from './physics/pose'
import type { RopeConfig, Vec2 } from './physics/rope'

export type { CharmAnchor, CharmPose } from './physics/pose'
export type { RopeConfig, RopeState, Vec2 } from './physics/rope'

export type CharmThemeId = Exclude<OrbCharmId, 'none'>

export type RopeStyle = 'thread' | 'string' | 'chain' | 'none'

/** Per-frame updater returned by `bindPose`; mutates SVG attributes only. */
export type PoseUpdater = (pose: CharmPose, dt: number) => void

/**
 * Extra ropes hanging off the main character (wind chime tubes). Each pivot
 * is `offset(i)` in the character's local frame, rotated with the body.
 */
export interface SubRopes {
  count: number
  config: RopeConfig
  offset: (index: number) => Vec2
  ropeStyle: Exclude<RopeStyle, 'chain'>
  /** One piece per sub rope, drawn at that rope's tip. */
  Piece: (props: { index: number }) => JSX.Element
}

export interface CharmTheme {
  id: CharmThemeId
  anchor: CharmAnchor
  /** Rope start sits this fraction of the orb's width inside its rim. */
  attachInsetRatio: number
  rope: RopeConfig
  ropeStyle: RopeStyle
  /**
   * Optional per-step rope retune (yo-yo length). Must return a NEW config
   * when something changes, or the same object when nothing does.
   */
  adjustRope?: (config: RopeConfig, pose: CharmPose | null, dt: number) => RopeConfig
  subRopes?: SubRopes
  /** Static SVG parts, rendered once by React inside the character <g>. */
  Character: () => JSX.Element
  /**
   * Called once per mount with the character <g>. Looks up `data-part`
   * children and returns a closure that writes their transforms per frame.
   */
  bindPose: (root: SVGGElement) => PoseUpdater
  /** Settings card preview at rest, inside a 140×86 viewBox scaled 0.55. */
  Preview: () => JSX.Element
}

/** Orb activity the charm may react to (lantern glow on `busy`). */
export type CharmOrbState = BandalOrbState
