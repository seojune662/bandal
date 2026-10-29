import { openDatabase } from '../../db/database'
import { createSearchIndex } from './searchIndex'
import { indexPdfSearchScope } from './pdfSearchIndexer'
import type { PdfSearchRequest } from './pdfSearchProtocol'

process.parentPort?.on('message', ({ data }: { data: { id: number; request: PdfSearchRequest } }) => {
  void (async () => {
    const db = openDatabase(data.request.dbPath, false)
    try {
      const index = createSearchIndex(db, { getCourseFolder: () => data.request.folder, refreshOnQuery: false })
      const status = await indexPdfSearchScope(data.request, index, status => process.parentPort?.postMessage({ id: data.id, status }))
      process.parentPort?.postMessage({ id: data.id, status, done: true })
    } finally { db.close() }
  })().catch(error => process.parentPort?.postMessage({ id: data.id, done: true,
    status: { phase: 'partial', processedFiles: 0, totalFiles: 0, indexedPages: 0,
      failures: [{ relPath: data.request.rootRelPath, reason: error instanceof Error ? error.message : String(error) }] } }))
})
