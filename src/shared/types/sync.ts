/** Sync through the user's iCloud (design 6.1–6.2): what the settings screen shows and asks for. */

export type SyncState =
  | { state: 'off' | 'syncing' | 'update-required' | 'needs-ipad' | 'unavailable' }
  | { state: 'synced'; at: number }
  /** Root files are still downloading, or the Mac is offline: nothing was applied. */
  | { state: 'waiting'; pending: number }
  | { state: 'error'; message: string }

export interface SyncDevice {
  id: string
  name: string
  platform: string | null
  last_seen: number | null
}

export interface SyncView {
  /** iCloud sync works on this platform. */
  available: boolean
  provider: 'icloud' | null
  state: SyncState
  device: { id: string | null; name: string }
  devices: (SyncDevice & { self: boolean })[]
  /** Local changes not written to the root yet. */
  pending: number
}

export interface ConnectPlan {
  /**
   * `upload`: the root holds nothing alive. `download`: this profile has no
   * course. `choose`: both hold data and never synced together. `resume`:
   * this profile synced with this root before.
   */
  kind: 'upload' | 'download' | 'choose' | 'resume'
  local: { courses: number; docs: number }
  remote: { courses: number; docs: number }
  /** Courses of the same name on both sides, offered for a merge. */
  pairs: { local: string; remote: string; name: string }[]
}

/** What connecting would do, or why it cannot start now. */
export type ConnectPrepare =
  | { status: 'ready'; plan: ConnectPlan }
  | { status: 'needs-ipad' | 'unavailable' | 'waiting' | 'update-required' }
  | { status: 'error'; message: string }

export type ConnectMode = 'merge' | 'overwrite' | 'import'
