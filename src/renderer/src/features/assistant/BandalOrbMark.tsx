import { useId, type CSSProperties } from 'react'

export type BandalOrbState = 'idle' | 'hover' | 'busy' | 'alert'

export interface BandalOrbMarkProps {
  size?: number
  state?: BandalOrbState
}

type MarkStyle = CSSProperties & { '--bandal-mark-size'?: string }

const PHASE_DISC = [
  'M 16 2',
  'A 14 14 0 1 1 16 30',
  'A 14 14 0 1 1 16 2',
  'Z'
].join(' ')

const LIT_LIMB = 'M 16 2 A 14 14 0 0 1 16 30'

/**
 * The moving terminator is an A-arc disc compressed on the x axis inside an
 * alpha mask. Changing scaleX is equivalent to changing the terminator's rx,
 * while keeping animation on compositor-friendly transforms.
 */
export function BandalOrbMark({
  size,
  state = 'idle'
}: BandalOrbMarkProps): JSX.Element {
  const maskId = `bandal-orb-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const style: MarkStyle | undefined =
    size === undefined ? undefined : { '--bandal-mark-size': `${size}px` }

  return (
    <span
      className="bandal-orb-mark"
      data-state={state}
      style={style}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" focusable="false">
        <defs>
          <mask
            id={maskId}
            className="bandal-orb-mark__mask"
            x="2"
            y="2"
            width="28"
            height="28"
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
          >
            <rect
              className="bandal-orb-mark__lit-half"
              x="16"
              y="2"
              width="14"
              height="28"
            />
            <path className="bandal-orb-mark__terminator" d={PHASE_DISC} />
          </mask>
        </defs>
        <g className="bandal-orb-mark__axis">
          <circle className="bandal-orb-mark__shadow" cx="16" cy="16" r="14" />
          <circle
            className="bandal-orb-mark__moon"
            cx="16"
            cy="16"
            r="14"
            mask={`url(#${maskId})`}
          />
          <path className="bandal-orb-mark__lit-edge" d={LIT_LIMB} />
        </g>
        <circle className="bandal-orb-mark__rim" cx="16" cy="16" r="14" />
      </svg>
    </span>
  )
}
