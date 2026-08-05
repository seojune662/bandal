/**
 * The 반달 mark — one component, used everywhere the brand appears in-app.
 *
 * Same geometry as the app icon (scripts/generate-icon.mjs): a whole disc with
 * the right half finished in solid color and the left half held only by its
 * ring, tilted -14° with a terminator that bows 15% of the radius into the
 * dark side. Icon and app therefore read as the same mark.
 *
 * Colors come from `currentColor` alone, so the caller sets the role
 * (`color: var(--accent)`) and every theme follows for free — no raw color
 * values, per STYLEGUIDE §1.
 */

const CX = 12
const CY = 12
const R = 9
const TILT = -14
const TERMINATOR_BULGE = 0.15

/** Right half-disc, closed by an arc that bows into the unlit side. */
const LIT_HALF = [
  `M ${CX} ${CY - R}`,
  `A ${R} ${R} 0 0 1 ${CX} ${CY + R}`,
  `A ${(R * TERMINATOR_BULGE).toFixed(2)} ${R} 0 0 1 ${CX} ${CY - R}`,
  'Z'
].join(' ')

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
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={title !== undefined ? 'img' : undefined}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
    >
      {title !== undefined && <title>{title}</title>}
      <g transform={`rotate(${TILT} ${CX} ${CY})`}>
        {/* unfinished half: a whisper of body, plus the ring that closes it */}
        <circle cx={CX} cy={CY} r={R} fill="currentColor" opacity={0.12} />
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.42}
          strokeWidth={1}
        />
        {/* finished half */}
        <path d={LIT_HALF} fill="currentColor" />
      </g>
    </svg>
  )
}
