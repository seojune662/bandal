import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type RefObject
} from 'react'
import type {
  DrawingClipSource,
  DrawingImageSource
} from '../../../../shared/types/drawing'
import type { PersonalBoardShape } from '../../../../shared/types/whiteboard'
import {
  BANDAL_IMAGE_MIME,
  InkLayer,
  readBandalImageDragData,
  type InkLayerProps
} from '../ink'
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
  /** Needed to resolve image shapes; without it they render as empty boxes. */
  courseId: string
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
  onDropImage: (
    source: DrawingImageSource,
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
  courseId,
  shapes,
  tool,
  viewportRef,
  renderClip,
  onOpenClip,
  onCreate,
  onUpdate,
  onRemove,
  onDropClip,
  onDropImage,
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
    const types = Array.from(event.dataTransfer.types)
    if (
      !types.includes(BANDAL_CLIP_MIME) &&
      !types.includes(BANDAL_IMAGE_MIME)
    ) {
      return
    }
    // `getData` is empty during dragover by spec, so the decision has to come
    // from `types`. Without preventDefault the browser never fires `drop`.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  /** Normalized position inside this page, or null before it is measured. */
  const pointAt = (
    event: ReactDragEvent<HTMLDivElement>
  ): { x: number; y: number } | null => {
    const surface = surfaceRef.current
    if (surface === null) return null
    const bounds = surface.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
    }
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const image = readBandalImageDragData(event.dataTransfer)
    if (image !== null) {
      const point = pointAt(event)
      if (point === null) return
      event.preventDefault()
      onDropImage(image, point, pageNumber)
      return
    }
    const source = readBandalClipDragData(event.dataTransfer)
    if (source === null) return
    const point = pointAt(event)
    if (point === null) return
    event.preventDefault()
    onDropClip(source, point, pageNumber)
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
          courseId={courseId}
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
