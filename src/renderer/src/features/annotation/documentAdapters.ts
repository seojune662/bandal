import type { AnnotationBounds, AnnotationMode, AnnotationReference } from '../../../../shared/types/chatAnnotation'
import { readDocumentContexts } from '../agent/documentContext'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { intersectBounds, normalizeBounds, sourceFingerprint, unionBounds } from './geometry'

export interface DocumentAnnotationTarget {
  element: HTMLElement
  panel: HTMLElement
  rect: AnnotationBounds
  sourceRect: AnnotationBounds
  reference: Omit<AnnotationReference, 'id' | 'capturedAt' | 'imageDataUrl'>
  regionRequired: boolean
  fingerprint: string
}
const visibleRect = (element: Element): AnnotationBounds => element.getBoundingClientRect()
const viewport = (): AnnotationBounds => ({ x: 0, y: 0, width: innerWidth, height: innerHeight })

/** Text-layer spans are PDF text runs; group the pointed line without replacing selection. */
export function pdfLineAtPoint(page: HTMLElement, point: { x: number; y: number }): { rect: AnnotationBounds; quote: string; element: HTMLElement } | null {
  const runs = [...page.querySelectorAll<HTMLElement>('.textLayer span:not(.markedContent)')].filter(element => (element.textContent ?? '').trim())
  const hit = runs.find(element => { const r = visibleRect(element); return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height })
  if (!hit) return null
  const first = visibleRect(hit)
  const sameRow = runs.filter(element => { const r = visibleRect(element); return Math.abs(r.y - first.y) < Math.max(3, first.height * .45) && r.height > 0 }).sort((a, b) => visibleRect(a).x - visibleRect(b).x)
  let start = sameRow.indexOf(hit), end = start
  const maxGap = Math.max(24, first.height * 2)
  const gap = (a: HTMLElement, b: HTMLElement): number => { const left = visibleRect(a), right = visibleRect(b); return right.x - left.x - left.width }
  while (start > 0 && gap(sameRow[start - 1]!, sameRow[start]!) <= maxGap) start--
  while (end < sameRow.length - 1 && gap(sameRow[end]!, sameRow[end + 1]!) <= maxGap) end++
  const line = sameRow.slice(start, end + 1)
  const rect = unionBounds(line.map(visibleRect))
  return rect ? { rect, quote: line.map(element => element.textContent ?? '').join(' ').slice(0, 8000), element: hit } : null
}

function epoch(panel: HTMLElement, element: HTMLElement, quote: string): string {
  return `${panel.dataset.panelInstance ?? panel.dataset.contentPanel}:${sourceFingerprint(`${element.closest('[data-document-revision]')?.getAttribute('data-document-revision') ?? ''}|${quote}|${element instanceof HTMLImageElement ? element.currentSrc || element.src : ''}`)}`
}

export function documentAnnotationAtPoint(point: { x: number; y: number }, mode: AnnotationMode): DocumentAnnotationTarget | null {
  const pointed = document.elementFromPoint(point.x, point.y)
  const panel = pointed?.closest<HTMLElement>('.workspace-panel-content:not([hidden]):not([inert])')
  if (!pointed || !panel || pointed.closest('.browser-toolbar,.file-toolbar,.pdf-toolbar,.note-toolbar,button,input,textarea,[data-annotation-ui]')) return null
  const panelId = panel.dataset.contentPanel
  if (!panelId) return null
  const descriptor = useWorkspaceStore.getState().openTabs[panelId]
  if (descriptor?.kind === 'browser' || descriptor?.kind === 'chat') return null
  const context = readDocumentContexts().find(item => item.documentId === panelId)
  const payload = descriptor?.payload as { courseId?: string; relPath?: string } | undefined
  const courseId = context?.courseId ?? payload?.courseId ?? panel.dataset.contentCourse
  if (!courseId) return null
  const relPath = context?.relPath ?? payload?.relPath
  const title = context?.title ?? relPath?.split('/').pop() ?? '선택한 부분'
  const pdfPage = pointed.closest<HTMLElement>('[data-pdf-page]')
  const image = pointed.closest<HTMLImageElement>('.file-panel img,.image-viewer img,.milkdown img,.ProseMirror img')
  const editor = pointed.closest<HTMLElement>('.ProseMirror,.markdown-view,.learning-reader,.learning-article')
  let element: HTMLElement, sourceRect: AnnotationBounds, rect: AnnotationBounds, quote = '', kind: AnnotationReference['kind'], regionRequired = mode === 'region'
  if (pdfPage) {
    const line = mode === 'element' ? pdfLineAtPoint(pdfPage, point) : null
    element = line?.element ?? pdfPage; sourceRect = visibleRect(pdfPage); rect = line?.rect ?? sourceRect
    quote = line?.quote ?? ''; kind = 'pdf'; regionRequired ||= !line
  } else if (image) {
    element = image; sourceRect = visibleRect(image); rect = sourceRect; kind = 'image'; quote = image.alt
  } else if (editor) {
    element = pointed.closest<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,table,figure') ?? editor
    if (!editor.contains(element)) element = editor
    sourceRect = visibleRect(panel); rect = visibleRect(element); kind = 'markdown'; quote = (element.innerText || element.textContent || '').trim().slice(0, 8000)
  } else if (mode === 'region' && pointed.closest('.workspace-panel,.file-panel,.pdf-tab,.note-tab')) {
    element = panel; sourceRect = visibleRect(panel); rect = sourceRect; kind = 'region'
  } else return null
  const clipped = intersectBounds(rect, visibleRect(panel))
  const visible = clipped && intersectBounds(clipped, viewport())
  if (!visible || visible.width < 2 || visible.height < 2) return null
  const fingerprint = epoch(panel, element, quote)
  return { element, panel, rect: visible, sourceRect, regionRequired, fingerprint,
    reference: { courseId, sourcePanelId: panelId, title, kind, ...(relPath ? { relPath } : {}), ...(pdfPage ? { page: Number(pdfPage.dataset.pdfPage) } : {}), ...(quote ? { quote } : {}), rect: normalizeBounds(visible, sourceRect), documentEpoch: fingerprint } }
}

export function targetStillCurrent(target: DocumentAnnotationTarget): boolean {
  if (!target.element.isConnected || target.panel.closest('[hidden],[inert]')) return false
  const quote = target.reference.kind === 'markdown' ? (target.element.innerText || target.element.textContent || '').trim().slice(0, 8000) : target.reference.quote ?? ''
  return epoch(target.panel, target.element, quote) === target.fingerprint
}
