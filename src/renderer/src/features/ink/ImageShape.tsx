import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  DrawingBox,
  DrawingImageSource,
  DrawingShape
} from '../../../../shared/types/drawing'
import { invoke } from '../../lib/ipc'
import { imageDataUrl } from '../image/imageSource'
import { foreignObjectContentStyle } from './foreignObjectScale'
import type { ResizeHandle } from './inkGeometry'
import { ResizeHandles } from './ResizeHandles'

interface ImageShapeProps {
  shape: DrawingShape
  box: DrawingBox
  aspect: number
  /** Pixel width of the surface; CSS inside the foreignObject is scaled by it. */
  baseWidthPx: number
  courseId?: string | undefined
  selected: boolean
  onBeginManipulation: (
    event: ReactPointerEvent<Element>,
    shape: DrawingShape,
    kind: 'move' | 'resize',
    handle?: ResizeHandle
  ) => void
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

const IMAGE_CACHE_LIMIT = 48
const imageCache = new Map<string, Promise<string | null>>()
function cacheKey(courseId: string, relPath: string): string {
  return JSON.stringify([courseId, relPath])
}

function touchCache(key: string, value: Promise<string | null>): void {
  imageCache.delete(key)
  imageCache.set(key, value)
  while (imageCache.size > IMAGE_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value as string | undefined
    if (oldest === undefined) return
    imageCache.delete(oldest)
  }
}

export function primeDrawingImageCache(
  courseId: string,
  source: DrawingImageSource,
  dataUrl: string
): void {
  touchCache(cacheKey(courseId, source.relPath), Promise.resolve(dataUrl))
}

export function loadDrawingImage(
  courseId: string,
  source: DrawingImageSource
): Promise<string | null> {
  const key = cacheKey(courseId, source.relPath)
  const cached = imageCache.get(key)
  if (cached !== undefined) {
    touchCache(key, cached)
    return cached
  }
  const pending = invoke('materials:readFile', {
    courseId,
    relPath: source.relPath
  }).then((content) => imageDataUrl(source.relPath, content)).catch(() => null)
  touchCache(key, pending)
  void pending.then((url) => {
    if (url === null && imageCache.get(key) === pending) imageCache.delete(key)
  })
  return pending
}

function visibleWithoutObserver(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  )
}

export function observeImageVisibility(
  element: Element,
  onVisible: (visible: boolean) => void
): () => void {
  if (visibleWithoutObserver(element)) onVisible(true)
  if (typeof IntersectionObserver === 'undefined') return () => undefined

  const observer = new IntersectionObserver((entries) => {
    onVisible(entries.some((entry) => entry.isIntersecting))
  })
  observer.observe(element)
  return () => observer.disconnect()
}

export function ImageShape({
  shape,
  box,
  aspect,
  baseWidthPx,
  courseId,
  selected,
  onBeginManipulation
}: ImageShapeProps): JSX.Element | null {
  const source = shape.data.image
  const objectRef = useRef<SVGForeignObjectElement>(null)
  const [visible, setVisible] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    const element = objectRef.current
    if (element === null) return
    return observeImageVisibility(element, setVisible)
  }, [])

  useEffect(() => {
    if (!visible || source === undefined) return
    if (courseId === undefined) {
      setLoadState('error')
      setImageUrl(null)
      return
    }
    let cancelled = false
    setLoadState('loading')
    setImageUrl(null)
    void loadDrawingImage(courseId, source).then((url) => {
      if (cancelled) return
      setImageUrl(url)
      setLoadState(url === null ? 'error' : 'loading')
    })
    return () => {
      cancelled = true
    }
  }, [courseId, source?.relPath, visible])

  if (source === undefined) return null
  const failed = loadState === 'error'
  const contentStyle = foreignObjectContentStyle(box, baseWidthPx, aspect)
  // Never render CSS pixels directly into the normalized SVG viewBox.
  if (contentStyle === null) return null

  return (
    <g className="ink-layer__image-group">
      <foreignObject
        ref={objectRef}
        {...box}
        className="ink-layer__image-object"
        style={{ opacity: shape.style.opacity, overflow: 'hidden' }}
        onPointerDown={(event) => onBeginManipulation(event, shape, 'move')}
      >
        <div
          className="ink-layer__image"
          style={contentStyle}
          data-state={loadState}
          aria-label={`${source.label}${failed ? ', 원본을 찾을 수 없어요' : ''}`}
        >
          {imageUrl !== null ? (
            <img
              src={imageUrl}
              alt={source.label}
              draggable={false}
              onLoad={() => setLoadState('ready')}
              onError={() => {
                setImageUrl(null)
                setLoadState('error')
              }}
            />
          ) : (
            <div className="ink-layer__image-placeholder">
              <strong>{source.label}</strong>
              <span>
                {failed ? '원본을 찾을 수 없어요' : '이미지를 불러오는 중…'}
              </span>
            </div>
          )}
        </div>
      </foreignObject>
      {selected && (
        <ResizeHandles
          className="ink-layer__image-resize"
          box={box}
          aspect={aspect}
          onPointerDown={(event, handle) =>
            onBeginManipulation(event, shape, 'resize', handle)}
        />
      )}
    </g>
  )
}
