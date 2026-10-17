export interface ExternalDrawingChange {
  courseId: string
  relPath: string
  documentRevision: string
}

const listeners = new Set<(change: ExternalDrawingChange) => void>()

/** A completed clip delivery can target an already-mounted PDF in this window.
 * Refresh its drawing data without invalidating the whole materials tree. */
export function notifyExternalDrawingChange(change: ExternalDrawingChange): void {
  for (const listener of listeners) listener(change)
}

export function subscribeExternalDrawingChanges(listener: (change: ExternalDrawingChange) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
