import type { Database } from 'better-sqlite3'
import type { PDFPreviewSnapshot } from '../../../shared/types/pdfPreview'
import { ValidationError } from '../../db/errors'
import { requireId, requireNonEmptyString } from '../../db/validate'
import { assertMaterialPathAvailable } from '../materials/materialPathJournal'
import { createAnnotationsRepo } from '../annotations/annotationsRepo'
import { createDrawingsRepo } from './drawingsRepo'

/** A thumbnail never parses the full PDF or loads marks from unrelated pages.
 * Untouched PDFs need no durable binding/recovery copy just to browse them. */
export function createPDFPreviewReader(deps: {
  db: Database
  revisionFor(courseId: string, relPath: string): string
  checkBinding(input: { courseId: string; relPath: string; documentRevision: string }): unknown
}): (input: { courseId: string; relPath: string }) => PDFPreviewSnapshot {
  const drawings = createDrawingsRepo(deps.db)
  const annotations = createAnnotationsRepo(deps.db)
  return input => {
    const courseId = requireId(input.courseId, 'courseId')
    const relPath = requireNonEmptyString(input.relPath, 'relPath')
    if (!/\.pdf$/i.test(relPath)) throw new ValidationError('Preview must point to a PDF')
    assertMaterialPathAvailable(deps.db, courseId, relPath)
    const documentRevision = deps.revisionFor(courseId, relPath)
    const snapshot = deps.db.transaction(() => ({
      documentRevision,
      drawings: drawings.listForFile(courseId, relPath, 1),
      annotations: annotations.listForFile({ courseId, relPath, page: 1 })
    }))()
    if (snapshot.drawings.length || snapshot.annotations.length) deps.checkBinding({ courseId, relPath, documentRevision })
    if (deps.revisionFor(courseId, relPath) !== documentRevision) throw new ValidationError('PDF 원본이 변경됐어요. 미리보기를 다시 불러와 주세요.')
    assertMaterialPathAvailable(deps.db, courseId, relPath)
    return snapshot
  }
}
