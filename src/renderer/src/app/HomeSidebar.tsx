import type { ReactNode } from 'react'
import { HomeSiteTiles } from '../features/homeSites/HomeSiteTiles'

/** Site tiles keep one lifetime across course/project navigation (iPad NativeHomeSiteTiles). */
export function HomeSidebar({ hidden, children }: { hidden: boolean; children: ReactNode }): JSX.Element {
  return <div className="shell-home-sidebar" hidden={hidden}>
    <div className="shell-home-sidebar__shortcuts">
      <HomeSiteTiles />
    </div>
    <div className="shell-home-sidebar__lists">{children}</div>
  </div>
}
