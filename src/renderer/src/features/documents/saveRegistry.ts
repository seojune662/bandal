interface DocumentRef { courseId: string; relPath: string }
const sessions = new Map<() => Promise<void>, DocumentRef | undefined>()
/** Includes hidden/split PDF and legacy recovery views during destructive transitions. */
export function registerDocumentSave(flush: () => Promise<void>, ref?: DocumentRef): () => void {
  sessions.set(flush, ref)
  return () => { sessions.delete(flush) }
}
export async function flushDocumentSaves(ref?: DocumentRef): Promise<void> {
  await Promise.all([...sessions].filter(([, registered]) => !ref || (
    registered?.courseId === ref.courseId && registered.relPath === ref.relPath
  )).map(([flush]) => flush()))
}
