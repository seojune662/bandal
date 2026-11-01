/** Sync through the user's iCloud or Google Drive (design 6.1–6.4): what the settings screen shows and asks for. */

export type SyncProviderKind = 'icloud' | 'gdrive'

export type SyncState =
  /** `needs-auth`: Google Drive's sign-in stopped working. */
  | { state: 'off' | 'syncing' | 'update-required' | 'needs-ipad' | 'unavailable' | 'needs-auth' }
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
  /** What this computer can sync with: iCloud on a Mac, Google Drive where this build has its Google client. */
  available: Record<SyncProviderKind, boolean>
  provider: SyncProviderKind | null
  /** The Google account signed in for Drive sync: its address, '' when Google did not say, null when signed out. */
  account: string | null
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
  | { status: 'needs-ipad' | 'unavailable' | 'waiting' | 'update-required' | 'needs-auth' }
  | { status: 'error'; message: string }

export type ConnectMode = 'merge' | 'overwrite' | 'import'
