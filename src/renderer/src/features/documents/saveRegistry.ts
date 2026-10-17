const sessions = new Set<() => Promise<void>>()
/** Includes hidden/split PDF and legacy recovery views during destructive transitions. */
export function registerDocumentSave(flush: () => Promise<void>): () => void {
  sessions.add(flush)
  return () => { sessions.delete(flush) }
}
export async function flushDocumentSaves(): Promise<void> {
  await Promise.all([...sessions].map(flush => flush()))
}
