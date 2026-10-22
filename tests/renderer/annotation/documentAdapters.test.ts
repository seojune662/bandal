// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ openTabs: { doc: { kind: 'note', payload: { courseId: 'course', relPath: 'note.md' } } } }) } }))
vi.mock('../../../src/renderer/src/features/agent/documentContext', () => ({ readDocumentContexts: () => [] }))
import { documentAnnotationAtPoint, pdfLineAtPoint, targetStillCurrent } from '../../../src/renderer/src/features/annotation/documentAdapters'
function bounds(element: Element, x: number, y: number, width: number, height: number): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) })
}
beforeEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

test('targets a Markdown paragraph in an inactive split pane without changing selection', () => {
  document.body.innerHTML = '<div class="workspace-panel-content" data-content-panel="doc" data-content-course="course" data-panel-instance="instance"><div class="ProseMirror" contenteditable><p>Selected paragraph</p></div></div>'
  const panel = document.querySelector('.workspace-panel-content')!, paragraph = document.querySelector('p')!
  bounds(panel, 200, 80, 600, 500); bounds(paragraph, 220, 120, 500, 40)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => paragraph })
  const range = document.createRange(); range.selectNodeContents(paragraph); getSelection()!.addRange(range)
  const result = documentAnnotationAtPoint({ x: 230, y: 130 }, 'element')!
  expect(result.reference).toMatchObject({ sourcePanelId: 'doc', courseId: 'course', relPath: 'note.md', kind: 'markdown', quote: 'Selected paragraph' })
  expect(getSelection()!.toString()).toBe('Selected paragraph')
  expect(targetStillCurrent(result)).toBe(true)
  paragraph.textContent = 'Edited paragraph'
  expect(targetStillCurrent(result)).toBe(false)
})

test('PDF semantic runs group one visual line and empty pages request manual region selection', () => {
  document.body.innerHTML = '<div class="workspace-panel-content" data-content-panel="doc" data-content-course="course"><section data-pdf-page="2" data-document-revision="r1"><div class="textLayer"><span>First</span><span>line</span><span>Second</span><span>Separate column</span></div></section></div>'
  const panel = document.querySelector('.workspace-panel-content')!, page = document.querySelector<HTMLElement>('section')!, [first, second, third, fourth] = document.querySelectorAll('span')
  bounds(panel, 100, 60, 600, 800); bounds(page, 100, 60, 600, 800)
  bounds(first!, 120, 100, 40, 18); bounds(second!, 166, 101, 50, 18); bounds(third!, 120, 140, 60, 18); bounds(fourth!, 400, 100, 80, 18)
  expect(pdfLineAtPoint(page, { x: 130, y: 110 })).toMatchObject({ quote: 'First line', rect: { x: 120, y: 100, width: 96, height: 19 } })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => page })
  expect(documentAnnotationAtPoint({ x: 130, y: 300 }, 'element')).toMatchObject({ regionRequired: true, reference: { kind: 'pdf', page: 2 } })
})
