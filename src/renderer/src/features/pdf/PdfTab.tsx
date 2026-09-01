/**
 * [M3-D] PDF viewer tab — dockview panel component for TabKind 'pdf'.
 *
 * Drop-in replacement for the M2 placeholder: reads its TabDescriptor from
 * `props.params.descriptor` (same contract as PlaceholderPanel). Loads the
 * material over `materials:readFile`, renders a virtualized react-pdf page
 * list with text-selection highlighting, an annotation rail, and per-file
 * scroll/zoom memory (session LRU).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Document } from 'react-pdf'
import type { IDockviewPanelProps } from 'dockview'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import './pdfWorker'
import 'react-pdf/dist/Page/TextLayer.css'
import './pdf.css'
import { isTabDescriptor } from '../workspace/tabIdentity'
import { useHasBeenShown } from '../workspace/useHasBeenShown'
import { usePdfDocument } from './usePdfDocument'
import { useAnnotations } from './useAnnotations'
import { usePageTexts, useStaleAnnotationIds } from './usePageTexts'
import { useVisiblePages } from './useVisiblePages'
import { PdfToolbar } from './PdfToolbar'
import { PdfPageView } from './PdfPageView'
import { PdfPreviewPanel } from './PdfPreviewPanel'
import { AnnotationRail } from './AnnotationRail'
import {
  HighlightPopover,
  SelectionPopover,
  WhiteboardPickerPopover,
  type ContentPoint
} from './popovers'
import { askAiAboutAnnotation } from './askAi'
import {
  PDF_ANNOTATION_JUMP_EVENT,
  type PdfAnnotationJumpDetail
} from '../notes/materialLinkNavigation'
import { readPageSelection } from './lib/domSelection'
import { normalizeSelectionRects, rectsBoundingBox } from './lib/annotationGeometry'
import { pdfScrollMemory } from './lib/scrollMemory'
import { useDrawings } from './tools/useDrawings'
import { usePdfToolStore } from './tools/toolStore'
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationRect,
  HighlightColor
} from '../../../../shared/types/annotation'
import type { Drawing } from '../../../../shared/types/drawing'
import type { TabDescriptor } from '../../../../shared/tabs'
import { pdfClipLabel } from './clipTransfer'
import {
  PDF_PAGE_NAVIGATION_EVENT,
  takePdfPageNavigation,
  type PdfPageNavigationTarget
} from './pdfPageNavigation'
import { useWhiteboardClipDelivery } from './useWhiteboardClipDelivery'

const ZOOM_MIN = 0.4
const ZOOM_MAX = 4
const ZOOM_STEP = 1.15
const WHEEL_ZOOM_STEP = 1.05
/** A4 portrait height/width — placeholder ratio before first measure. */
const DEFAULT_PAGE_ASPECT = Math.SQRT2
const PAGE_GUTTER_PX = 48
const MIN_PAGE_WIDTH_PX = 180
const FLASH_DURATION_MS = 1600
const SCROLL_SAVE_DEBOUNCE_MS = 250
const JUMP_TOP_OFFSET_PX = 88

const EMPTY_ANNOTATIONS: Annotation[] = []
const EMPTY_DRAWINGS: Drawing[] = []

interface PendingSelection {
  page: number
  anchor: AnnotationAnchor
  rects: AnnotationRect[]
  position: ContentPoint
}

interface EditPopoverState {
  annotationId: string
  position: ContentPoint
}

function descriptorFromParams(params: unknown): TabDescriptor | null {
  if (typeof params !== 'object' || params === null) return null
  const candidate = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(candidate) ? candidate : null
}

function LoadingSkeleton(): JSX.Element {
  return (
    <div className="pdf-skeleton" aria-label="PDF 불러오는 중" role="status">
      <div className="pdf-skeleton__page" />
      <div className="pdf-skeleton__page" />
    </div>
  )
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div className="pdf-error" role="alert">
      <span className="pdf-error__mark" aria-hidden="true">
        !
      </span>
      <h2>PDF를 열 수 없어요</h2>
      <p>{message}</p>
    </div>
  )
}

