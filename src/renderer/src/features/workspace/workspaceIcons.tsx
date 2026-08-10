/**
 * Tab-kind icons. `pdf`/`note` reuse the shared app icon set; the kinds the
 * shell does not know about yet (browser/chat/board/group-chat/whiteboard) are
 * drawn here so the workspace stays self-contained.
 */

import type { SVGProps } from 'react'
import type { TabKind } from '../../../../shared/tabs'
import { Icon } from '../../app/icons'

type LocalKind = 'browser' | 'chat' | 'board' | 'group-chat' | 'whiteboard'

const localPaths: Record<LocalKind, JSX.Element> = {
  browser: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5s1.3-6.2 3.8-8.5z" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5.5h16v11H10l-4.5 3.5v-3.5H4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9.2 4v16M14.8 4v16M5.8 7.5h1M11.5 7.5h1M17.2 7.5h1" />
    </>
  ),
  // [P2] Two overlapping bubbles — deliberately distinct from `chat` (one
  // bubble), because the AI tutor tab and a group tab can be open side by side
  // and the tab strip is the only thing telling them apart.
  'group-chat': (
    <>
      <path d="M3.5 5.5h12v8H8l-4.5 3.5V13.5z" />
      <path d="M8 17h8l4.5 3.5V17h0V9h-4.5" />
    </>
  ),
  whiteboard: (
    <>
      <rect x="3.5" y="4" width="17" height="14" rx="2" />
      <path d="m7 14 3-3 2.5 2 4-5M8 21h8M12 18v3" />
    </>
  )
}

function LocalIcon({
  kind,
  ...props
}: { kind: LocalKind } & SVGProps<SVGSVGElement>): JSX.Element {
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
        {localPaths[kind]}
      </g>
    </svg>
  )
}

interface TabKindIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  kind: TabKind
}

export function TabKindIcon({ kind, ...props }: TabKindIconProps): JSX.Element {
  switch (kind) {
    case 'pdf':
      return <Icon name="filePdf" {...props} />
    case 'note':
      return <Icon name="fileText" {...props} />
    case 'image':
      return <Icon name="fileImage" {...props} />
    case 'browser':
    case 'chat':
    case 'board':
    case 'group-chat':
    case 'whiteboard':
      return <LocalIcon kind={kind} {...props} />
  }
}
