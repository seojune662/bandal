import type { BandalOrbState } from './BandalOrbMark'

export interface OrbActivityState {
  busy: boolean
  alert: boolean
  needsApproval: boolean
}

export function orbStateForActivity(
  activity: OrbActivityState,
  hovered = false
): BandalOrbState {
  if (activity.needsApproval || activity.alert) return 'alert'
  if (activity.busy) return 'busy'
  return hovered ? 'hover' : 'idle'
}