function PdfViewer({
  courseId,
  relPath
}: {
  courseId: string
  relPath: string
}): JSX.Element {
  const doc = usePdfDocument(courseId, relPath)
  const annotationsApi = useAnnotations(courseId, relPath)
  const { annotations, byPage } = annotationsApi
  const drawingsApi = useDrawings(courseId, relPath)
  const activeTool = usePdfToolStore((state) => state.activeTool)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const whiteboardClip = useWhiteboardClipDelivery(courseId, contentRef)
  const {
    visiblePages,
    registerPage,
    elementFor,
    pageAtViewportCenter,
    invalidatePageOffsets
  } = useVisiblePages(scrollerRef)

  const [pdfProxy, setPdfProxy] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [pageAspects, setPageAspects] = useState<Map<number, number>>(new Map())
  const [containerWidth, setContainerWidth] = useState(0)
  const [zoom, setZoom] = useState<number>(
    () => pdfScrollMemory.get(courseId, relPath)?.zoom ?? 1
  )
  const [currentPage, setCurrentPage] = useState(1)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isRailOpen, setIsRailOpen] = useState(false)
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null)
  const [editPopover, setEditPopover] = useState<EditPopoverState | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  useEffect(() => {
    if (activeTool !== 'select') {
      setPendingSelection(null)
      setEditPopover(null)
      window.getSelection()?.removeAllRanges()
    }
  }, [activeTool])

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const restoreRef = useRef<{ done: boolean }>({ done: false })
  const pendingCenterRef = useRef<number | null>(null)
  const flashTimer = useRef<number | null>(null)
  const scrollFrame = useRef<number | null>(null)
  const saveTimer = useRef<number | null>(null)

  const annotatedPages = useMemo(
    () => [...byPage.keys()].sort((a, b) => a - b),
    [byPage]
  )
  const pageTexts = usePageTexts(pdfProxy, annotatedPages)
  const staleIds = useStaleAnnotationIds(annotations, pageTexts)
  const pageOfAnnotation = useMemo(() => {
    const map = new Map<string, number>()
    for (const annotation of annotations) map.set(annotation.id, annotation.page)
    return map
  }, [annotations])

  // -- layout: container width ---------------------------------------------
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const observer = new ResizeObserver(() => {
      invalidatePageOffsets()
      setContainerWidth(scroller.clientWidth)
      setCurrentPage(pageAtViewportCenter())
    })
    observer.observe(scroller)
    setContainerWidth(scroller.clientWidth)
    return () => observer.disconnect()
  }, [invalidatePageOffsets, pageAtViewportCenter])

  const defaultAspect = pageAspects.get(1) ?? DEFAULT_PAGE_ASPECT
  const pageWidth = Math.max(
    MIN_PAGE_WIDTH_PX,
    Math.round((containerWidth - PAGE_GUTTER_PX) * zoom)
  )

  // Page boxes only move when document layout changes. Rebuild their cached
  // centers here; ordinary scroll frames only perform a binary search.
  useLayoutEffect(() => {
    invalidatePageOffsets()
    if (numPages > 0) setCurrentPage(pageAtViewportCenter())
  }, [
    pageWidth,
    pageAspects,
    numPages,
    invalidatePageOffsets,
    pageAtViewportCenter
  ])

  // -- zoom -----------------------------------------------------------------
  const applyZoom = useCallback((next: number): void => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    const scroller = scrollerRef.current
    if (scroller !== null && scroller.scrollHeight > 0) {
      pendingCenterRef.current =
        (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight
    }
    setPendingSelection(null)
    setZoom(clamped)
  }, [])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const fraction = pendingCenterRef.current
    if (scroller === null || fraction === null) return
    pendingCenterRef.current = null
    scroller.scrollTop = fraction * scroller.scrollHeight - scroller.clientHeight / 2
    setCurrentPage(pageAtViewportCenter())
  }, [zoom, pageAtViewportCenter])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP
      applyZoom(zoomRef.current * factor)
    }
    scroller.addEventListener('wheel', handleWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', handleWheel)
  }, [applyZoom])

  // -- scroll: current page, memory save ------------------------------------
  const persistScroll = useCallback((): void => {
    const scroller = scrollerRef.current
    if (scroller === null || scroller.scrollHeight <= 0) return
    pdfScrollMemory.set(courseId, relPath, {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      zoom: zoomRef.current
    })
  }, [courseId, relPath])

  const handleScroll = useCallback((): void => {
    if (scrollFrame.current === null) {
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null
        setCurrentPage(pageAtViewportCenter())
      })
    }
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(persistScroll, SCROLL_SAVE_DEBOUNCE_MS)
  }, [pageAtViewportCenter, persistScroll])

  useEffect(() => {
    return () => {
      persistScroll()
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [persistScroll])

  // -- scroll restore (once per document) -----------------------------------
  useLayoutEffect(() => {
    if (restoreRef.current.done || numPages === 0 || containerWidth === 0) return
    const scroller = scrollerRef.current
    if (scroller === null) return
    restoreRef.current.done = true
    const entry = pdfScrollMemory.get(courseId, relPath)
    if (entry === null || entry.scrollHeight <= 0) return
    requestAnimationFrame(() => {
      const target = scrollerRef.current
      if (target === null) return
      target.scrollTop =
        entry.scrollTop * (target.scrollHeight / entry.scrollHeight)
      setCurrentPage(pageAtViewportCenter())
    })
  }, [numPages, containerWidth, courseId, relPath, pageAtViewportCenter])

  // -- selection → mini toolbar ---------------------------------------------
  const captureSelection = useCallback((): void => {
    const content = contentRef.current
    if (content === null) return
    const selection = readPageSelection(window.getSelection())
    if (selection === null || !content.contains(selection.pageElement)) {
      setPendingSelection(null)
      return
    }
    const pageBox = selection.pageElement.getBoundingClientRect()
    const rects = normalizeSelectionRects(selection.clientRects, {
      left: pageBox.left,
      top: pageBox.top,
      width: pageBox.width,
      height: pageBox.height
    })
    if (rects.length === 0) {
      setPendingSelection(null)
      return
    }
    const contentBox = content.getBoundingClientRect()
    const bounds = selection.boundsClientRect
    setEditPopover(null)
    setPendingSelection({
      page: selection.page,
      anchor: selection.anchor,
      rects,
      position: {
        left: bounds.left + bounds.width / 2 - contentBox.left,
        top: bounds.top + bounds.height - contentBox.top + 10
      }
    })
  }, [])

  // Document-level: selection drags often end outside the scroller.
  useEffect(() => {
    const handleMouseUp = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.pdf-popover') !== null) {
        return
      }
      // Let the browser finalize the selection first.
      window.setTimeout(captureSelection, 0)
    }
    document.addEventListener('mouseup', handleMouseUp)
    return () => document.removeEventListener('mouseup', handleMouseUp)
  }, [captureSelection])

  const flash = useCallback((id: string): void => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    setFlashId(id)
    flashTimer.current = window.setTimeout(() => setFlashId(null), FLASH_DURATION_MS)
  }, [])

  const createHighlight = useCallback(
    async (color: HighlightColor): Promise<void> => {
      if (pendingSelection === null) return
      const created = await annotationsApi.create({
        courseId,
        relPath,
        page: pendingSelection.page,
        color,
        rects: pendingSelection.rects,
        anchor: pendingSelection.anchor,
        comment: null
      })
      setPendingSelection(null)
      window.getSelection()?.removeAllRanges()
      if (created !== null) flash(created.id)
    },
    [pendingSelection, annotationsApi, courseId, relPath, flash]
  )

  // -- highlight click → edit popover ---------------------------------------
  const handleAnnotationClick = useCallback(
    (annotation: Annotation, clientX: number, clientY: number): void => {
      const content = contentRef.current
      if (content === null) return
      const contentBox = content.getBoundingClientRect()
      setPendingSelection(null)
      setEditPopover({
        annotationId: annotation.id,
        position: {
          left: clientX - contentBox.left,
          top: clientY - contentBox.top + 14
        }
      })
    },
    []
  )

  const editedAnnotation = useMemo(
    () =>
      editPopover === null
        ? null
        : annotations.find((entry) => entry.id === editPopover.annotationId) ?? null,
    [editPopover, annotations]
  )

  // -- [M5] annotation → AI tutor -------------------------------------------
  const askAi = useCallback(
    (annotation: Annotation): void => {
      askAiAboutAnnotation(courseId, annotation)
    },
    [courseId]
  )

  const sendToNote = useCallback(
    async (
      annotation: Annotation,
      comment: string | null
    ): Promise<void> => {
      try {
        const result = await invoke('link:sendHighlightToNote', {
          courseId,
          relPath,
          page: annotation.page,
          quote: annotation.anchor.quote,
          comment,
          annotationId: annotation.id
        })
        showToast(`필기로 보냈어요: ${result.relPath}`)
      } catch (error) {
        console.error('[Bandal] 하이라이트를 필기로 보내지 못했습니다.', error)
        showToast('하이라이트를 필기로 보내지 못했습니다.', 'danger')
      }
    },
    [courseId, relPath]
  )

  // -- rail jump ------------------------------------------------------------
  const jumpToAnnotation = useCallback(
    (annotation: Annotation): boolean => {
      const scroller = scrollerRef.current
      const element = elementFor(annotation.page)
      if (scroller === null || element === null) return false
      const scrollerBox = scroller.getBoundingClientRect()
      const elementBox = element.getBoundingClientRect()
      const rectY = annotation.rects[0]?.y ?? 0
      scroller.scrollTo({
        top:
          elementBox.top -
          scrollerBox.top +
          scroller.scrollTop +
          rectY * elementBox.height -
          JUMP_TOP_OFFSET_PX,
        behavior: 'smooth'
      })
      flash(annotation.id)
      return true
    },
    [elementFor, flash]
  )

  const jumpToPage = useCallback(
    (page: number): void => {
      const clamped = Math.min(Math.max(1, page), Math.max(1, numPages))
      const scroller = scrollerRef.current
      const element = elementFor(clamped)
      if (scroller === null || element === null) return
      const scrollerBox = scroller.getBoundingClientRect()
      const elementBox = element.getBoundingClientRect()
      scroller.scrollTop =
        elementBox.top - scrollerBox.top + scroller.scrollTop - 12
      setCurrentPage(clamped)
    },
    [elementFor, numPages]
  )

  // A note link can activate an existing panel or mount a fresh one. The
  // sender retries this event until annotations and page boxes are ready;
  // once handled, this uses the same precise scroll + flash path as the rail.
  useEffect(() => {
    const handleLinkedAnnotation = (rawEvent: Event): void => {
      if (!(rawEvent instanceof CustomEvent)) return
      const detail = rawEvent.detail as Partial<PdfAnnotationJumpDetail> | null
      if (
        detail === null ||
        detail.courseId !== courseId ||
        detail.relPath !== relPath ||
        typeof detail.annotationId !== 'string'
      ) {
        return
      }
      const annotation = annotations.find(
        (entry) => entry.id === detail.annotationId
      )
      if (annotation !== undefined && jumpToAnnotation(annotation)) {
        detail.handled = true
      }
    }
    window.addEventListener(PDF_ANNOTATION_JUMP_EVENT, handleLinkedAnnotation)
    return () =>
      window.removeEventListener(
        PDF_ANNOTATION_JUMP_EVENT,
        handleLinkedAnnotation
      )
  }, [annotations, courseId, jumpToAnnotation, relPath])

  useEffect(() => {
    if (numPages === 0) return
    let frame: number | null = null
    const navigate = (page: number): void => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        jumpToPage(page)
      })
    }
    const handleNavigation = (event: Event): void => {
      const detail = (event as CustomEvent<PdfPageNavigationTarget>).detail
      if (detail.courseId !== courseId || detail.relPath !== relPath) return
      navigate(takePdfPageNavigation(courseId, relPath) ?? detail.page)
    }
    window.addEventListener(PDF_PAGE_NAVIGATION_EVENT, handleNavigation)
    const pendingPage = takePdfPageNavigation(courseId, relPath)
    if (pendingPage !== null) navigate(pendingPage)
    return () => {
      window.removeEventListener(PDF_PAGE_NAVIGATION_EVENT, handleNavigation)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [courseId, jumpToPage, numPages, relPath])

  const handleAspect = useCallback((page: number, aspect: number): void => {
    setPageAspects((current) => {
      const previous = current.get(page)
      if (previous !== undefined && Math.abs(previous - aspect) < 0.001) {
        return current
      }
      const next = new Map(current)
      next.set(page, aspect)
      return next
    })
  }, [])

  const handleDocumentLoad = useCallback((pdf: PDFDocumentProxy): void => {
    setPdfProxy(pdf)
    setNumPages(pdf.numPages)
  }, [])

  if (doc.status === 'error') {
    return <ErrorPanel message={doc.message} />
  }

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div className="pdf-tab" data-tool={activeTool}>
      <PdfToolbar
        currentPage={currentPage}
        numPages={numPages}
        zoomPercent={zoomPercent}
        isPreviewOpen={isPreviewOpen}
        isRailOpen={isRailOpen}
        annotationCount={annotations.length}
        courseId={courseId}
        relPath={relPath}
        drawingsApi={drawingsApi}
        onJumpToPage={jumpToPage}
        onZoomIn={() => applyZoom(zoom * ZOOM_STEP)}
        onZoomOut={() => applyZoom(zoom / ZOOM_STEP)}
        onZoomFit={() => applyZoom(1)}
        onTogglePreview={() => setIsPreviewOpen((open) => !open)}
        onToggleRail={() => setIsRailOpen((open) => !open)}
      />
      <div className="pdf-tab__main">
        {isPreviewOpen && (
          <PdfPreviewPanel
            pdf={pdfProxy}
            numPages={numPages}
            currentPage={currentPage}
            onJump={jumpToPage}
          />
        )}
        <div
          ref={scrollerRef}
          className="pdf-scroller"
          onScroll={handleScroll}
        >
          <div ref={contentRef} className="pdf-content">
            {doc.status === 'loading' ? (
              <LoadingSkeleton />
            ) : (
              <Document
                file={doc.dataUrl}
                loading={<LoadingSkeleton />}
                error={
                  <ErrorPanel message="PDF 파일을 해석하지 못했어요. 파일이 손상되었을 수 있어요." />
                }
                onLoadSuccess={handleDocumentLoad}
                externalLinkTarget="_blank"
              >
                {Array.from({ length: numPages }, (_, index) => {
                  const pageNumber = index + 1
                  const pageAnnotations =
                    byPage.get(pageNumber) ?? EMPTY_ANNOTATIONS
                  const pageDrawings =
                    drawingsApi.byPage.get(pageNumber) ?? EMPTY_DRAWINGS
                  const idOnPage = (id: string | null): string | null =>
                    id !== null && pageOfAnnotation.get(id) === pageNumber
                      ? id
                      : null
                  return (
                    <PdfPageView
                      key={pageNumber}
                      pageNumber={pageNumber}
                      width={pageWidth}
                      aspect={pageAspects.get(pageNumber) ?? defaultAspect}
                      isVisible={visiblePages.has(pageNumber)}
                      clipDragEnabled={activeTool === 'select'}
                      onSendClip={(source, clientX, clientY) => {
                        setPendingSelection(null)
                        setEditPopover(null)
                        void whiteboardClip.send(source, clientX, clientY)
                      }}
                      annotations={pageAnnotations}
                      drawings={pageDrawings}
                      drawingsLoading={drawingsApi.loading}
                      courseId={courseId}
                      relPath={relPath}
                      staleIds={staleIds}
                      hoveredId={idOnPage(hoveredId)}
                      activeId={idOnPage(editPopover?.annotationId ?? null)}
                      flashId={idOnPage(flashId)}
                      registerRef={registerPage(pageNumber)}
                      onAspect={handleAspect}
                      onAnnotationClick={handleAnnotationClick}
                      onHoverChange={setHoveredId}
                      onDrawingCreate={drawingsApi.create}
                      onDrawingUpdate={drawingsApi.update}
                      onDrawingRemove={drawingsApi.remove}
                    />
                  )
                })}
              </Document>
            )}

            {pendingSelection !== null && (
              <SelectionPopover
                position={pendingSelection.position}
                clipSource={{
                  relPath,
                  page: pendingSelection.page,
                  crop: rectsBoundingBox(pendingSelection.rects),
                  label: pdfClipLabel(relPath, pendingSelection.page, true)
                }}
                onPick={(color) => void createHighlight(color)}
                onDismiss={() => setPendingSelection(null)}
              />
            )}
            {editPopover !== null && editedAnnotation !== null && (
              <HighlightPopover
                // Remount per highlight so an unsaved memo draft can never
                // follow the popover onto a different annotation.
                key={editedAnnotation.id}
                annotation={editedAnnotation}
                position={editPopover.position}
                isStale={staleIds.has(editedAnnotation.id)}
                onChangeColor={(color) =>
                  void annotationsApi.update({ id: editedAnnotation.id, color })
                }
                onSaveComment={(comment) =>
                  void annotationsApi.update({ id: editedAnnotation.id, comment })
                }
                onDelete={() => {
                  void annotationsApi.remove(editedAnnotation.id)
                  setEditPopover(null)
                }}
                onDismiss={() => setEditPopover(null)}
                onAskAi={(draftComment) => {
                  askAi({ ...editedAnnotation, comment: draftComment })
                  setEditPopover(null)
                }}
                onSendToNote={(draftComment) => {
                  void sendToNote(editedAnnotation, draftComment)
                  setEditPopover(null)
                }}
              />
            )}
            {whiteboardClip.picker !== null && (
              <WhiteboardPickerPopover
                boards={whiteboardClip.picker.boards}
                position={whiteboardClip.picker.position}
                onPick={whiteboardClip.choose}
                onCreate={() => { void whiteboardClip.create() }}
                onDismiss={whiteboardClip.dismiss}
              />
            )}
          </div>
        </div>

        {isRailOpen && (
          <AnnotationRail
            annotations={annotations}
            staleIds={staleIds}
            activeId={editPopover?.annotationId ?? null}
            error={annotationsApi.error}
            onJump={jumpToAnnotation}
            onAskAi={askAi}
            onClose={() => setIsRailOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

/** Dockview panel entry — same props contract as PlaceholderPanel. */
export default function PdfTab(props: IDockviewPanelProps): JSX.Element {
  const hasBeenShown = useHasBeenShown(props.api)
  const descriptor = descriptorFromParams(props.params)
  if (descriptor === null || descriptor.kind !== 'pdf') {
    return <div className="workspace-panel" data-kind="unknown" />
  }
  if (!hasBeenShown) {
    return (
      <div className="workspace-panel pdf-panel" data-kind="pdf">
        <LoadingSkeleton />
      </div>
    )
  }
  const { courseId, relPath } = descriptor.payload
  return (
    <div className="workspace-panel pdf-panel" data-kind="pdf">
      <PdfViewer
        key={`${courseId}:${relPath}`}
        courseId={courseId}
        relPath={relPath}
      />
    </div>
  )
}
