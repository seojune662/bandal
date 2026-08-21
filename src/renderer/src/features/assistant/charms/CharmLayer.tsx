import { useRef } from 'react'
import type { RefObject } from 'react'
import { useUiStore } from '../../../stores/uiStore'
import { getCharmTheme } from './registry'
import type { CharmOrbState, CharmTheme } from './types'
import { useCharmEngine } from './useCharmEngine'
import './charms.css'

export interface CharmLayerProps {
  orbRef: RefObject<HTMLElement>
  /** Orb activity; themes may style `[data-state]` (lantern glows on busy). */
  orbState?: CharmOrbState
}

/**
 * Viewport-sized SVG that draws the chosen charm hanging off the orb. Sits
 * FIRST in `.assistant-layer` so the popup and the orb paint above it. The
 * charm may leave the viewport when the orb is parked at an edge — that is
 * physically honest and the `none` default covers anyone who minds.
 */
export function CharmLayer({
  orbRef,
  orbState = 'idle'
}: CharmLayerProps): JSX.Element | null {
  const id = useUiStore((state) => state.orbCharm)
  const theme = getCharmTheme(id)
  if (theme === null) return null
  // key: a theme switch remounts → fresh rope, fresh engine.
  return (
    <CharmSvg key={theme.id} theme={theme} orbRef={orbRef} orbState={orbState} />
  )
}

function CharmSvg({
  theme,
  orbRef,
  orbState
}: {
  theme: CharmTheme
  orbRef: RefObject<HTMLElement>
  orbState: CharmOrbState
}): JSX.Element {
  const rope = useRef<SVGGraphicsElement>(null)
  const character = useRef<SVGGElement>(null)
  const subRopes = useRef<SVGGElement>(null)
  useCharmEngine(theme, orbRef, { rope, character, subRopes })
  const Character = theme.Character
  const subs = theme.subRopes
  return (
    <svg
      className="assistant-charm"
      data-charm={theme.id}
      data-rope={theme.ropeStyle}
      data-state={orbState}
      aria-hidden="true"
      focusable="false"
    >
      {theme.ropeStyle === 'chain' ? (
        <g ref={rope as RefObject<SVGGElement>} className="assistant-charm__chain">
          {Array.from({ length: theme.rope.segments }, (_, index) => (
            <ellipse
              key={index}
              rx={index % 2 === 0 ? 3 : 1.6}
              ry={theme.rope.segmentLength / 2 + 0.5}
            />
          ))}
        </g>
      ) : theme.ropeStyle === 'none' ? null : (
        <polyline
          ref={rope as RefObject<SVGPolylineElement>}
          className="assistant-charm__rope"
        />
      )}
      {subs !== undefined && (
        <g
          ref={subRopes}
          className="assistant-charm__subropes"
          data-rope={subs.ropeStyle}
        >
          {Array.from({ length: subs.count }, (_, index) => (
            <g key={index}>
              <polyline className="assistant-charm__rope" />
              <g className="assistant-charm__piece">
                <subs.Piece index={index} />
              </g>
            </g>
          ))}
        </g>
      )}
      <g ref={character} className="assistant-charm__character">
        <Character />
      </g>
    </svg>
  )
}
