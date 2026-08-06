import { useId, type CSSProperties } from 'react'

export type BandalOrbState = 'idle' | 'hover' | 'busy' | 'alert'

export interface BandalOrbMarkProps {
  size?: number
  state?: BandalOrbState
}

type MarkStyle = CSSProperties & { '--bandal-mark-size'?: string }

/**
 * The moving terminator is painted inside an alpha mask, so every visible
 * colour still comes from the active semantic theme.
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
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
          >
            <circle className="bandal-orb-mark__mask-disc" cx="16" cy="16" r="14" />
          </mask>
        </defs>
        <g className="bandal-orb-mark__axis" mask={`url(#${maskId})`}>
          <circle className="bandal-orb-mark__moon" cx="16" cy="16" r="14" />
          <ellipse
            className="bandal-orb-mark__terminator"
            cx="16"
            cy="16"
            rx="14"
            ry="16"
          />
        </g>
        <circle className="bandal-orb-mark__rim" cx="16" cy="16" r="14" />
      </svg>
    </span>
  )
}
