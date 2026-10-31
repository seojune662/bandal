import type { Annotation } from './annotation'
import type { Drawing } from './drawing'

/** All saved first-page marks, verified against the same original PDF bytes. */
export interface PDFPreviewSnapshot {
  documentRevision: string
  drawings: Drawing[]
  annotations: Annotation[]
}

export interface PDFMarkupChanged {
  courseId: string
  relPath: string
  documentRevision: string
  /** `sync`: a background sync wrote these drawings, so an open view reloads them; local saves leave it out. */
  origin?: 'sync'
}
