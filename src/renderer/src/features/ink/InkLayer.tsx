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
import { healedImageBox } from './imagePlacement'
import type { InkTool, InkToolState } from './inkToolStore'
import type { RenderClip } from './ClipShape'
import { isEditableTarget } from './domTarget'
import { foreignObjectContentStyle } from './foreignObjectScale'
import { ReferencedShape } from './ReferencedShape'
import { ResizeHandles, TEXTBOX_HANDLES } from './ResizeHandles'
import { TextFormatBar } from './TextFormatBar'
import {
  TEXT_BASE_FONT_RATIO,
  defaultTextBoxSize,
  grownTextBoxHeight,
  healedTextBox
} from './textBoxLayout'
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
  ariaLabel: string
  className?: string
  /** Course that owns image paths. Required only when image shapes are present. */
  courseId?: string
  /** Surface-owned PDF renderer; omitted on PDF markup and group boards. */
  renderClip?: RenderClip
  onOpenClip?: (source: DrawingClipSource) => void
  /**
   * 이미지 원본 비율이 확정됐는데 box 비율이 어긋난 셰이프를 표면이 조용히
   * 보정(undo 미기록)할 수 있게 한다. 미배선 표면은 레터박스 폴백으로 렌더.
   */
  onRefineBox?: ((id: string, box: DrawingBox) => void) | undefined
  /**
   * 이 레이어가 지금 사용자 입력의 주인인지(패널 활성). false 면 선택을
   * 해제하고 키보드 삭제도 받지 않는다 — 열린 탭 여러 개가 Backspace 를
   * 동시에 먹는 사고 방지.
   */
  interactive?: boolean
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

const SHAPE_TOOLS: readonly ShapeTool[] = ['rect', 'ellipse', 'arrow', 'line']
/** select 툴로 잡을 수 있는 셰이프 — 잉크 스트로크는 지우개 전용으로 남긴다. */
const SELECTABLE_KINDS: ReadonlySet<DrawingKind> = new Set([
  'textbox',
  'image',
  'clip',
  'rect',
  'ellipse',
  'line',
  'arrow'
])
/** 코너 리사이즈에서 박스 비율을 잠그는 셰이프. 텍스트박스는 자유
 * 리사이즈 + 줄바꿈 재배치라 여기 속하지 않는다. */
