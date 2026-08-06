import { useId } from 'react'

/**
 * The 반달 mark — a lit spherical half held inside its complete, shadowed rim.
 * Geometry follows the app icon: radius 9, a -14° axis, and a terminator that
 * bows 15% of the radius into the unlit side.
 */

const CX = 12
const CY = 12
const R = 9
const TILT = -14
const TERMINATOR_BULGE = 0.15
const TERMINATOR_RX = R * TERMINATOR_BULGE

/** Lit hemisphere, closed by the curved terminator rather than a diameter. */
const LIT_HALF = [
  `M ${CX} ${CY - R}`,
  `A ${R} ${R} 0 0 1 ${CX} ${CY + R}`,
  `A ${TERMINATOR_RX} ${R} 0 0 1 ${CX} ${CY - R}`,
  'Z'
].join(' ')

const LIT_LIMB = `M ${CX} ${CY - R} A ${R} ${R} 0 0 1 ${CX} ${CY + R}`
const TERMINATOR = `M ${CX} ${CY + R} A ${TERMINATOR_RX} ${R} 0 0 1 ${CX} ${CY - R}`

interface BandalMarkProps {
  /** Rendered box in px. Legible down to 14. */
  size?: number
  className?: string
  /**
   * Accessible name. Omit for decorative use — the mark is then hidden from
   * assistive tech instead of announcing a meaningless graphic.
   */
  title?: string
}

export function BandalMark({
  size = 18,
  className,
  title
}: BandalMarkProps): JSX.Element {
  const surfaceId = `bandal-surface-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const isCompact = size <= 18

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={title !== undefined ? 'img' : undefined}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      {title !== undefined && <title>{title}</title>}
      {!isCompact && (
        <defs>
          <linearGradient id={surfaceId} x1="4" y1="4" x2="20" y2="20">
            <stop offset="0" stopColor="currentColor" stopOpacity={0.84} />
            <stop offset="0.52" stopColor="currentColor" />
            <stop offset="1" stopColor="currentColor" stopOpacity={0.88} />
          </linearGradient>
        </defs>
      )}
      <g transform={`rotate(${TILT} ${CX} ${CY})`}>
        {/* The low-alpha body keeps the shadow side spherical on every theme. */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="currentColor"
          opacity={isCompact ? 0.14 : 0.1}
        />
        <path
          d={LIT_HALF}
          fill={isCompact ? 'currentColor' : `url(#${surfaceId})`}
        />
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeOpacity={isCompact ? 0.5 : 0.4}
          strokeWidth={0.9}
          vectorEffect="non-scaling-stroke"
        />
        {!isCompact && (
          <>
            <path
              d={LIT_LIMB}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeOpacity={0.92}
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={TERMINATOR}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.16}
              strokeWidth={0.7}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </g>
    </svg>
  )
}
