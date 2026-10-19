import type { MaterialKind } from './materials'

export interface ExternalSourceEntry {
  /** Opaque session id: never an arbitrary renderer-supplied filesystem path. */
  id: string
  name: string
  kind: MaterialKind | 'dir'
  size?: number
}

export interface ExternalSourceLocation {
  id: string
  label: string
  kind: 'folder' | 'photos'
  parentId: string | null
  entries: ExternalSourceEntry[]
  truncated: boolean
}
