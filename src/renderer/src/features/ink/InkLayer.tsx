import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
  type ResizeHandle,
  strokePath
} from './inkGeometry'
import type { InkTool, InkToolState } from './inkToolStore'
import { ClipShape, type RenderClip } from './ClipShape'
import { foreignObjectContentStyle } from './foreignObjectScale'
import { ResizeHandles } from './ResizeHandles'
import './ink.css'

export interface InkLayerProps {
  aspect: number
  baseWidthPx: number
  shapes: readonly DrawingShape[]
  tool: InkToolState
  onCreate: (shape: Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'>) => void
  onUpdate: (
    id: string,
    patch: Partial<Pick<DrawingShape, 'data' | 'style'>>
  ) => void
  onRemove: (ids: string[]) => void
  clampToBounds?: boolean
  deferTextCreation?: boolean
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
      kind: 'move'
      pointerId: number
      shape: DrawingShape
      start: DrawingPoint
      box: DrawingBox
    }
  | {
      kind: 'resize'
      pointerId: number
      shape: DrawingShape
      start: DrawingPoint
      box: DrawingBox
      handle: ResizeHandle
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
function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function isRenderableBox(box: DrawingBox | undefined): box is DrawingBox {
  return box !== undefined &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    isFinitePositive(box.width) &&
    isFinitePositive(box.height)
}

function isRenderableSegment(
  start: DrawingPoint,
  end: DrawingPoint,
  aspect: number
): boolean {
  const coordinates = [start.x, start.y, end.x, end.y]
  return coordinates.every(Number.isFinite) &&
    isFinitePositive(aspect) &&
    Math.hypot(end.x - start.x, (end.y - start.y) * aspect) > 0
}

function hasMeasuredBounds(element: SVGSVGElement): boolean {
  const bounds = element.getBoundingClientRect()
  return isFinitePositive(bounds.width) && isFinitePositive(bounds.height)
}

export function createTextBoxShape(
  box: DrawingBox,
  text: string,
  style: DrawingStyle
): Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'> | null {
  return text.trim().length === 0 || !isRenderableBox(box)
    ? null
    : { kind: 'textbox', data: { box, text }, style }
}

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
    deferTextCreation = false,
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newTextBox, setNewTextBox] = useState<DrawingBox | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const surfaceReady = isFinitePositive(aspect) &&
    isFinitePositive(baseWidthPx) &&
    Number.isFinite(baseWidthPx * aspect)

  const setGesture = useCallback((next: Gesture | null): void => {
    gestureRef.current = next
    setGestureState(next)
  }, [])

  const pointFromSample = useCallback((sample: PointerSample): DrawingPoint | null => {
    const svg = svgRef.current
    return svg === null || !surfaceReady || !hasMeasuredBounds(svg)
      ? null
      : normalizedPoint(
        svg,
        sample.clientX,
        sample.clientY,
        sample.pressure,
        clampToBounds
      )
  }, [clampToBounds, surfaceReady])

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
        : resizeDrawingBox(original, dx, dy, clampToBounds, current.handle)
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
    setSelectedId(null)
    setNewTextBox(null)
    pendingTextBox.current = null
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
    setSelectedId(null)
    const box: DrawingBox = {
      x: clampToBounds ? Math.min(point.x, TEXT_BOX_MAX_X) : point.x,
      y: clampToBounds ? Math.min(point.y, TEXT_BOX_MAX_Y) : point.y,
      width: TEXT_BOX_WIDTH,
      height: TEXT_BOX_HEIGHT
    }
    if (deferTextCreation) {
      pendingTextBox.current = null
      setEditingId(null)
      setTextDraft('')
      setNewTextBox(box)
      return
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
  }, [clampToBounds, color, deferTextCreation, focusCreatedTextBox,
    onCreate, opacity, shapes, width])

  const finishNewTextBox = useCallback((box: DrawingBox): void => {
    setNewTextBox(null)
    const shape = createTextBoxShape(
      box,
      textDraft,
      drawingStyle('text', width, opacity, color)
    )
    if (shape !== null) onCreate(shape)
  }, [color, onCreate, opacity, textDraft, width])

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return
    if (activeTool === 'select') {
      if (event.target === event.currentTarget) setSelectedId(null)
      return
    }
    if (!surfaceReady || !hasMeasuredBounds(event.currentTarget)) return
    if (
      deferTextCreation && activeTool === 'text' &&
      (newTextBox !== null || editingId !== null)
    ) {
      return
    }
    const point = normalizedPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
      event.pressure,
      clampToBounds
    )
    if (activeTool === 'text') {
      // Without this, the pointer event's default focus move runs after
      // autoFocus and immediately blurs/discards the empty local draft.
      event.preventDefault()
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
  }, [activeTool, clampToBounds, deferTextCreation, editingId, eraseAt,
    newTextBox, setGesture, startTextBox, surfaceReady])

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
      const nextStyle = drawingStyle(completed.tool, width, opacity, color)
      if (
        !surfaceReady ||
        strokePath(
          completed.points,
          nextStyle,
          aspect,
          completed.tool === 'highlighter'
        ).length === 0
      ) {
        return
      }
      onCreate({
        kind,
        data: { points: completed.points },
        style: nextStyle
      })
    } else if (completed.kind === 'shape') {
      if (!surfaceReady) return
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
        return
      }
      onUpdate(completed.shape.id, {
        data: { ...completed.shape.data, box: completed.box }
      })
    }
  }, [aspect, color, onCreate, onRemove, onUpdate, opacity, surfaceReady, width])

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
    kind: 'move' | 'resize',
    handle: ResizeHandle = 'se'
  ): void => {
    const canManipulate =
      (shape.kind === 'textbox' && activeTool === 'text') ||
      (shape.kind === 'clip' && activeTool === 'select')
    if (
      !canManipulate ||
      !surfaceReady ||
      editingId === shape.id ||
      shape.data.box === undefined
    ) {
      return
    }
    event.stopPropagation()
    event.preventDefault()
    setSelectedId(shape.id)
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
    setGesture(kind === 'resize'
      ? { kind, pointerId: event.pointerId, shape, start, box: shape.data.box, handle }
      : { kind, pointerId: event.pointerId, shape, start, box: shape.data.box })
  }, [activeTool, clampToBounds, editingId, setGesture, surfaceReady])

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

  const textBoxContentStyle = useCallback((
    box: DrawingBox,
    shapeStyle: DrawingStyle
  ): CSSProperties => {
    const fontSize = baseWidthPx * TEXT_BASE_FONT_RATIO * (
      isFinitePositive(shapeStyle.fontScale ?? 1) ? (shapeStyle.fontScale ?? 1) : 1
    )
    if (!deferTextCreation) return { fontSize, opacity: shapeStyle.opacity }
    const scaled = foreignObjectContentStyle(box, baseWidthPx, aspect)
    if (scaled === null) return { fontSize, opacity: shapeStyle.opacity }
    return { ...scaled, fontSize, opacity: shapeStyle.opacity }
  }, [aspect, baseWidthPx, deferTextCreation])

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
        if (!surfaceReady) return null
        const markColor = drawingColorVariable(shape.style.color)
        if (shape.kind === 'ink' || shape.kind === 'highlighter') {
          const path = strokePath(
            shape.data.points ?? [],
            shape.style,
            aspect,
            shape.kind === 'highlighter'
          )
          if (path.length === 0) return null
          return (
            <path
              key={shape.id}
              className={shape.kind === 'highlighter'
                ? 'ink-layer__mark is-highlighter'
                : 'ink-layer__mark'}
              d={path}
              fill={markColor}
              opacity={shape.style.opacity}
            />
          )
        }
        const box = boxForShape(shape, gesture)
        if (shape.kind === 'rect' && isRenderableBox(box)) {
          return <rect key={shape.id} className="ink-layer__mark" {...box} fill="none" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} />
        }
        if (shape.kind === 'ellipse' && isRenderableBox(box)) {
          return <ellipse key={shape.id} className="ink-layer__mark" cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="none" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} />
        }
        if (shape.kind === 'line' || shape.kind === 'arrow') {
          const endpoints = lineEndpoints(shape)
          if (
            endpoints === null ||
            !isRenderableSegment(endpoints[0], endpoints[1], aspect)
          ) {
            return null
          }
          return (
            <g key={shape.id} className="ink-layer__mark" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} strokeLinecap="round" strokeLinejoin="round" fill="none">
              <line x1={endpoints[0].x} y1={endpoints[0].y} x2={endpoints[1].x} y2={endpoints[1].y} />
              {shape.kind === 'arrow' && <polyline points={arrowHeadPoints(endpoints[0], endpoints[1], shape.style.width, aspect)} />}
            </g>
          )
        }
        if (shape.kind === 'clip' && isRenderableBox(box)) {
          return (
            <ClipShape
              key={shape.id}
              shape={shape}
              box={box}
              aspect={aspect}
              baseWidthPx={baseWidthPx}
              selected={activeTool === 'select' && selectedId === shape.id}
              renderClip={renderClip}
              onOpenClip={onOpenClip}
              onBeginManipulation={beginManipulation}
            />
          )
        }
        if (shape.kind !== 'textbox' || !isRenderableBox(box)) return null
        const isEditing = editingId === shape.id
        if (!isEditing && (shape.data.text ?? '').trim().length === 0) return null
        const contentStyle = textBoxContentStyle(box, shape.style)
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
                  aria-label="텍스트 입력"
                  placeholder="텍스트를 입력하세요"
                  style={contentStyle}
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
                  style={contentStyle}
                >
                  {shape.data.text}
                </div>
              )}
            </foreignObject>
            {activeTool === 'text' && selectedId === shape.id && !isEditing && (
              <ResizeHandles
                className="ink-layer__textbox-resize"
                box={box}
                aspect={aspect}
                fill={markColor}
                onPointerDown={(event, handle) =>
                  beginManipulation(event, shape, 'resize', handle)}
              />
            )}
          </g>
        )
      })}

      {newTextBox !== null && surfaceReady && isRenderableBox(newTextBox) && (
        <foreignObject
          {...newTextBox}
          className="ink-layer__textbox-object"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <textarea
            autoFocus
            className="ink-layer__textbox is-editing"
            data-color={color}
            value={textDraft}
            aria-label="텍스트 입력"
            placeholder="텍스트를 입력하세요"
            style={textBoxContentStyle(
              newTextBox,
              drawingStyle('text', width, opacity, color)
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => setTextDraft(event.target.value)}
            onBlur={() => finishNewTextBox(newTextBox)}
            onKeyDown={(event) => {
              if (
                event.key === 'Escape' ||
                ((event.metaKey || event.ctrlKey) && event.key === 'Enter')
              ) {
                event.currentTarget.blur()
              }
            }}
          />
        </foreignObject>
      )}

      {gesture?.kind === 'stroke' && (() => {
        const path = strokePath(
          gesture.points,
          style,
          aspect,
          gesture.tool === 'highlighter'
        )
        return path.length === 0
          ? null
          : (
              <path
                className={gesture.tool === 'highlighter'
                  ? 'ink-layer__preview is-highlighter'
                  : 'ink-layer__preview'}
                d={path}
                fill={drawingColorVariable(style.color)}
                opacity={style.opacity}
              />
            )
      })()}
      {gesture?.kind === 'shape' && (() => {
        const box = normalizedBox(gesture.start, gesture.end)
        const previewColor = drawingColorVariable(style.color)
        if (gesture.tool === 'rect') {
          return isRenderableBox(box)
            ? <rect className="ink-layer__preview" {...box} fill="none" stroke={previewColor} strokeWidth={style.width} opacity={style.opacity} />
            : null
        }
        if (gesture.tool === 'ellipse') {
          return isRenderableBox(box)
            ? <ellipse className="ink-layer__preview" cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="none" stroke={previewColor} strokeWidth={style.width} opacity={style.opacity} />
            : null
        }
        if (!isRenderableSegment(gesture.start, gesture.end, aspect)) return null
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
