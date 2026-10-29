import { createHash } from 'node:crypto'
import { opendir, readFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { ContentSearchIndexStatus } from '../../../shared/types/search'
import { resolveInsideReal } from '../../db/validate'
import { loadPdfTextRuntime } from './pdfTextRuntime'
import { pdfSearchFileIdentity, searchRootPath, type SearchIndex } from './searchIndex'
import type { PdfSearchRequest } from './pdfSearchProtocol'

export interface SearchPdfDocument {
  numPages: number
  getPage(page: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>
  destroy(): Promise<void>
}
export type OpenSearchPdf = (bytes: Uint8Array) => Promise<SearchPdfDocument>
const openPdf: OpenSearchPdf = async bytes => {
  const pdfjs = await loadPdfTextRuntime()
  return pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true,
    useSystemFonts: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    useWasm: false, useWorkerFetch: false, enableXfa: false, stopAtErrors: true }).promise
}

/** Runs only in the PDF utility process. Writes one page at a time and yields
 * between pages, keeping both the database and interactive search lane free. */
export async function indexPdfSearchScope(request: PdfSearchRequest, index: SearchIndex,
  progress: (status: ContentSearchIndexStatus) => void, open: OpenSearchPdf = openPdf): Promise<ContentSearchIndexStatus> {
  const scope = searchRootPath(request.rootRelPath)
  const status: ContentSearchIndexStatus = { phase: 'indexing', processedFiles: 0, totalFiles: 0, indexedPages: 0, failures: [] }
  const report = (): void => progress({ ...status, failures: [...status.failures] })
  const fail = (relPath: string, error: unknown): void => {
    status.failures.push({ relPath, reason: error instanceof Error ? error.message : String(error) })
  }
  index.prune(request.courseId)
  const current = (): void => { if (!index.rootIsCurrent(request.courseId)) throw new Error('과목 폴더 연결이 변경되어 검색 준비를 중지했어요.') }
  report()
  const paths: string[] = []
  const walk = async (rel: string): Promise<void> => {
    try {
      const path = rel ? resolveInsideReal(request.folder, rel) : request.folder
      for await (const entry of await opendir(path)) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
        const child = rel ? posix.join(rel, entry.name) : entry.name
        if (entry.isDirectory()) await walk(child)
        else if (entry.isFile() && /\.pdf$/i.test(entry.name)) paths.push(child)
      }
    } catch (error) { fail(rel, error) }
  }
  await walk(scope)
  current()
  status.totalFiles = paths.length
  report()
  for (const relPath of paths) {
    current()
    status.currentRelPath = relPath
    report()
    let document: SearchPdfDocument | undefined
    let identity: string | undefined
    try {
      const path = resolveInsideReal(request.folder, relPath)
      identity = pdfSearchFileIdentity(path)
      const previous = index.pdfState(request.courseId, relPath)
      if (previous?.identity === identity && previous.status !== 'indexing') {
        status.indexedPages += previous.indexedThrough
        if (previous.error) fail(relPath, previous.error)
        continue
      }
      // Remove stale pages before parsing the replacement, including failure
      // cases such as a previously readable file becoming password protected.
      if (previous?.identity !== identity) index.removePdf(request.courseId, relPath)
      const bytes = await readFile(path)
      const revision = createHash('sha256').update(bytes).digest('hex')
      if (pdfSearchFileIdentity(path) !== identity) throw new Error('PDF가 변경되어 다음 검색에서 다시 색인합니다.')
      document = await open(new Uint8Array(bytes))
      current()
      index.beginPdf(request.courseId, relPath, identity, revision, document.numPages)
      let hasText = false
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber)
        let text: string
        try {
          const content = await page.getTextContent()
          text = content.items.map(item => {
            const run = item as { str?: string; hasEOL?: boolean }
            return typeof run.str === 'string' ? `${run.str}${run.hasEOL ? '\n' : ' '}` : ''
          }).join('').replace(/[\t ]+/gu, ' ').replace(/ *\n */gu, '\n').trim()
        } finally { page.cleanup() }
        if (pdfSearchFileIdentity(path) !== identity) throw new Error('PDF가 변경되어 다음 검색에서 다시 색인합니다.')
        current()
        index.writePdfPage(request.courseId, relPath, identity, revision, pageNumber, text)
        hasText ||= text.length > 0
        status.indexedPages++
        report()
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
      if (!hasText) throw new Error('텍스트가 없는 PDF입니다. 스캔 이미지와 손글씨 OCR은 지원하지 않습니다.')
      index.finishPdf(request.courseId, relPath)
    } catch (error) {
      const reason = error instanceof Error && error.name === 'PasswordException' ? '암호로 잠긴 PDF입니다.' : error instanceof Error ? error.message : String(error)
      fail(relPath, reason)
      try {
        current()
        if (identity && pdfSearchFileIdentity(join(request.folder, relPath)) !== identity) index.removePdf(request.courseId, relPath)
        else index.finishPdf(request.courseId, relPath, reason)
      } catch { if (index.rootIsCurrent(request.courseId)) index.removePdf(request.courseId, relPath) }
    } finally {
      await document?.destroy().catch(() => undefined)
      status.processedFiles++
      report()
    }
  }
  delete status.currentRelPath
  status.phase = status.failures.length ? 'partial' : 'ready'
  report()
  return status
}
