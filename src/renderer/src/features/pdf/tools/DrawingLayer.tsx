import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  CreateDrawingInput,
  Drawing,
  DrawingBox,
  DrawingKind,
  DrawingPoint,
  DrawingStyle,
  UpdateDrawingInput
} from '../../../../../shared/types/drawing'
import {
  arrowHeadPoints,
  drawingColorVariable,
  drawingHit,
  lineEndpoints,
  normalizedBox,
  normalizedPoint,
  strokePath
} from './drawingGeometry'
import { usePdfToolStore, type PdfDrawingTool } from './toolStore'

interface DrawingLayerProps {
  courseId: string
  relPath: string
  page: number
  pageWidth: number
  aspect: number
  drawings: Drawing[]
  loading: boolean
  create: (input: CreateDrawingInput) => Promise<Drawing | null>
  update: (input: UpdateDrawingInput) => Promise<Drawing | null>
  remove: (ids: string[]) => Promise<boolean>
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
      drawing: Drawing
      start: DrawingPoint
      box: DrawingBox
    }

interface PointerSample {
  pointerId: number
  clientX: number
  clientY: number
  pressure: number
}

const SHAPE_TOOLS: readonly ShapeTool[] = ['rect', 'ellipse', 'arrow', 'line']

function drawingStyle(
  tool: PdfDrawingTool,
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

function boxForDrawing(drawing: Drawing, gesture: Gesture | null): DrawingBox | undefined {
  if (
    gesture !== null &&
    (gesture.kind === 'move' || gesture.kind === 'resize') &&
    gesture.drawing.id === drawing.id
  ) {
    return gesture.box
  }
  return drawing.data.box
}

function clampBoxMove(box: DrawingBox, dx: number, dy: number): DrawingBox {
  return {
    ...box,
    x: Math.min(1 - box.width, Math.max(0, box.x + dx)),
    y: Math.min(1 - box.height, Math.max(0, box.y + dy))
  }
}

function clampBoxResize(box: DrawingBox, dx: number, dy: number): DrawingBox {
  return {
    ...box,
    width: Math.min(1 - box.x, Math.max(0.03, box.width + dx)),
    height: Math.min(1 - box.y, Math.max(0.025, box.height + dy))
  }
}

export function DrawingLayer(props: DrawingLayerProps): JSX.Element {
  const {
    courseId,
    relPath,
    page,
    pageWidth,
    aspect,
    drawings,
    loading,
    create,
    update,
    remove
  } = props
  const activeTool = usePdfToolStore((state) => state.activeTool)
  const color = usePdfToolStore((state) => state.color)
  const width = usePdfToolStore((state) => state.width)
  const opacity = usePdfToolStore((state) => state.opacity)
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const pendingSample = useRef<PointerSample | null>(null)
  const pointerFrame = useRef<number | null>(null)
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
      : normalizedPoint(svg, sample.clientX, sample.clientY, sample.pressure)
  }, [])

  const eraseAt = useCallback((current: Extract<Gesture, { kind: 'erase' }>, point: DrawingPoint): Gesture => {
    const ids = new Set(current.ids)
    for (const drawing of drawings) {
      if (!ids.has(drawing.id) && drawingHit(drawing, point, aspect)) ids.add(drawing.id)
    }
    return { ...current, ids }
  }, [aspect, drawings])

  const processSample = useCallback((sample: PointerSample): void => {
    const current = gestureRef.current
    if (current === null || current.pointerId !== sample.pointerId) return
    const point = pointFromSample(sample)
    if (point === null) return
    if (current.kind === 'stroke') {
      const previous = current.points[current.points.length - 1]
      if (previous !== undefined && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0005) {
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
      const original = current.drawing.data.box
      if (original === undefined) return
      const box = current.kind === 'move'
        ? clampBoxMove(original, dx, dy)
        : clampBoxResize(original, dx, dy)
      setGesture({ ...current, box })
    }
  }, [eraseAt, pointFromSample, setGesture])

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

  const startTextBox = useCallback(async (point: DrawingPoint): Promise<void> => {
    const box: DrawingBox = {
      x: Math.min(point.x, 0.72),
      y: Math.min(point.y, 0.9),
      width: 0.26,
      height: 0.08
    }
    const created = await create({
      courseId,
      relPath,
      page,
      kind: 'textbox',
      data: { box, text: '' },
      style: drawingStyle('text', width, opacity, color)
    })
    if (created !== null) {
      setEditingId(created.id)
      setTextDraft('')
    }
  }, [color, courseId, create, opacity, page, relPath, width])

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (loading || activeTool === 'select' || event.button !== 0) return
    const point = normalizedPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
      event.pressure
    )
    if (activeTool === 'text') {
      void startTextBox(point)
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
  }, [activeTool, eraseAt, loading, setGesture, startTextBox])

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

  const commitGesture = useCallback(async (completed: Gesture): Promise<void> => {
    if (completed.kind === 'stroke') {
      const kind: DrawingKind = completed.tool === 'pen' ? 'ink' : 'highlighter'
      await create({
        courseId,
        relPath,
        page,
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
      if ((completed.tool === 'line' || completed.tool === 'arrow') ? length < 0.002 : box.width < 0.002 || box.height < 0.002) {
        return
      }
      const data = completed.tool === 'line' || completed.tool === 'arrow'
        ? { box, points: [completed.start, completed.end] }
        : { box }
      await create({
        courseId,
        relPath,
        page,
        kind: completed.tool,
        data,
        style: drawingStyle(completed.tool, width, opacity, color)
      })
    } else if (completed.kind === 'erase') {
      if (completed.ids.size > 0) await remove([...completed.ids])
    } else {
      const original = completed.drawing.data.box
      if (
        original !== undefined &&
        Math.abs(completed.box.x - original.x) < 0.0005 &&
        Math.abs(completed.box.y - original.y) < 0.0005 &&
        Math.abs(completed.box.width - original.width) < 0.0005 &&
        Math.abs(completed.box.height - original.height) < 0.0005
      ) {
        if (completed.kind === 'move') {
          setEditingId(completed.drawing.id)
          setTextDraft(completed.drawing.data.text ?? '')
        }
        return
      }
      await update({
        id: completed.drawing.id,
        data: { ...completed.drawing.data, box: completed.box }
      })
    }
  }, [aspect, color, courseId, create, opacity, page, relPath, remove, update, width])

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
    if (completed !== null) void commitGesture(completed)
  }, [commitGesture, flushPointerFrame, setGesture])

  const handlePointerCancel = useCallback((): void => {
    pendingSample.current = null
    if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current)
    pointerFrame.current = null
    setGesture(null)
  }, [setGesture])

  const beginManipulation = useCallback((
    event: ReactPointerEvent<SVGElement>,
    drawing: Drawing,
    kind: 'move' | 'resize'
  ): void => {
    if (activeTool !== 'text' || editingId === drawing.id || drawing.data.box === undefined) return
    event.stopPropagation()
    event.preventDefault()
    const svg = svgRef.current
    if (svg === null) return
    svg.setPointerCapture(event.pointerId)
    const start = normalizedPoint(svg, event.clientX, event.clientY, event.pressure)
    setGesture({
      kind,
      pointerId: event.pointerId,
      drawing,
      start,
      box: drawing.data.box
    })
  }, [activeTool, editingId, setGesture])

  const startEditing = useCallback((drawing: Drawing): void => {
    if (activeTool !== 'text') return
    setEditingId(drawing.id)
    setTextDraft(drawing.data.text ?? '')
  }, [activeTool])

  const finishEditing = useCallback(async (drawing: Drawing): Promise<void> => {
    setEditingId(null)
    if (textDraft.trim().length === 0) {
      await remove([drawing.id])
    } else if (textDraft !== (drawing.data.text ?? '')) {
      await update({ id: drawing.id, data: { ...drawing.data, text: textDraft } })
    }
  }, [remove, textDraft, update])

  const erasedIds = gesture?.kind === 'erase' ? gesture.ids : new Set<string>()
  const style = drawingStyle(activeTool, width, opacity, color)

  return (
    <svg
      ref={svgRef}
      className="pdf-drawing-layer"
      data-loading={loading ? 'true' : 'false'}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-label={`${page} 페이지 필기 레이어`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={(event) => event.stopPropagation()}
    >
      {drawings.filter((drawing) => !erasedIds.has(drawing.id)).map((drawing) => {
        const markColor = drawingColorVariable(drawing.style.color)
        if (drawing.kind === 'ink' || drawing.kind === 'highlighter') {
          return (
            <path
              key={drawing.id}
              className={drawing.kind === 'highlighter' ? 'pdf-drawing-mark is-highlighter' : 'pdf-drawing-mark'}
              d={strokePath(drawing.data.points ?? [], drawing.style, aspect, drawing.kind === 'highlighter')}
              fill={markColor}
              opacity={drawing.style.opacity}
            />
          )
        }
        const box = boxForDrawing(drawing, gesture)
        if (drawing.kind === 'rect' && box !== undefined) {
          return <rect key={drawing.id} className="pdf-drawing-mark" {...box} fill="none" stroke={markColor} strokeWidth={drawing.style.width} opacity={drawing.style.opacity} />
        }
        if (drawing.kind === 'ellipse' && box !== undefined) {
          return <ellipse key={drawing.id} className="pdf-drawing-mark" cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="none" stroke={markColor} strokeWidth={drawing.style.width} opacity={drawing.style.opacity} />
        }
        if (drawing.kind === 'line' || drawing.kind === 'arrow') {
          const endpoints = lineEndpoints(drawing)
          if (endpoints === null) return null
          return (
            <g key={drawing.id} className="pdf-drawing-mark" stroke={markColor} strokeWidth={drawing.style.width} opacity={drawing.style.opacity} strokeLinecap="round" strokeLinejoin="round" fill="none">
              <line x1={endpoints[0].x} y1={endpoints[0].y} x2={endpoints[1].x} y2={endpoints[1].y} />
              {drawing.kind === 'arrow' && <polyline points={arrowHeadPoints(endpoints[0], endpoints[1], drawing.style.width, aspect)} />}
            </g>
          )
        }
        if (drawing.kind !== 'textbox' || box === undefined) return null
        const isEditing = editingId === drawing.id
        return (
          <g key={drawing.id} className="pdf-textbox-group">
            <foreignObject
              {...box}
              className="pdf-textbox-object"
              onPointerDown={(event) => beginManipulation(event, drawing, 'move')}
              onDoubleClick={(event) => {
                event.stopPropagation()
                startEditing(drawing)
              }}
            >
              {isEditing ? (
                <textarea
                  autoFocus
                  className="pdf-textbox is-editing"
                  data-color={drawing.style.color}
                  value={textDraft}
                  style={{
                    fontSize: pageWidth * 0.026 * (drawing.style.fontScale ?? 1),
                    opacity: drawing.style.opacity
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => setTextDraft(event.target.value)}
                  onBlur={() => void finishEditing(drawing)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) {
                      event.currentTarget.blur()
                    }
                  }}
                />
              ) : (
                <div
                  className="pdf-textbox"
                  data-color={drawing.style.color}
                  style={{
                    fontSize: pageWidth * 0.026 * (drawing.style.fontScale ?? 1),
                    opacity: drawing.style.opacity
                  }}
                >
                  {drawing.data.text}
                </div>
              )}
            </foreignObject>
            {activeTool === 'text' && !isEditing && (
              <rect
                className="pdf-textbox-resize"
                x={box.x + box.width - 0.008}
                y={box.y + box.height - 0.008}
                width={0.016}
                height={0.016 / aspect}
                fill={markColor}
                onPointerDown={(event) => beginManipulation(event, drawing, 'resize')}
              />
            )}
          </g>
        )
      })}

      {gesture?.kind === 'stroke' && (
        <path
          className={gesture.tool === 'highlighter' ? 'pdf-drawing-preview is-highlighter' : 'pdf-drawing-preview'}
          d={strokePath(gesture.points, style, aspect, gesture.tool === 'highlighter')}
          fill={drawingColorVariable(style.color)}
          opacity={style.opacity}
        />
      )}
      {gesture?.kind === 'shape' && (() => {
        const box = normalizedBox(gesture.start, gesture.end)
        const previewColor = drawingColorVariable(style.color)
        if (gesture.tool === 'rect') return <rect className="pdf-drawing-preview" {...box} fill="none" stroke={previewColor} strokeWidth={style.width} opacity={style.opacity} />
        if (gesture.tool === 'ellipse') return <ellipse className="pdf-drawing-preview" cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="none" stroke={previewColor} strokeWidth={style.width} opacity={style.opacity} />
        return (
          <g className="pdf-drawing-preview" fill="none" stroke={previewColor} strokeWidth={style.width} opacity={style.opacity} strokeLinecap="round" strokeLinejoin="round">
            <line x1={gesture.start.x} y1={gesture.start.y} x2={gesture.end.x} y2={gesture.end.y} />
            {gesture.tool === 'arrow' && <polyline points={arrowHeadPoints(gesture.start, gesture.end, style.width, aspect)} />}
          </g>
        )
      })()}
    </svg>
  )
}
