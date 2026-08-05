/**
 * One virtualized PDF page: renders the real pdf.js page only when near the
 * viewport (placeholder box with the measured aspect ratio otherwise), plus
 * the absolutely-positioned highlight overlay.
 *
 * Highlight rects sit between the canvas and the text layer (z-index 1 vs
 * the text layer's 2) with pointer-events disabled, so text selection is
 * never blocked; clicks and hovers are resolved by hit-testing in the
 * wrapper's handlers.
 */

import { memo, useCallback, useRef } from 'react'
import { Page } from 'react-pdf'
import { rectsContainPoint } from './lib/annotationGeometry'
import type { Annotation } from '../../../../shared/types/annotation'

export interface PdfPageViewProps {
  pageNumber: number
  /** Rendered CSS width of the page in px. */
  width: number
  /** height / width — placeholder sizing before the page ever renders. */
  aspect: number
  isVisible: boolean
  annotations: Annotation[]
  staleIds: Set<string>
  hoveredId: string | null
  activeId: string | null
  flashId: string | null
  registerRef: (element: HTMLElement | null) => void
  onAspect: (page: number, aspect: number) => void
  /** Click resolved to an annotation (only fired when selection is empty). */
  onAnnotationClick: (annotation: Annotation, clientX: number, clientY: number) => void
  onHoverChange: (id: string | null) => void
}

function annotationAtPoint(
  annotations: Annotation[],
  element: HTMLElement,
  clientX: number,
  clientY: number
): Annotation | null {
  const box = element.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  const x = (clientX - box.left) / box.width
  const y = (clientY - box.top) / box.height
  // Last match wins → later (newer) annotations sit visually on top.
  let hit: Annotation | null = null
  for (const annotation of annotations) {
    if (rectsContainPoint(annotation.rects, x, y)) hit = annotation
  }
  return hit
}

function highlightClass(
  annotation: Annotation,
  props: Pick<PdfPageViewProps, 'hoveredId' | 'activeId' | 'flashId' | 'staleIds'>
): string {
  let className = 'pdf-highlight'
  if (annotation.id === props.hoveredId) className += ' is-hovered'
  if (annotation.id === props.activeId) className += ' is-active'
  if (annotation.id === props.flashId) className += ' is-flashing'
  if (props.staleIds.has(annotation.id)) className += ' is-stale'
  return className
}

function PdfPageViewInner(props: PdfPageViewProps): JSX.Element {
  const {
    pageNumber,
    width,
    aspect,
    isVisible,
    annotations,
    registerRef,
    onAspect,
    onAnnotationClick,
    onHoverChange
  } = props

  const wrapperRef = useRef<HTMLElement | null>(null)
  const hoverFrame = useRef<number | null>(null)

  const setRefs = useCallback(
    (element: HTMLElement | null): void => {
      wrapperRef.current = element
      registerRef(element)
    },
    [registerRef]
  )

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      const selection = window.getSelection()
      if (selection !== null && !selection.isCollapsed) return
      const element = wrapperRef.current
      if (element === null) return
      const hit = annotationAtPoint(annotations, element, event.clientX, event.clientY)
      if (hit !== null) onAnnotationClick(hit, event.clientX, event.clientY)
    },
    [annotations, onAnnotationClick]
  )

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLElement>): void => {
      if (annotations.length === 0) return
      const { clientX, clientY } = event
      if (hoverFrame.current !== null) return
      hoverFrame.current = requestAnimationFrame(() => {
        hoverFrame.current = null
        const element = wrapperRef.current
        if (element === null) return
        const hit = annotationAtPoint(annotations, element, clientX, clientY)
        onHoverChange(hit?.id ?? null)
      })
    },
    [annotations, onHoverChange]
  )

  const handleMouseLeave = useCallback((): void => {
    onHoverChange(null)
  }, [onHoverChange])

  const height = Math.round(width * aspect)

  return (
    <section
      ref={setRefs}
      className="pdf-page"
      data-pdf-page={pageNumber}
      aria-label={`${pageNumber} 페이지`}
      style={{ width, minHeight: height }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {isVisible ? (
        <>
          <Page
            pageNumber={pageNumber}
            width={width}
            renderTextLayer
            renderAnnotationLayer={false}
            loading={<div className="pdf-page__placeholder" style={{ height }} />}
            error={<div className="pdf-page__placeholder" style={{ height }} />}
            onLoadSuccess={(page) => {
              if (page.width > 0) onAspect(pageNumber, page.height / page.width)
            }}
          />
          <div className="pdf-highlight-layer" aria-hidden="true">
            {annotations.map((annotation) =>
              annotation.rects.map((rect, index) => (
                <div
                  key={`${annotation.id}:${index}`}
                  className={highlightClass(annotation, props)}
                  data-color={annotation.color}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`
                  }}
                />
              ))
            )}
          </div>
        </>
      ) : (
        <div className="pdf-page__placeholder" style={{ height }} />
      )}
    </section>
  )
}

export const PdfPageView = memo(PdfPageViewInner)
