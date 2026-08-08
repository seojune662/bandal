import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  DrawingBox,
  DrawingClipSource,
  DrawingShape
} from '../../../../shared/types/drawing'

export type RenderClip = (source: DrawingClipSource) => Promise<string | null>

interface ClipShapeProps {
  shape: DrawingShape
  box: DrawingBox
  aspect: number
  selected: boolean
  renderClip?: RenderClip | undefined
  onOpenClip?: ((source: DrawingClipSource) => void) | undefined
  onBeginManipulation: (
    event: ReactPointerEvent<Element>,
    shape: DrawingShape,
    kind: 'move' | 'resize'
  ) => void
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

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

export function ClipShape({
  shape,
  box,
  aspect,
  selected,
  renderClip,
  onOpenClip,
  onBeginManipulation
}: ClipShapeProps): JSX.Element | null {
  const source = shape.data.clip
  const objectRef = useRef<SVGForeignObjectElement>(null)
  const [visible, setVisible] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    const element = objectRef.current
    if (element === null || renderClip === undefined) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(visibleWithoutObserver(element))
      return
    }
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [renderClip])

  useEffect(() => {
    if (!visible || renderClip === undefined || source === undefined) return
    let cancelled = false
    setLoadState('loading')
    setImageUrl(null)
    void renderClip(source).then((url) => {
      if (cancelled) return
      setImageUrl(url)
      setLoadState(url === null ? 'error' : 'ready')
    }).catch(() => {
      if (!cancelled) {
        setImageUrl(null)
        setLoadState('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    renderClip,
    source?.crop?.height,
    source?.crop?.width,
    source?.crop?.x,
    source?.crop?.y,
    source?.page,
    source?.relPath,
    visible
  ])

  if (source === undefined) return null
  const failed = loadState === 'error'

  return (
    <g className="ink-layer__clip-group">
      <foreignObject
        ref={objectRef}
        {...box}
        className="ink-layer__clip-object"
        style={{ opacity: shape.style.opacity }}
        onPointerDown={(event) => onBeginManipulation(event, shape, 'move')}
        onDoubleClick={(event) => {
          event.stopPropagation()
          onOpenClip?.(source)
        }}
      >
        <div
          className="ink-layer__clip"
          data-state={loadState}
          aria-label={`${source.label}${failed ? ', 원본을 찾을 수 없어요' : ''}`}
        >
          {imageUrl !== null ? (
            <img src={imageUrl} alt={source.label} draggable={false} />
          ) : (
            <div className="ink-layer__clip-placeholder">
              <strong>{source.label}</strong>
              <span>
                {failed ? '원본을 찾을 수 없어요' : '자료를 불러오는 중…'}
              </span>
            </div>
          )}
        </div>
      </foreignObject>
      {selected && (
        <rect
          className="ink-layer__clip-resize"
          x={box.x + box.width - 0.008}
          y={box.y + box.height - 0.008 / aspect}
          width={0.016}
          height={0.016 / aspect}
          onPointerDown={(event) => onBeginManipulation(event, shape, 'resize')}
        />
      )}
    </g>
  )
}
