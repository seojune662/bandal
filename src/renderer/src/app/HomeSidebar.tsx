import type { ReactNode } from 'react'
import { UniversityShortcuts } from '../features/university/UniversityShortcuts'
import { AiShortcuts } from '../features/ai/AiShortcuts'

/** School and AI shortcuts keep one lifetime across course/project navigation. */
export function HomeSidebar({ hidden, children }: { hidden: boolean; children: ReactNode }): JSX.Element {
  return <div className="shell-home-sidebar" hidden={hidden}>
    <div className="shell-home-sidebar__shortcuts">
      <UniversityShortcuts />
      <AiShortcuts />
    </div>
    <div className="shell-home-sidebar__lists">{children}</div>
  </div>
}