const ASPECT_LOCKED_KINDS: ReadonlySet<DrawingKind> = new Set([
  'image',
  'clip'
])

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
    courseId,
    renderClip,
    onOpenClip,
    onRefineBox,
    interactive = true
  } = props
  const { activeTool, color, width, opacity } = tool
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const pendingSample = useRef<PointerSample | null>(null)
  const pointerFrame = useRef<number | null>(null)
  const previousShapeIds = useRef(new Set(shapes.map((shape) => shape.id)))
  // Escape 는 확정이 아니라 취소다 — blur 핸들러가 이 플래그로 분기한다.
  const cancelEditRef = useRef(false)
  // 재배치 클릭 도중의 blur 를 무시하는 가드. PDF 표면은 pointerdown 에서
  // 페이지 섹션이 focus 를 가져가 textarea 가 동기적으로 blur 되는데, 그때
  // finishNewTextBox 가 setNewTextBox(null) 을 뒤늦게 큐에 넣어 방금 옮긴
  // 박스를 지워 버린다.
  const repositionGuardRef = useRef(false)
  const newTextAreaRef = useRef<HTMLTextAreaElement>(null)
  // 서식 바 — 바깥클릭 해제/blur 판단에서 "안쪽"으로 취급해야 한다.
  const formatBarRef = useRef<HTMLDivElement>(null)
  const [gesture, setGestureState] = useState<Gesture | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newTextBox, setNewTextBox] = useState<DrawingBox | null>(null)
  const [textDraft, setTextDraft] = useState('')
  /** 새 draft 박스의 서식 — 커밋 전에도 서식 바로 편집할 수 있게 로컬 보관. */
  const [draftStyle, setDraftStyle] = useState<DrawingStyle | null>(null)
  /** 편집 중 타이핑으로 자란 기존 박스의 로컬 프리뷰(확정 시 저장). */
  const [editingBoxOverride, setEditingBoxOverride] =
    useState<DrawingBox | null>(null)
  const surfaceReady = isFinitePositive(aspect) &&
    isFinitePositive(baseWidthPx) &&
    Number.isFinite(baseWidthPx * aspect)

  const setGesture = useCallback((next: Gesture | null): void => {
    gestureRef.current = next
    setGestureState(next)
  }, [])

  const handleNaturalAspect = useCallback(
    (shape: DrawingShape, naturalAspect: number): void => {
      if (onRefineBox === undefined) return
      const active = gestureRef.current
      if (
        active !== null &&
        (active.kind === 'move' || active.kind === 'resize') &&
        active.shape.id === shape.id
      ) {
        return
      }
      const box = shape.data.box
      if (box === undefined) return
      const healed = healedImageBox(box, aspect, naturalAspect)
      if (healed !== null) onRefineBox(shape.id, healed)
    },
    [aspect, onRefineBox]
  )

  // 손상 텍스트박스 자가 치유: 예전 리사이즈 버그가 커밋한 거대/이탈
  // 박스는 그 영역의 클릭을 전부 흡수한다 — 표면 안으로 무음 보정
  // (undo 미기록, onRefineBox 채널). 경계 클램프가 없는 표면은 제외.
  useEffect(() => {
    if (onRefineBox === undefined || !clampToBounds) return
    const active = gestureRef.current
    for (const shape of shapes) {
      if (shape.kind !== 'textbox' || shape.data.box === undefined) continue
      if (active !== null && 'shape' in active && active.shape.id === shape.id) {
        continue
      }
      const healed = healedTextBox(shape.data.box)
      if (healed !== null) onRefineBox(shape.id, healed)
    }
  }, [clampToBounds, onRefineBox, shapes])

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
        : resizeDrawingBox(
            original,
            dx,
            dy,
            clampToBounds,
            current.handle,
            ASPECT_LOCKED_KINDS.has(current.shape.kind),
            aspect
          )
      setGesture({ ...current, box })
    }
  }, [aspect, clampToBounds, eraseAt, pointFromSample, setGesture])

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
    setEditingBoxOverride(null)
  }, [activeTool, setGesture])

  // 패널이 비활성이 되면 선택도 내려놓는다 — 키보드 삭제 대상에서 제외.
  useEffect(() => {
    if (!interactive) setSelectedId(null)
  }, [interactive])

  useEffect(() => {
    const priorIds = previousShapeIds.current
    previousShapeIds.current = new Set(shapes.map((shape) => shape.id))
    if (activeTool !== 'select') return
    const addedImage = [...shapes].reverse().find((shape) =>
      shape.kind === 'image' && !priorIds.has(shape.id)
    )
    if (addedImage !== undefined) setSelectedId(addedImage.id)
  }, [activeTool, shapes])

  // 바깥 클릭 = 선택 해제. PDF 에서는 svg 루트가 pointer-events:none 이라
  // 루트 클릭 핸들러가 못 받으므로 document 캡처로 처리한다.
  // 서식 바는 svg 밖의 형제 HTML 이지만 "안쪽"이다 — 해제하면 안 된다.
  useEffect(() => {
    if (selectedId === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const svg = svgRef.current
      const target = event.target
      if (svg === null || !(target instanceof Node)) return
      if (formatBarRef.current?.contains(target) === true) return
      if (!svg.contains(target) || target === svg) setSelectedId(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [selectedId])

  // Backspace/Delete = 선택 셰이프 삭제 (undo 는 onRemove 경로가 기록).
  useEffect(() => {
    if (!interactive || selectedId === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      if (isEditableTarget(event.target)) return
      if (editingId !== null || newTextBox !== null) return
      if (gestureRef.current !== null) return
      event.preventDefault()
      onRemove([selectedId])
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editingId, interactive, newTextBox, onRemove, selectedId])

  const startTextBox = useCallback((point: DrawingPoint): void => {
    setSelectedId(null)
    const size = defaultTextBoxSize(aspect)
    const box: DrawingBox = {
      x: clampToBounds ? Math.min(point.x, 1 - size.width) : point.x,
      y: clampToBounds ? Math.min(point.y, 1 - size.height) : point.y,
      width: size.width,
      height: size.height
    }
    setEditingId(null)
    setTextDraft('')
    // 서식은 draft 가 열려 있는 동안 유지 — 재배치 클릭이 초기화하지 않는다.
    setDraftStyle((current) =>
      current ?? drawingStyle('text', width, opacity, color)
    )
    setNewTextBox(box)
  }, [aspect, clampToBounds, color, opacity, width])

  // 재배치로 박스가 옮겨지면(포커스를 뺏겼을 수 있으니) 되찾아 오고,
  // 그때서야 blur 가드를 내린다 — 클릭의 pointerdown/mousedown 은 별개의
  // 네이티브 태스크라 타이머로는 그 사이 blur 를 못 막는다.
  useEffect(() => {
    if (newTextBox === null) return
    newTextAreaRef.current?.focus()
    repositionGuardRef.current = false
  }, [newTextBox])

  const finishNewTextBox = useCallback((box: DrawingBox): void => {
    if (repositionGuardRef.current) return
    setNewTextBox(null)
    setDraftStyle(null)
    if (cancelEditRef.current) {
      cancelEditRef.current = false
      setTextDraft('')
      return
    }
    const shape = createTextBoxShape(
      box,
      textDraft,
      draftStyle ?? drawingStyle('text', width, opacity, color)
    )
    if (shape !== null) onCreate(shape)
  }, [color, draftStyle, onCreate, opacity, textDraft, width])

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return
    if (activeTool === 'select') {
      if (event.target === event.currentTarget) setSelectedId(null)
      return
    }
    if (!surfaceReady || !hasMeasuredBounds(event.currentTarget)) return
    // 기존 박스 편집 중 바깥 클릭은 "확정"이지 새 박스 생성이 아니다 —
    // textarea 의 blur 가 확정을 처리하므로 여기서는 아무것도 시작하지 않는다.
    if (activeTool === 'text' && editingId !== null) return
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
      // placeholder 가 이미 열려 있어도 클릭을 삼키지 않는다: 내용이 있으면
      // 그 자리에 확정하고, 어느 쪽이든 새 클릭 지점으로 박스를 옮긴다 —
      // 안 그러면 위치를 다시 고르는 클릭 절반이 "확정"으로만 소비돼
      // 박스가 마우스를 안 따라오는 것처럼 보인다.
      if (newTextBox !== null && textDraft.trim().length > 0) {
        const shape = createTextBoxShape(
          newTextBox,
          textDraft,
          draftStyle ?? drawingStyle('text', width, opacity, color)
        )
        if (shape !== null) onCreate(shape)
        setDraftStyle(null)
      }
      if (newTextBox !== null) {
        // 이 클릭이 일으키는 blur(표면 focus 핸들러·mousedown 기본 동작)가
        // 재배치를 되돌리지 못하게 — 재포커스 effect 가 가드를 내린다.
        repositionGuardRef.current = true
      }
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
  }, [activeTool, clampToBounds, color, editingId, eraseAt, newTextBox,
    onCreate, opacity, setGesture, startTextBox, surfaceReady, textDraft,
    width])

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
        original === undefined ||
        (
          Math.abs(completed.box.x - original.x) < 0.0005 &&
          Math.abs(completed.box.y - original.y) < 0.0005 &&
          Math.abs(completed.box.width - original.width) < 0.0005 &&
          Math.abs(completed.box.height - original.height) < 0.0005
        )
      ) {
        // text 툴에서 무변위 클릭 = 즉시 편집 (더블클릭 불필요 — 워드/키노트
        // 관례). select 툴은 선택만 유지.
        if (
          completed.kind === 'move' &&
          completed.shape.kind === 'textbox' &&
          activeTool === 'text'
        ) {
          setEditingId(completed.shape.id)
          setTextDraft(completed.shape.data.text ?? '')
          setEditingBoxOverride(null)
        }
        return
      }
      const nextData: DrawingShape['data'] = {
        ...completed.shape.data,
        box: completed.box
      }
      // 선/화살표의 실좌표는 points 다 — box 만 옮기면 그림이 안 따라온다.
      if (
        completed.kind === 'move' &&
        (completed.shape.kind === 'line' || completed.shape.kind === 'arrow') &&
        completed.shape.data.points !== undefined
      ) {
        const dx = completed.box.x - original.x
        const dy = completed.box.y - original.y
        nextData.points = completed.shape.data.points.map((point) => ({
          ...point,
          x: point.x + dx,
          y: point.y + dy
        }))
      }
      // 텍스트박스 리사이즈 = 줄바꿈 재배치(글자 크기 불변). 좁힌 폭에 내용이
      // 안 들어가면 높이를 내용에 맞춰 키운다 — 타이핑 자동 성장과 같은 규칙.
      if (completed.kind === 'resize' && completed.shape.kind === 'textbox') {
        const content = svgRef.current?.querySelector<HTMLElement>(
          `[data-textbox-id="${completed.shape.id}"]`
        )
        if (content !== null && content !== undefined) {
          const grown = grownTextBoxHeight(
            content.scrollHeight,
            completed.box,
            baseWidthPx,
            aspect
          )
          if (grown !== null) {
            nextData.box = { ...completed.box, height: grown }
          }
        }
      }
      onUpdate(completed.shape.id, { data: nextData })
    }
  }, [activeTool, aspect, baseWidthPx, color, onCreate, onRemove, onUpdate,
    opacity, surfaceReady, width])

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
    // select 툴 = 범용 조작(선/화살표는 이동만), text 툴 = 텍스트박스만.
    const canManipulate =
      (activeTool === 'select' &&
        SELECTABLE_KINDS.has(shape.kind) &&
        (kind === 'move' ||
          (shape.kind !== 'line' && shape.kind !== 'arrow'))) ||
      (activeTool === 'text' && shape.kind === 'textbox')
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
    if (activeTool !== 'text' && activeTool !== 'select') return
    setEditingId(shape.id)
    setTextDraft(shape.data.text ?? '')
    setEditingBoxOverride(null)
  }, [activeTool])

  const finishEditing = useCallback((shape: DrawingShape): void => {
    const cancelled = cancelEditRef.current
    cancelEditRef.current = false
    const grownBox = editingBoxOverride
    setEditingId(null)
    setEditingBoxOverride(null)
    if (cancelled) return
    if (textDraft.trim().length === 0) {
      onRemove([shape.id])
      return
    }
    const textChanged = textDraft !== (shape.data.text ?? '')
    const boxChanged = grownBox !== null
    if (!textChanged && !boxChanged) return
    onUpdate(shape.id, {
      data: {
        ...shape.data,
        ...(boxChanged ? { box: grownBox } : {}),
        text: textDraft
      }
    })
  }, [editingBoxOverride, onRemove, onUpdate, textDraft])

  /** 타이핑으로 내용이 넘치면 박스 높이를 따라 키운다 (로컬 프리뷰). */
  const growEditingBox = useCallback((
    scrollHeightPx: number,
    box: DrawingBox,
    target: 'new' | 'existing'
  ): void => {
    const grown = grownTextBoxHeight(scrollHeightPx, box, baseWidthPx, aspect)
    if (grown === null) return
    const next = { ...box, height: grown }
    if (target === 'new') setNewTextBox(next)
    else setEditingBoxOverride(next)
  }, [aspect, baseWidthPx])

  const textBoxContentStyle = useCallback((
    box: DrawingBox,
    shapeStyle: DrawingStyle
  ): CSSProperties => {
    const fontScale =
      isFinitePositive(shapeStyle.fontScale ?? 1) ? (shapeStyle.fontScale ?? 1) : 1
    const fontSize = baseWidthPx * TEXT_BASE_FONT_RATIO * fontScale
    const weight = shapeStyle.bold === true ? { fontWeight: 700 } : {}
    const scaled = foreignObjectContentStyle(box, baseWidthPx, aspect)
    if (scaled === null) return { fontSize, opacity: shapeStyle.opacity, ...weight }
    return { ...scaled, fontSize, opacity: shapeStyle.opacity, ...weight }
  }, [aspect, baseWidthPx])

  const editKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      cancelEditRef.current = true
      event.currentTarget.blur()
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  const erasedIds = gesture?.kind === 'erase' ? gesture.ids : new Set<string>()
  const style = drawingStyle(activeTool, width, opacity, color)
  const rootClassName = className === undefined ? 'ink-layer' : `ink-layer ${className}`

  // 서식 바 대상: 새 draft > 편집 중 > 선택된 텍스트박스. 제스처 중엔 숨김.
  const formatTarget = ((): {
    box: DrawingBox
    style: DrawingStyle
    onChange: (patch: Partial<DrawingStyle>) => void
  } | null => {
    if (!interactive || !surfaceReady || gesture !== null) return null
    if (newTextBox !== null && isRenderableBox(newTextBox)) {
      const current = draftStyle ?? drawingStyle('text', width, opacity, color)
      return {
        box: newTextBox,
        style: current,
        onChange: (patch) => setDraftStyle({ ...current, ...patch })
      }
    }
    const targetId = editingId ?? selectedId
    if (targetId === null) return null
    if (editingId === null && activeTool !== 'select' && activeTool !== 'text') {
      return null
    }
    const shape = shapes.find(
      (entry) => entry.id === targetId && entry.kind === 'textbox'
    )
    if (shape === undefined || !isRenderableBox(shape.data.box)) return null
    const anchor = editingId !== null && editingBoxOverride !== null
      ? editingBoxOverride
      : shape.data.box
    return {
      box: anchor,
      style: shape.style,
      onChange: (patch) =>
        onUpdate(shape.id, { style: { ...shape.style, ...patch } })
    }
  })()

  const selectionFrame = (box: DrawingBox): JSX.Element => (
    <rect
      className="ink-layer__selection-frame"
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      vectorEffect="non-scaling-stroke"
    />
  )

  return (
    <>
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
        const isSelected = selectedId === shape.id && activeTool === 'select'
        const selectProps = activeTool === 'select' && SELECTABLE_KINDS.has(shape.kind)
          ? {
              onPointerDown: (event: ReactPointerEvent<Element>) =>
                beginManipulation(event, shape, 'move')
            }
          : {}
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
          return (
            <g key={shape.id}>
              <rect className="ink-layer__mark ink-layer__mark--selectable" {...box} fill="none" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} {...selectProps} />
              {isSelected && selectionFrame(box)}
              {isSelected && (
                <ResizeHandles
                  className="ink-layer__shape-resize"
                  box={box}
                  aspect={aspect}
                  onPointerDown={(event, handle) =>
                    beginManipulation(event, shape, 'resize', handle)}
                />
              )}
            </g>
          )
        }
        if (shape.kind === 'ellipse' && isRenderableBox(box)) {
          return (
            <g key={shape.id}>
              <ellipse className="ink-layer__mark ink-layer__mark--selectable" cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} fill="none" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} {...selectProps} />
              {isSelected && selectionFrame(box)}
              {isSelected && (
                <ResizeHandles
                  className="ink-layer__shape-resize"
                  box={box}
                  aspect={aspect}
                  onPointerDown={(event, handle) =>
                    beginManipulation(event, shape, 'resize', handle)}
                />
              )}
            </g>
          )
        }
        if (shape.kind === 'line' || shape.kind === 'arrow') {
          const endpoints = lineEndpoints(shape)
          if (
            endpoints === null ||
            !isRenderableSegment(endpoints[0], endpoints[1], aspect)
          ) {
            return null
          }
          // 이동 프리뷰: 제스처 box 오프셋을 좌표에 반영한다.
          const original = shape.data.box
          const offsetX = box !== undefined && original !== undefined
            ? box.x - original.x
            : 0
          const offsetY = box !== undefined && original !== undefined
            ? box.y - original.y
            : 0
          const from = {
            ...endpoints[0],
            x: endpoints[0].x + offsetX,
            y: endpoints[0].y + offsetY
          }
          const to = {
            ...endpoints[1],
            x: endpoints[1].x + offsetX,
            y: endpoints[1].y + offsetY
          }
          return (
            <g key={shape.id} className="ink-layer__mark ink-layer__mark--selectable" stroke={markColor} strokeWidth={shape.style.width} opacity={shape.style.opacity} strokeLinecap="round" strokeLinejoin="round" fill="none" {...selectProps}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
              {shape.kind === 'arrow' && <polyline points={arrowHeadPoints(from, to, shape.style.width, aspect)} />}
              {isSelected && isRenderableBox(box) && selectionFrame(box)}
            </g>
          )
        }
        if ((shape.kind === 'clip' || shape.kind === 'image') && isRenderableBox(box)) {
          return (
            <ReferencedShape
              key={shape.id}
              shape={shape}
              box={box}
              aspect={aspect}
              baseWidthPx={baseWidthPx}
              courseId={courseId}
              selected={isSelected}
              renderClip={renderClip}
              onOpenClip={onOpenClip}
              onBeginManipulation={beginManipulation}
              onNaturalAspect={handleNaturalAspect}
            />
          )
        }
        if (shape.kind !== 'textbox' || !isRenderableBox(box)) return null
        const isEditing = editingId === shape.id
        if (!isEditing && (shape.data.text ?? '').trim().length === 0) return null
        const editedBox = isEditing && editingBoxOverride !== null
          ? editingBoxOverride
          : box
        // 리사이즈 중 글자 크기는 고정 — editedBox 가 제스처 박스라 줄바꿈이
        // 라이브로 재배치된다.
        const contentStyle = textBoxContentStyle(editedBox, shape.style)
        const textSelected =
          selectedId === shape.id &&
          (activeTool === 'select' || activeTool === 'text')
        return (
          <g key={shape.id} className="ink-layer__textbox-group">
            <foreignObject
              {...editedBox}
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
                  onChange={(event) => {
                    setTextDraft(event.target.value)
                    growEditingBox(
                      event.target.scrollHeight,
                      editedBox,
                      'existing'
                    )
                  }}
                  onBlur={() => finishEditing(shape)}
                  onKeyDown={editKeyDown}
                />
              ) : (
                <div
                  className="ink-layer__textbox"
                  data-color={shape.style.color}
                  data-textbox-id={shape.id}
                  style={contentStyle}
                >
                  {shape.data.text}
                </div>
              )}
            </foreignObject>
            {textSelected && !isEditing && selectionFrame(editedBox)}
            {textSelected && !isEditing && (
              <ResizeHandles
                className="ink-layer__textbox-resize"
                box={editedBox}
                aspect={aspect}
                fill={markColor}
                handles={TEXTBOX_HANDLES}
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
            ref={newTextAreaRef}
            className="ink-layer__textbox is-editing"
            data-color={draftStyle?.color ?? color}
            value={textDraft}
            aria-label="텍스트 입력"
            placeholder="텍스트를 입력하세요"
            style={textBoxContentStyle(
              newTextBox,
              draftStyle ?? drawingStyle('text', width, opacity, color)
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              setTextDraft(event.target.value)
              growEditingBox(event.target.scrollHeight, newTextBox, 'new')
            }}
            onBlur={() => finishNewTextBox(newTextBox)}
            onKeyDown={editKeyDown}
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
    {formatTarget !== null && (
      <TextFormatBar
        box={formatTarget.box}
        aspect={aspect}
        baseWidthPx={baseWidthPx}
        style={formatTarget.style}
        onChange={formatTarget.onChange}
        barRef={formatBarRef}
      />
    )}
    </>
  )
}
