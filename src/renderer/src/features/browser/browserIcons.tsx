/**
 * [M3-F] Browser-chrome icons the shared app icon set doesn't carry.
 * Same visual conventions as app/icons.tsx (24 viewBox, 1.75 stroke).
 */

import type { SVGProps } from 'react'

export type BrowserIconName = 'arrowLeft' | 'arrowRight' | 'globe' | 'lock'

interface BrowserIconProps extends SVGProps<SVGSVGElement> {
  name: BrowserIconName
}

const paths: Record<BrowserIconName, JSX.Element> = {
  arrowLeft: <path d="M19 12H5m6-6-6 6 6 6" />,
  arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5s1.2-6.2 3.6-8.5Z" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10" width="13" height="10" rx="2" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
    </>
  )
}

export function BrowserIcon({ name, ...props }: BrowserIconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      {...props}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.75}
      >
        {paths[name]}
      </g>
    </svg>
  )
}
