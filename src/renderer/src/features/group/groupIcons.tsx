/**
 * Icons for the 함께하기 surface. Same 24-grid / 1.75 stroke conventions as
 * `app/icons.tsx`; kept local (like `universityIcons`) because these names
 * only mean something inside the group feature and the shared registry is a
 * merge point for every workstream.
 */

import type { SVGProps } from 'react'

export type GroupIconName =
  | 'alert'
  | 'copy'
  | 'logIn'
  | 'logOut'
  | 'moreHorizontal'
  | 'send'
  | 'ticket'
  | 'userPlus'
  | 'users'

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.75
}

const PATHS: Record<GroupIconName, JSX.Element> = {
  alert: (
    <>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
      <path d="M6 15H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 4h8A1.5 1.5 0 0 1 14.5 5.5V6" />
    </>
  ),
  logIn: (
    <>
      <path d="M10 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h4" />
      <path d="M15 8.5 19 12l-4 3.5M19 12H9" />
    </>
  ),
  logOut: (
    <>
      <path d="M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4" />
      <path d="M9 8.5 5 12l4 3.5M5 12h10" />
    </>
  ),
  moreHorizontal: (
    <>
      <circle cx="6" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18" cy="12" r="1" />
    </>
  ),
  send: <path d="M4.5 12 20 4.5l-4 15.5-4.5-6.5z" />,
  ticket: (
    <>
      <path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h14a1.5 1.5 0 0 1 1.5 1.5v1.75a2 2 0 0 0 0 3.5v1.75A1.5 1.5 0 0 1 19 17H5a1.5 1.5 0 0 1-1.5-1.5v-1.75a2 2 0 0 0 0-3.5z" />
      <path d="M13 8.5v7" />
    </>
  ),
  userPlus: (
    <>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3.5 19.5c0-3 2.7-4.5 6-4.5s6 1.5 6 4.5" />
      <path d="M18.5 8.5v5M16 11h5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5c0-3 2.9-4.5 6.5-4.5s6.5 1.5 6.5 4.5" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M18.5 19.5c0-2-.7-3.3-2-4.2" />
    </>
  )
}

interface GroupIconProps extends SVGProps<SVGSVGElement> {
  name: GroupIconName
}

export function GroupIcon({ name, ...props }: GroupIconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      {...props}
    >
      <g {...STROKE}>{PATHS[name]}</g>
    </svg>
  )
}
