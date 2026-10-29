// Shared by learning extraction and the isolated content-search process.
class TextOnlyDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  constructor(transform?: unknown) {
    if (transform !== undefined) throw new Error('PDF 텍스트 추출에서는 그리기 변환을 사용할 수 없어요.')
  }
}
let runtime: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | undefined
export function loadPdfTextRuntime(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  return runtime ??= (async () => {
    const globals = globalThis as Record<string, unknown>
    globals['DOMMatrix'] ??= TextOnlyDOMMatrix
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    globals['pdfjsWorker'] = { WorkerMessageHandler: worker.WorkerMessageHandler }
    return import('pdfjs-dist/legacy/build/pdf.mjs')
  })()
}
