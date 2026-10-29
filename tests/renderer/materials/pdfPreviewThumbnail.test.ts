// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PDFPreviewSnapshot } from '../../../src/shared/types/pdfPreview'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getDocument: vi.fn(), destroy: vi.fn(), render: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))
vi.mock('react-pdf', () => ({ pdfjs: { getDocument: mocks.getDocument } }))
vi.mock('../../../src/renderer/src/features/pdf/pdfWorker', () => ({ configurePdfWorker: vi.fn() }))
import { loadPdfPreviewThumbnail } from '../../../src/renderer/src/features/materials/preview/mediaThumbnails'

const snapshot = (documentRevision = 'a'.repeat(64)): PDFPreviewSnapshot => ({ documentRevision, drawings: [], annotations: [] })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.destroy.mockResolvedValue(undefined)
  mocks.render.mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
  mocks.getDocument.mockImplementation(() => ({ destroy: mocks.destroy, promise: Promise.resolve({ numPages: 5,
    getMetadata: async () => ({ info: { Keywords: 'bandal-note paper=grid surface=dark' } }),
    getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 300 * scale, height: 400 * scale }), render: mocks.render })
  }) }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,paper')
})
afterEach(() => vi.restoreAllMocks())

test('an untouched PDF reads its live media URL and verifies the original before caching', async () => {
  mocks.invoke.mockResolvedValue(snapshot())
  const result = await loadPdfPreviewThumbnail('c', 'unopened.pdf', snapshot(), new AbortController().signal)
  expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({ url: 'bandal-media://material/c/unopened.pdf' }))
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('pdf:previewSnapshot', { courseId: 'c', relPath: 'unopened.pdf' })
  expect(result).toMatchObject({ dataUrl: 'data:image/png;base64,paper', pageCount: 5, surface: 'dark' })
  await loadPdfPreviewThumbnail('c', 'unopened.pdf', snapshot(), new AbortController().signal)
  expect(mocks.getDocument).toHaveBeenCalledTimes(1)
})

test('a changed original is rejected and its pixels never enter the revision cache', async () => {
  mocks.invoke.mockResolvedValueOnce(snapshot('b'.repeat(64))).mockResolvedValueOnce(snapshot())
  await expect(loadPdfPreviewThumbnail('c', 'changing.pdf', snapshot(), new AbortController().signal)).rejects.toThrow('PDF changed')
  await loadPdfPreviewThumbnail('c', 'changing.pdf', snapshot(), new AbortController().signal)
  expect(mocks.render).toHaveBeenCalledTimes(2)
  expect(mocks.destroy).toHaveBeenCalledTimes(2)
})

test('saved annotations use the immutable original revision URL', async () => {
  const value: PDFPreviewSnapshot = { ...snapshot(), annotations: [{ id: 'a', courseId: 'c', relPath: 'annotated.pdf', page: 1, color: 'pink', rects: [{ x: .1, y: .2, width: .3, height: .1 }], anchor: { quote: '', prefix: '', suffix: '' }, comment: null, createdAt: '', updatedAt: '' }] }
  await loadPdfPreviewThumbnail('c', 'annotated.pdf', value, new AbortController().signal)
  expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({ url: `bandal-media://material/c/annotated.pdf?revision=${value.documentRevision}` }))
  expect(mocks.invoke).not.toHaveBeenCalled()
})
