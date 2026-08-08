import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  DrawingBox,
  DrawingClipSource,
  DrawingKind,
  DrawingPoint,
  DrawingShape,
  DrawingStyle
} from '../../../../shared/types/drawing'
import {
  arrowHeadPoints,
  drawingColorVariable,
  drawingHit,
  lineEndpoints,
  moveDrawingBox,
  normalizedBox,
  normalizedPoint,
  resizeDrawingBox,
  strokePath
} from './inkGeometry'
import type { InkTool, InkToolState } from './inkToolStore'
import { ClipShape, type RenderClip } from './ClipShape'
import './ink.css'

export interface InkLayerProps {
  /** Height divided by width; restores physical proportions from 0..1 coordinates. */
  aspect: number
  /** Pixel width used as the text box font-size basis. */
  baseWidthPx: number
  shapes: readonly DrawingShape[]
  tool: InkToolState
  onCreate: (shape: Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'>) => void
  onUpdate: (
    id: string,
    patch: Partial<Pick<DrawingShape, 'data' | 'style'>>
  ) => void
  onRemove: (ids: string[]) => void
  /** Disable to preserve coordinates beyond the normalized finite surface. */
  clampToBounds?: boolean
  ariaLabel: string
  className?: string
  /** Surface-owned PDF renderer; omitted on PDF markup and group boards. */
  renderClip?: RenderClip
  onOpenClip?: (source: DrawingClipSource) => void
}

type ShapeTool = 'rect' | 'ellipse' | 'arrow' | 'line'

type Gesture =
  | {
      kind: 'stroke'
      pointerId: number
      tool: 'pen' | 'highlighter'
      points: DrawingPoint[]
    }
  | {
      kind: 'shape'
      pointerId: number
      tool: ShapeTool
      start: DrawingPoint
      end: DrawingPoint
    }
  | {
      kind: 'erase'
      pointerId: number
      ids: Set<string>
    }
  | {
      kind: 'move' | 'resize'
      pointerId: number
      shape: DrawingShape
      start: DrawingPoint
      box: DrawingBox
    }

interface PointerSample {
  pointerId: number
  clientX: number
  clientY: number
  pressure: number
}

interface PendingTextBox {
  existingIds: Set<string>
  box: DrawingBox
}

const SHAPE_TOOLS: readonly ShapeTool[] = ['rect', 'ellipse', 'arrow', 'line']
const TEXT_BOX_WIDTH = 0.26
const TEXT_BOX_HEIGHT = 0.08
const TEXT_BOX_MAX_X = 0.72
const TEXT_BOX_MAX_Y = 0.9
const TEXT_BASE_FONT_RATIO = 0.026
const RESIZE_HANDLE_SIZE = 0.016

function drawingStyle(
  tool: InkTool,
  width: number,
  opacity: number,
  color: DrawingStyle['color']
): DrawingStyle {
  if (tool === 'highlighter') {
    return { color, width: Math.max(width * 4, 0.014), opacity: Math.min(opacity, 0.34) }
  }
  if (tool === 'text') return { color, width, opacity, fontScale: 1 }
  return { color, width, opacity }
}

function boxForShape(shape: DrawingShape, gesture: Gesture | null): DrawingBox | undefined {
  if (
    gesture !== null &&
    (gesture.kind === 'move' || gesture.kind === 'resize') &&
    gesture.shape.id === shape.id
  ) {
    return gesture.box
  }
  return shape.data.box
}

function sameBox(left: DrawingBox | undefined, right: DrawingBox): boolean {
  return left !== undefined &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
}

function isDrawingShape(value: unknown): value is DrawingShape {
  if (typeof value !== 'object' || value === null) return false
  return 'id' in value && typeof value.id === 'string' &&
    'createdAt' in value && typeof value.createdAt === 'string' &&
    'updatedAt' in value && typeof value.updatedAt === 'string'
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null &&
    'then' in value && typeof value.then === 'function'
}

export function InkLayer(props: InkLayerProps): JSX.Element {
  const {
    aspect,
    baseWidthPx,
    shapes,
    tool,
    onCreate,
    onUpdate,
    onRemove,
    clampToBounds = true,
    ariaLabel,
    className,
    renderClip,
    onOpenClip
  } = props
  const { activeTool, color, width, opacity } = tool
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const pendingSample = useRef<PointerSample | null>(null)
  const pointerFrame = useRef<number | null>(null)
  const pendingTextBox = useRef<PendingTextBox | null>(null)
  const [gesture, setGestureState] = useState<Gesture | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')

  const setGesture = useCallback((next: Gesture | null): void => {
    gestureRef.current = next
    setGestureState(next)
  }, [])

  const pointFromSample = useCallback((sample: PointerSample): DrawingPoint | null => {
    const svg = svgRef.current
    return svg === null
      ? null
      : normalizedPoint(
        svg,
        sample.clientX,
        sample.clientY,
        sample.pressure,
        clampToBounds
      )
  }, [clampToBounds])

  const eraseAt = useCallback((
    current: Extract<Gesture, { kind: 'erase' }>,
    point: DrawingPoint
  ): Gesture => {
    const ids = new Set(current.ids)
    for (const shape of shapes) {
      if (!ids.has(shape.id) && drawingHit(shape, point, aspect)) ids.add(shape.id)
    }
    return { ...current, ids }
  }, [aspect, shapes])

  const processSample = useCallback((sample: PointerSample): void => {
    const current = gestureRef.current
    if (current === null || current.pointerId !== sample.pointerId) return
    const point = pointFromSample(sample)
    if (point === null) return
    if (current.kind === 'stroke') {
      const previous = current.points[current.points.length - 1]
      if (
        previous !== undefined &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0005
      ) {
        return
      }
      setGesture({ ...current, points: [...current.points, point] })
    } else if (current.kind === 'shape') {
      setGesture({ ...current, end: point })
    } else if (current.kind === 'erase') {
      setGesture(eraseAt(current, point))
    } else {
      const dx = point.x - current.start.x
      const dy = point.y - current.start.y
      const original = current.shape.data.box
      if (original === undefined) return
      const box = current.kind === 'move'
        ? moveDrawingBox(original, dx, dy, clampToBounds)
        : resizeDrawingBox(original, dx, dy, clampToBounds)
      setGesture({ ...current, box })
    }
  }, [clampToBounds, eraseAt, pointFromSample, setGesture])

  const flushPointerFrame = useCallback((): void => {
    if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current)
    pointerFrame.current = null
    const sample = pendingSample.current
    pendingSample.current = null
    if (sample !== null) processSample(sample)
  }, [processSample])

