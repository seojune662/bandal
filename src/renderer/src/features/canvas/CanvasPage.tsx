import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type RefObject
} from 'react'
import type {
  DrawingClipSource
} from '../../../../shared/types/drawing'
import type { PersonalBoardShape } from '../../../../shared/types/whiteboard'
import { InkLayer, type InkLayerProps } from '../ink'
import {
  BANDAL_CLIP_MIME,
  readBandalClipDragData
} from '../pdf/clipTransfer'

export const DEFAULT_PAGE_ASPECT = Math.SQRT2

interface PageSize {
  width: number
  height: number
}

interface CanvasPageProps {
  pageNumber: number
  boardTitle: string
  shapes: readonly PersonalBoardShape[]
  tool: InkLayerProps['tool']
  viewportRef: RefObject<HTMLDivElement>
  renderClip: NonNullable<InkLayerProps['renderClip']>
  onOpenClip: NonNullable<InkLayerProps['onOpenClip']>
  onCreate: InkLayerProps['onCreate']
  onUpdate: InkLayerProps['onUpdate']
  onRemove: InkLayerProps['onRemove']
  onDropClip: (
    source: DrawingClipSource,
    point: { x: number; y: number },
    page: number
  ) => void
  onActivate: (page: number) => void
  onVisibilityChange: (page: number, ratio: number) => void
}

function usePageSize(ref: RefObject<HTMLDivElement>): PageSize {
  const [size, setSize] = useState<PageSize>({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const update = (width: number, height: number): void => {
      setSize((current) => current.width === width && current.height === height
        ? current
        : { width, height })
    }
    const bounds = element.getBoundingClientRect()
    update(bounds.width, bounds.height)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) {
        update(entry.contentRect.width, entry.contentRect.height)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}

export function CanvasPage({
  pageNumber,
  boardTitle,
  shapes,
  tool,
  viewportRef,
  renderClip,
  onOpenClip,
  onCreate,
  onUpdate,
  onRemove,
  onDropClip,
  onActivate,
  onVisibilityChange
}: CanvasPageProps): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const size = usePageSize(surfaceRef)

  useEffect(() => {
    const surface = surfaceRef.current
    const viewport = viewportRef.current
    if (surface === null || viewport === null) return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      onVisibilityChange(pageNumber, entry?.intersectionRatio ?? 0)
    }, {
      root: viewport,
      threshold: [0, 0.25, 0.5, 0.75, 1]
    })
    observer.observe(surface)
    return () => {
      observer.disconnect()
      onVisibilityChange(pageNumber, 0)
    }
  }, [onVisibilityChange, pageNumber, viewportRef])

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!Array.from(event.dataTransfer.types).includes(BANDAL_CLIP_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const source = readBandalClipDragData(event.dataTransfer)
    const surface = surfaceRef.current
    if (source === null || surface === null) return
    const bounds = surface.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    event.preventDefault()
    onDropClip(source, {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
    }, pageNumber)
  }

  return (
    <article className="canvas-tab__page" data-page-number={pageNumber}>
      <div className="canvas-tab__page-number">페이지 {pageNumber}</div>
      <div
        ref={surfaceRef}
        className="canvas-tab__surface"
        onPointerDown={() => onActivate(pageNumber)}
        onFocusCapture={() => onActivate(pageNumber)}
        onDragEnter={() => onActivate(pageNumber)}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <InkLayer
          aspect={DEFAULT_PAGE_ASPECT}
          baseWidthPx={size.width}
          shapes={shapes}
          tool={tool}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onRemove={onRemove}
          clampToBounds={true}
          deferTextCreation
          ariaLabel={`${boardTitle} ${pageNumber}페이지 캔버스`}
          className="canvas-tab__ink-layer"
          renderClip={renderClip}
          onOpenClip={onOpenClip}
        />
      </div>
    </article>
  )
}
