import { parsePdfPageNote, reconcilePdfPageNote, serializePdfPageNote, type PdfPageSize } from '../../../../shared/pdfPageNote'
import type { MaterialLinkRecord } from '../../../../shared/types/link'
import { invoke } from '../../lib/ipc'

/** A viewer keeps immutable PDF bytes while another device may replace the
 * current file. Never let its old page ordinals rewrite newer linked notes. */
export async function reconcilePageNoteRevision(input: {
  courseId: string; relPath: string; documentRevision: string; fingerprint: string
  pageSizes: PdfPageSize[]; record: MaterialLinkRecord; cancelled(): boolean
}): Promise<'updated' | 'stale' | 'skipped'> {
  const { courseId, relPath, documentRevision, fingerprint, pageSizes, record, cancelled } = input
  if (cancelled() || record.target.kind !== 'note') return 'skipped'
  const current = await invoke('pdfNotes:info', { courseId, relPath })
  if (current.documentRevision !== documentRevision) return 'stale'
  if (cancelled()) return 'skipped'
  const note = await invoke('notes:read', record.target.payload)
  const document = parsePdfPageNote(note.markdown)
  if (cancelled() || document === null) return 'skipped'
  const reconciled = reconcilePdfPageNote(document, relPath, fingerprint, pageSizes)
  const pageNoteSource = { relPath, documentRevision }
  // Each mutation also verifies the viewed revision under the backend material
  // lock, closing the race after the asynchronous info/read calls above.
  await invoke('notes:write', { ...record.target.payload, markdown: serializePdfPageNote(reconciled), expectedMtime: note.mtime, pageNoteSource })
  if (cancelled()) return 'skipped'
  await invoke('links:updatePageNote', { courseId, id: record.id,
    metadata: { version: 1, syncScroll: record.metadata?.syncScroll ?? true, fingerprint, pageSizes }, pageNoteSource })
  return 'updated'
}