  useEffect(() => () => {
    if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current)
  }, [])

  useEffect(() => {
    setGesture(null)
    setEditingId(null)
  }, [activeTool, setGesture])

  useEffect(() => {
    const pending = pendingTextBox.current
    if (pending === null) return
    const created = shapes.find((shape) =>
      !pending.existingIds.has(shape.id) &&
      shape.kind === 'textbox' &&
      sameBox(shape.data.box, pending.box)
    )
    if (created === undefined) return
    pendingTextBox.current = null
    setEditingId(created.id)
    setTextDraft(created.data.text ?? '')
  }, [shapes])

  const focusCreatedTextBox = useCallback((created: unknown): void => {
    if (!isDrawingShape(created)) return
    pendingTextBox.current = null
    setEditingId(created.id)
    setTextDraft(created.data.text ?? '')
  }, [])

  const startTextBox = useCallback((point: DrawingPoint): void => {
    const box: DrawingBox = {
      x: clampToBounds ? Math.min(point.x, TEXT_BOX_MAX_X) : point.x,
      y: clampToBounds ? Math.min(point.y, TEXT_BOX_MAX_Y) : point.y,
      width: TEXT_BOX_WIDTH,
      height: TEXT_BOX_HEIGHT
    }
    pendingTextBox.current = {
      existingIds: new Set(shapes.map((shape) => shape.id)),
      box
    }
    const result: unknown = onCreate({
      kind: 'textbox',
      data: { box, text: '' },
      style: drawingStyle('text', width, opacity, color)
    })
    if (isPromiseLike(result)) {
      pendingTextBox.current = null
      void Promise.resolve(result).then(focusCreatedTextBox, () => {
        pendingTextBox.current = null
      })
    } else {
      focusCreatedTextBox(result)
    }
  }, [clampToBounds, color, focusCreatedTextBox, onCreate, opacity, shapes, width])

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (activeTool === 'select' || event.button !== 0) return
    const point = normalizedPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
      event.pressure,
      clampToBounds
    )
    if (activeTool === 'text') {
      startTextBox(point)
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      setGesture({
        kind: 'stroke',
        pointerId: event.pointerId,
        tool: activeTool,
        points: [point]
      })
    } else if (SHAPE_TOOLS.includes(activeTool as ShapeTool)) {
      setGesture({
        kind: 'shape',
        pointerId: event.pointerId,
        tool: activeTool as ShapeTool,
        start: point,
        end: point
      })
    } else if (activeTool === 'eraser') {
      setGesture(eraseAt({ kind: 'erase', pointerId: event.pointerId, ids: new Set() }, point))
    }
  }, [activeTool, clampToBounds, eraseAt, setGesture, startTextBox])

  const handlePointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (gestureRef.current === null) return
    pendingSample.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      pressure: event.pressure
    }
    if (pointerFrame.current === null) {
      pointerFrame.current = requestAnimationFrame(() => {
        pointerFrame.current = null
        const sample = pendingSample.current
        pendingSample.current = null
        if (sample !== null) processSample(sample)
      })
    }
  }, [processSample])

  const commitGesture = useCallback((completed: Gesture): void => {
    if (completed.kind === 'stroke') {
      const kind: DrawingKind = completed.tool === 'pen' ? 'ink' : 'highlighter'
      onCreate({
        kind,
        data: { points: completed.points },
        style: drawingStyle(completed.tool, width, opacity, color)
      })
    } else if (completed.kind === 'shape') {
      const box = normalizedBox(completed.start, completed.end)
      const length = Math.hypot(
        completed.end.x - completed.start.x,
        (completed.end.y - completed.start.y) * aspect
      )
      if (
        (completed.tool === 'line' || completed.tool === 'arrow')
          ? length < 0.002
          : box.width < 0.002 || box.height < 0.002
      ) {
        return
      }
      const data = completed.tool === 'line' || completed.tool === 'arrow'
        ? { box, points: [completed.start, completed.end] }
        : { box }
      onCreate({
        kind: completed.tool,
        data,
        style: drawingStyle(completed.tool, width, opacity, color)
      })
    } else if (completed.kind === 'erase') {
      if (completed.ids.size > 0) onRemove([...completed.ids])
    } else {
      const original = completed.shape.data.box
      if (
        original !== undefined &&
        Math.abs(completed.box.x - original.x) < 0.0005 &&
        Math.abs(completed.box.y - original.y) < 0.0005 &&
        Math.abs(completed.box.width - original.width) < 0.0005 &&
        Math.abs(completed.box.height - original.height) < 0.0005
      ) {
        if (completed.kind === 'move' && completed.shape.kind === 'textbox') {
          setEditingId(completed.shape.id)
          setTextDraft(completed.shape.data.text ?? '')
        }
        return
      }
      onUpdate(completed.shape.id, {
        data: { ...completed.shape.data, box: completed.box }
      })
    }
  }, [aspect, color, onCreate, onRemove, onUpdate, opacity, width])

  const handlePointerUp = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    pendingSample.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      pressure: event.pressure
    }
    flushPointerFrame()
    const completed = gestureRef.current
    setGesture(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (completed !== null) commitGesture(completed)
  }, [commitGesture, flushPointerFrame, setGesture])

  const handlePointerCancel = useCallback((): void => {
    pendingSample.current = null
    if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current)
    pointerFrame.current = null
    setGesture(null)
  }, [setGesture])

  const beginManipulation = useCallback((
    event: ReactPointerEvent<Element>,
    shape: DrawingShape,
    kind: 'move' | 'resize'
  ): void => {
    const canManipulate =
      (shape.kind === 'textbox' && activeTool === 'text') ||
      (shape.kind === 'clip' && activeTool === 'select')
    if (!canManipulate || editingId === shape.id || shape.data.box === undefined) return
    event.stopPropagation()
    event.preventDefault()
    const svg = svgRef.current
    if (svg === null) return
    svg.setPointerCapture(event.pointerId)
    const start = normalizedPoint(
      svg,
      event.clientX,
      event.clientY,
      event.pressure,
      clampToBounds
    )
    setGesture({
      kind,
      pointerId: event.pointerId,
      shape,
      start,
      box: shape.data.box
    })
  }, [activeTool, clampToBounds, editingId, setGesture])

  const startEditing = useCallback((shape: DrawingShape): void => {
    if (activeTool !== 'text') return
    setEditingId(shape.id)
    setTextDraft(shape.data.text ?? '')
  }, [activeTool])

  const finishEditing = useCallback((shape: DrawingShape): void => {
    setEditingId(null)
    if (textDraft.trim().length === 0) {
      onRemove([shape.id])
    } else if (textDraft !== (shape.data.text ?? '')) {
      onUpdate(shape.id, { data: { ...shape.data, text: textDraft } })
    }
  }, [onRemove, onUpdate, textDraft])

  const erasedIds = gesture?.kind === 'erase' ? gesture.ids : new Set<string>()
  const style = drawingStyle(activeTool, width, opacity, color)
  const rootClassName = className === undefined ? 'ink-layer' : `ink-layer ${className}`

  return (
    <svg
      ref={svgRef}
      className={rootClassName}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={(event) => event.stopPropagation()}
    >
      {shapes.filter((shape) => !erasedIds.has(shape.id)).map((shape) => {
        const markColor = drawingColorVariable(shape.style.color)
        if (shape.kind === 'ink' || shape.kind === 'highlighter') {
          return (
            <path
              key={shape.id}
              className={shape.kind === 'highlighter'
                ? 'ink-layer__mark is-highlighter'
                : 'ink-layer__mark'}
              d={strokePath(
                shape.data.points ?? [],
                shape.style,
                aspect,
                shape.kind === 'highlighter'
              )}
              fill={markColor}
              opacity={shape.style.opacity}
            />
          )
        }
        const box = boxForShape(shape, gesture)
        if (shape.kind === 'rect' && box !== undefined) {
          return <rect key={shape.id} className="ink-layer__mark" {...box} fill="none" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} />
        }
        if (shape.kind === 'ellipse' && box !== undefined) {
          return <ellipse key={shape.id} className="ink-layer__mark" cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="none" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} />
        }
        if (shape.kind === 'line' || shape.kind === 'arrow') {
          const endpoints = lineEndpoints(shape)
          if (endpoints === null) return null
          return (
            <g key={shape.id} className="ink-layer__mark" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} strokeLinecap="round" strokeLinejoin="round" fill="none">
              <line x1={endpoints[0].x} y1={endpoints[0].y} x2={endpoints[1].x} y2={endpoints[1].y} />
              {shape.kind === 'arrow' && <polyline points={arrowHeadPoints(endpoints[0], endpoints[1], shape.style.width, aspect)} />}
            </g>
          )
        }
        if (shape.kind === 'clip' && box !== undefined) {
          return (
            <ClipShape
              key={shape.id}
              shape={shape}
              box={box}
              aspect={aspect}
              selected={activeTool === 'select'}
              renderClip={renderClip}
              onOpenClip={onOpenClip}
              onBeginManipulation={beginManipulation}
            />
          )
        }
        if (shape.kind !== 'textbox' || box === undefined) return null
        const isEditing = editingId === shape.id
        return (
          <g key={shape.id} className="ink-layer__textbox-group">
            <foreignObject
              {...box}
              className="ink-layer__textbox-object"
              onPointerDown={(event) => beginManipulation(event, shape, 'move')}
              onDoubleClick={(event) => {
                event.stopPropagation()
                startEditing(shape)
              }}
            >
              {isEditing ? (
                <textarea
                  autoFocus
                  className="ink-layer__textbox is-editing"
                  data-color={shape.style.color}
                  value={textDraft}
                  style={{
                    fontSize: baseWidthPx * TEXT_BASE_FONT_RATIO * (shape.style.fontScale ?? 1),
                    opacity: shape.style.opacity
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => setTextDraft(event.target.value)}
                  onBlur={() => finishEditing(shape)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Escape' ||
                      ((event.metaKey || event.ctrlKey) && event.key === 'Enter')
                    ) {
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <div
                  className="ink-layer__textbox"
                  data-color={shape.style.color}
                  style={{
                    fontSize: baseWidthPx * TEXT_BASE_FONT_RATIO * (shape.style.fontScale ?? 1),
                    opacity: shape.style.opacity
                  }}
                >
                  {shape.data.text}
                </div>
              )}
            </foreignObject>
            {activeTool === 'text' && !isEditing && (
              <rect
                className="ink-layer__textbox-resize"
                x={box.x + box.width - RESIZE_HANDLE_SIZE / 2}
                y={box.y + box.height - RESIZE_HANDLE_SIZE / 2}
                width={RESIZE_HANDLE_SIZE}
                height={RESIZE_HANDLE_SIZE / aspect}
                fill={markColor}
                onPointerDown={(event) => beginManipulation(event, shape, 'resize')}
              />
            )}
          </g>
        )
      })}

      {gesture?.kind === 'stroke' && (
        <path
          className={gesture.tool === 'highlighter'
            ? 'ink-layer__preview is-highlighter'
            : 'ink-layer__preview'}
          d={strokePath(gesture.points, style, aspect, gesture.tool === 'highlighter')}
          fill={drawingColorVariable(style.color)}
          opacity={style.opacity}
        />
      )}
      {gesture?.kind === 'shape' && (() => {
        const box = normalizedBox(gesture.start, gesture.end)
        const previewColor = drawingColorVariable(style.color)
        if (gesture.tool === 'rect') {
          return <rect className="ink-layer__preview" {...box} fill="none" stroke={previewColor} strokeWidth={style.width} opacity={style.opacity} />
        }
        if (gesture.tool === 'ellipse') {
          return <ellipse className="ink-layer__preview" cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="none" stroke={previewColor} strokeWidth={style.width} opacity={style.opacity} />
        }
        return (
          <g className="ink-layer__preview" fill="none" stroke={previewColor} strokeWidth={style.width} opacity={style.opacity} strokeLinecap="round" strokeLinejoin="round">
            <line x1={gesture.start.x} y1={gesture.start.y} x2={gesture.end.x} y2={gesture.end.y} />
            {gesture.tool === 'arrow' && <polyline points={arrowHeadPoints(gesture.start, gesture.end, style.width, aspect)} />}
          </g>
        )
      })()}
    </svg>
  )
}
