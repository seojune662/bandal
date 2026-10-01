import type { CSSProperties } from 'react'
import { BandalMark } from '../../components/BandalMark'
export type BandalOrbState = 'idle' | 'hover' | 'busy' | 'alert'
export interface BandalOrbMarkProps { size?: number; state?: BandalOrbState }
export function BandalOrbMark({ size, state = 'idle' }: BandalOrbMarkProps): JSX.Element {
  return <span className="bandal-orb-mark" data-state={state} style={size === undefined ? undefined : { '--bandal-mark-size': `${size}px` } as CSSProperties} aria-hidden="true">
    <BandalMark motion={state === 'hover' || state === 'busy' ? 'loop' : 'idle'} />
  </span>
}
