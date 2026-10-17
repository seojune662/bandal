import { invoke } from '../../lib/ipc'

/** A material notification may arrive after a page rewrite but before the old
 * viewer retires. Keep its existing rows; PdfTab offers the new revision. */
export async function readViewedPdfRevision<T>(courseId: string, relPath: string, documentRevision: string | undefined,
  read: () => Promise<T>): Promise<T | undefined> {
  if (!documentRevision) return read()
  if ((await invoke('pdfNotes:info', { courseId, relPath })).documentRevision !== documentRevision) return undefined
  try { return await read() } catch (error) {
    // The guarded read closes the race after the metadata check. This helper
    // wraps reads only; rejected writes still retain and report pending ink.
    if (error instanceof Error && /PDF 원본이 (기존 필기와 다릅니다|변경되었습니다)/.test(error.message)) return undefined
    throw error
  }
}
