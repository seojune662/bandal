import type { OrbCharmId } from '../../../../../shared/orbCharm'
import { getCharmTheme } from './registry'
import './charms.css'

export interface CharmPreviewProps {
  id: OrbCharmId
}

/** A miniature orb at rest with the charm hanging from it — no physics. */
export function CharmPreview({ id }: CharmPreviewProps): JSX.Element {
  const theme = getCharmTheme(id)
  const above = theme?.anchor === 'above'
  const ropeLength = theme === null ? 0 : theme.rope.segments * theme.rope.segmentLength
  const pivotY = above ? 78 : 30
  const attach = above ? -26 : 26
  const Preview = theme?.Preview
  return (
    <svg
      className="charm-preview"
      viewBox="0 0 140 86"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={`translate(70 ${pivotY}) scale(0.55)`}>
        {theme !== null && Preview !== undefined && (
          <g transform={`translate(0 ${attach})`}>
            {theme.ropeStyle !== 'none' && (
              <line
                className="charm-preview__rope"
                x1="0"
                y1="0"
                x2="0"
                y2={above ? -ropeLength : ropeLength}
              />
            )}
            <g transform={`translate(0 ${above ? -ropeLength : ropeLength})`}>
              <Preview />
            </g>
          </g>
        )}
        <circle className="charm-preview__orb" r="28" />
        <g transform="rotate(-14)">
          <circle r="14" fill="currentColor" opacity="0.11" />
          <path
            d="M0 -14 A14 14 0 0 1 0 14 A6 14 0 0 0 0 -14Z"
            fill="currentColor"
            opacity="0.92"
          />
          <circle r="14" fill="none" stroke="currentColor" strokeWidth="0.9" opacity="0.48" />
        </g>
      </g>
    </svg>
  )
}
