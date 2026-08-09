import type { IDockviewPanelProps } from 'dockview'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type RefObject
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import type {
  DrawingBox,
  DrawingClipSource,
  DrawingShape
} from '../../../../shared/types/drawing'
import type {
  BoardBackground,
  OpenPersonalBoardResult,
  PersonalBoard,
  SetBoardBackgroundInput
} from '../../../../shared/types/whiteboard'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import {
  InkLayer,
  useInkToolStore,
  type InkHistoryAction
} from '../ink'
import {
  BANDAL_CLIP_MIME,
  readBandalClipDragData
} from '../pdf/clipTransfer'
import { requestPdfPageNavigation } from '../pdf/pdfPageNavigation'
import { CLIP_DELIVERY_EVENT, takeClipDeliveries } from './clipDelivery'
import { createPdfClipRenderer } from '../pdf/renderClip'
import { openMaterialInCourse } from '../workspace/openMaterial'
import { isTabDescriptor } from '../workspace/tabIdentity'
import {
  clipBoxAtDrop,
  createOptimisticCanvasShape,
  putOptimisticCanvasShape,
  removeOptimisticCanvasShapes,
  updateOptimisticCanvasShape,
  type CanvasShapeInput
} from './canvasModel'
import { CanvasToolRail } from './CanvasToolRail'
import './canvas.css'

type LoadState =
  | { phase: 'loading' }
  | { phase: 'loaded'; result: OpenPersonalBoardResult }
  | { phase: 'error'; message: string }

interface CanvasSize {
  width: number
  height: number
}

function sameDrawingBox(left: DrawingBox | undefined, right: DrawingBox): boolean {
  return left !== undefined &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
}

function provisionalClipAspect(source: DrawingClipSource): number {
  const pageAspect = Math.SQRT2
  const crop = source.crop
  return crop === undefined
    ? pageAspect
    : pageAspect * crop.height / crop.width
}

function readImageAspect(dataUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      resolve(image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : null)
    }
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function descriptorFromParams(
  params: unknown
): { courseId: string; boardId: string } | null {
  if (typeof params !== 'object' || params === null) return null
  const descriptor = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(descriptor) && descriptor.kind === 'whiteboard'
    ? descriptor.payload
    : null
}

function useCanvasSize(ref: RefObject<HTMLDivElement>): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const update = (width: number, height: number): void => {
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      )
    }
    const rect = element.getBoundingClientRect()
    update(rect.width, rect.height)
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

function usePanelActive(api: IDockviewPanelProps['api']): boolean {
  const [active, setActive] = useState(() => api.isActive && api.isVisible)

  useEffect(() => {
    const update = (): void => setActive(api.isActive && api.isVisible)
    const activeDisposable = api.onDidActiveChange(update)
    const visibleDisposable = api.onDidVisibilityChange(update)
    return () => {
      activeDisposable.dispose()
      visibleDisposable.dispose()
    }
  }, [api])

  return active
}

export function canvasUndoKey(boardId: string): string {
  return `personal-canvas:${boardId}`
}

interface CanvasSessionProps {
  initialBoard: PersonalBoard
  initialShapes: readonly DrawingShape[]
  panelApi: IDockviewPanelProps['api']
}

function CanvasSession({
  initialBoard,
  initialShapes,
  panelApi
}: CanvasSessionProps): JSX.Element {
  const surfaceKey = canvasUndoKey(initialBoard.id)
  const [board, setBoard] = useState(initialBoard)
  const [shapes, setShapes] = useState<DrawingShape[]>(() => [...initialShapes])
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(initialBoard.title)
  const [renaming, setRenaming] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const shapesRef = useRef(shapes)
  const operationRef = useRef(new Map<string, number>())
  const cancelledTitleRenameRef = useRef(false)
  const size = useCanvasSize(canvasRef)
  const panelActive = usePanelActive(panelApi)
  const activeTool = useInkToolStore((state) => state.activeTool)
  const color = useInkToolStore((state) => state.color)
  const width = useInkToolStore((state) => state.width)
  const opacity = useInkToolStore((state) => state.opacity)
  const canUndo = useInkToolStore((state) =>
    (state.histories[surfaceKey]?.undo.length ?? 0) > 0
  )
  const canRedo = useInkToolStore((state) =>
    (state.histories[surfaceKey]?.redo.length ?? 0) > 0
  )
  const renderClip = useMemo(
    () => createPdfClipRenderer(initialBoard.courseId),
    [initialBoard.courseId]
  )

  const replace = useCallback((next: DrawingShape[]): void => {
    shapesRef.current = next
    setShapes(next)
  }, [])

  const nextOperation = useCallback((id: string): number => {
    const next = (operationRef.current.get(id) ?? 0) + 1
    operationRef.current.set(id, next)
    return next
  }, [])

  const showSaveError = useCallback((error: unknown): void => {
    setStatusMessage(errorMessage(error, '화이트보드 내용을 저장하지 못했어요.'))
  }, [])

  const persistShape = useCallback((
    shape: DrawingShape,
    restore = false
  ): void => {
    const operation = nextOperation(shape.id)
    void invoke('canvas:putShape', {
      boardId: board.id,
      id: shape.id,
      shape: {
        kind: shape.kind,
        data: shape.data,
        style: shape.style
      },
      // Only undo may revive an erased shape. Every other save leaves a
      // tombstone alone, so a late in-flight write cannot un-erase.
      ...(restore ? { restore: true } : {})
    }).then((saved) => {
      if (
        operationRef.current.get(shape.id) === operation &&
        shapesRef.current.some((entry) => entry.id === shape.id)
      ) {
        replace(putOptimisticCanvasShape(shapesRef.current, saved))
      }
      setStatusMessage(null)
    }).catch(showSaveError)
  }, [board.id, nextOperation, replace, showSaveError])

  const addInternal = useCallback((
    input: CanvasShapeInput,
    recordHistory: boolean
  ): DrawingShape => {
    const optimistic = createOptimisticCanvasShape(
      input,
      uuidv4(),
      new Date().toISOString()
    )
    replace(putOptimisticCanvasShape(shapesRef.current, optimistic))
    if (recordHistory) {
      useInkToolStore.getState().recordHistory(surfaceKey, {
        kind: 'remove',
        drawings: [optimistic]
      })
    }
    persistShape(optimistic)
    return optimistic
  }, [persistShape, replace, surfaceKey])

  const restoreInternal = useCallback((
    shape: DrawingShape,
    recordHistory: boolean
  ): DrawingShape => {
    const restored = {
      ...shape,
      updatedAt: new Date().toISOString()
    }
    replace(putOptimisticCanvasShape(shapesRef.current, restored))
    if (recordHistory) {
      useInkToolStore.getState().recordHistory(surfaceKey, {
        kind: 'remove',
        drawings: [restored]
      })
    }
    persistShape(restored, true)
    return restored
  }, [persistShape, replace, surfaceKey])

  const removeInternal = useCallback((
    idsInput: readonly string[],
    recordHistory: boolean
  ): DrawingShape[] => {
    const ids = [...new Set(idsInput)]
    const idSet = new Set(ids)
    const removed = shapesRef.current.filter((shape) => idSet.has(shape.id))
    if (removed.length === 0) return []
    for (const shape of removed) nextOperation(shape.id)
    replace(removeOptimisticCanvasShapes(shapesRef.current, ids))
    if (recordHistory) {
      useInkToolStore.getState().recordHistory(surfaceKey, {
        kind: 'restore',
        drawings: removed
      })
    }
    void invoke('canvas:removeShapes', {
      boardId: board.id,
      ids: removed.map((shape) => shape.id)
    }).then(() => setStatusMessage(null)).catch(showSaveError)
    return removed
  }, [board.id, nextOperation, replace, showSaveError, surfaceKey])

  const updateInternal = useCallback((
    id: string,
    patch: Partial<Pick<DrawingShape, 'data' | 'style'>>,
    recordHistory: boolean
  ): DrawingShape | null => {
    const before = shapesRef.current.find((shape) => shape.id === id)
    if (before === undefined) return null
    const now = new Date().toISOString()
    const nextShapes = updateOptimisticCanvasShape(
      shapesRef.current,
      id,
      patch,
      now
    )
    const updated = nextShapes.find((shape) => shape.id === id)
    if (updated === undefined) return null
    replace(nextShapes)
    if (recordHistory) {
      useInkToolStore.getState().recordHistory(surfaceKey, {
        kind: 'update',
        drawings: [before]
      })
    }
    persistShape(updated)
    return updated
  }, [persistShape, replace, surfaceKey])

  const executeHistory = useCallback((
    action: InkHistoryAction
  ): InkHistoryAction | null => {
    if (action.kind === 'remove') {
      const removed = removeInternal(
        action.drawings.map((shape) => shape.id),
        false
      )
      return removed.length === 0
        ? null
        : { kind: 'restore', drawings: removed }
    }
    if (action.kind === 'restore') {
      const restored = action.drawings.map((shape) =>
        restoreInternal(shape, false)
      )
      return { kind: 'remove', drawings: restored }
    }

    const inverse: DrawingShape[] = []
    for (const target of action.drawings) {
      const current = shapesRef.current.find((shape) => shape.id === target.id)
      if (current === undefined) return null
      const updated = updateInternal(
        target.id,
        { data: target.data, style: target.style },
        false
      )
      if (updated === null) return null
      inverse.push(current)
    }
    return { kind: 'update', drawings: inverse }
  }, [removeInternal, restoreInternal, updateInternal])

  const undo = useCallback((): void => {
    const store = useInkToolStore.getState()
    const action = store.beginUndo(surfaceKey)
    if (action === null) return
    const inverse = executeHistory(action)
    if (inverse === null) store.cancelUndo(surfaceKey, action)
    else store.finishUndo(surfaceKey, inverse)
  }, [executeHistory, surfaceKey])

  const redo = useCallback((): void => {
    const store = useInkToolStore.getState()
    const action = store.beginRedo(surfaceKey)
    if (action === null) return
    const inverse = executeHistory(action)
    if (inverse === null) store.cancelRedo(surfaceKey, action)
    else store.finishRedo(surfaceKey, inverse)
  }, [executeHistory, surfaceKey])

  const renameBoard = useCallback(async (): Promise<void> => {
    if (cancelledTitleRenameRef.current) {
      cancelledTitleRenameRef.current = false
      return
    }
    const title = titleDraft.trim()
    if (title.length === 0) {
      setStatusMessage('화이트보드 이름을 입력해 주세요.')
      titleInputRef.current?.focus()
      return
    }
    if (title === board.title) {
      setEditingTitle(false)
      return
    }
    setRenaming(true)
    try {
      const renamed = await invoke('canvas:rename', { id: board.id, title })
      setBoard(renamed)
      setTitleDraft(renamed.title)
      setEditingTitle(false)
      setStatusMessage(null)
    } catch (error: unknown) {
      setStatusMessage(errorMessage(error, '화이트보드 이름을 바꾸지 못했어요.'))
    } finally {
      setRenaming(false)
    }
  }, [board.id, board.title, titleDraft])

  const updateBoardAppearance = useCallback(async (
    patch: Omit<SetBoardBackgroundInput, 'boardId'>
  ): Promise<void> => {
    setBackgroundBusy(true)
    try {
      const updated = await invoke('canvas:setBackground', {
        boardId: board.id,
        ...patch
      })
      setBoard(updated)
      setStatusMessage(null)
    } catch (error: unknown) {
      showToast(
        errorMessage(error, '화이트보드 배경을 저장하지 못했어요.'),
        'danger'
      )
    } finally {
      setBackgroundBusy(false)
    }
  }, [board.id])

  const exportBoardPdf = useCallback(async (): Promise<void> => {
    setExportingPdf(true)
    try {
      const result = await invoke('canvas:exportPdf', { boardId: board.id })
      showToast(`과목 폴더에 PDF로 내보냈어요: ${result.relPath}`)
    } catch (error: unknown) {
      showToast(errorMessage(error, 'PDF로 내보내지 못했어요.'), 'danger')
    } finally {
      setExportingPdf(false)
    }
  }, [board.id])

  useEffect(() => {
    panelApi.setTitle(board.title)
  }, [board.title, panelApi])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select()
  }, [editingTitle])

  const hasMeasuredCanvas = Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  const aspect = hasMeasuredCanvas ? size.height / size.width : 0
  const baseWidthPx = hasMeasuredCanvas ? size.width : 0

  const handleDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    if (!Array.from(event.dataTransfer.types).includes(BANDAL_CLIP_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const placeClip = useCallback((
    source: DrawingClipSource,
    point: { x: number; y: number }
  ): void => {
    const initialBox = clipBoxAtDrop(point, aspect, provisionalClipAspect(source))
    const created = addInternal({
      kind: 'clip',
      data: { box: initialBox, clip: source },
      style: { color, width, opacity: 1 }
    }, true)

    // The placeholder lands immediately. Once the visible clip renderer has
    // the real crop, refine only an untouched provisional box to its exact ratio.
    void renderClip(source).then((dataUrl) =>
      dataUrl === null ? null : readImageAspect(dataUrl)
    ).then((clipAspect) => {
      if (clipAspect === null) return
      const current = shapesRef.current.find((shape) => shape.id === created.id)
      if (current === undefined || !sameDrawingBox(current.data.box, initialBox)) return
      updateInternal(created.id, {
        data: {
          ...current.data,
          box: clipBoxAtDrop(point, aspect, clipAspect)
        }
      }, false)
    }).catch(() => {})
  }, [addInternal, aspect, color, renderClip, updateInternal, width])

  const handleDrop = useCallback((event: ReactDragEvent<HTMLDivElement>): void => {
    const source = readBandalClipDragData(event.dataTransfer)
    if (source === null) return
    const surface = canvasRef.current
    if (surface === null) return
    const bounds = surface.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    event.preventDefault()
    placeClip(source, {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
    })
  }, [placeClip])

  // Clips sent from a PDF by clicking, rather than dragged onto the surface.
  // They wait until the board is measured, otherwise the box would be sized
  // against an aspect of 0 and come out wrong.
  useEffect(() => {
    if (!hasMeasuredCanvas) return
    const drain = (): void => {
      for (const [index, source] of takeClipDeliveries(board.id).entries()) {
        // Count what is already here, not just this batch: sending three pages
        // one at a time is three separate batches, and they would otherwise
        // land on exactly the same spot and hide each other.
        const placed =
          shapesRef.current.filter((shape) => shape.kind === 'clip').length +
          index
        const offset = Math.min(placed, 8) * 0.035
        placeClip(source, { x: 0.28 + offset, y: 0.16 + offset })
      }
    }
    drain()
    window.addEventListener(CLIP_DELIVERY_EVENT, drain)
    return () => window.removeEventListener(CLIP_DELIVERY_EVENT, drain)
  }, [board.id, hasMeasuredCanvas, placeClip])

  const openClip = useCallback((source: DrawingClipSource): void => {
    openMaterialInCourse(board.courseId, 'pdf', source.relPath)
    requestPdfPageNavigation({
      courseId: board.courseId,
      relPath: source.relPath,
      page: source.page
    })
  }, [board.courseId])

  return (
    <section
      className="canvas-tab"
      data-tool={activeTool}
      data-background={board.background}
      data-surface={board.surface}
    >
      <header className="canvas-tab__header">
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="canvas-tab__title-input"
            value={titleDraft}
            aria-label="화이트보드 이름"
            disabled={renaming}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => void renameBoard()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                cancelledTitleRenameRef.current = true
                setTitleDraft(board.title)
                setEditingTitle(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="canvas-tab__title"
            aria-label={`${board.title} 이름 변경`}
            title="이름 변경"
            onClick={() => {
              cancelledTitleRenameRef.current = false
              setEditingTitle(true)
            }}
          >
            {board.title}
          </button>
        )}
        <span className="canvas-tab__local-badge">이 기기에 저장됨</span>
      </header>

      <CanvasToolRail
        canUndo={canUndo}
        canRedo={canRedo}
        enabled={panelActive}
        background={board.background}
        surface={board.surface}
        backgroundBusy={backgroundBusy}
        exportingPdf={exportingPdf}
        onUndo={undo}
        onRedo={redo}
        onBackgroundChange={(background: BoardBackground) => {
          void updateBoardAppearance({ background })
        }}
        onSurfaceToggle={() => {
          void updateBoardAppearance({
            surface: board.surface === 'light' ? 'dark' : 'light'
          })
        }}
        onExportPdf={() => { void exportBoardPdf() }}
      />

      {statusMessage !== null && (
        <p className="canvas-tab__status" role="status">{statusMessage}</p>
      )}

      <div className="canvas-tab__viewport">
        <div
          ref={canvasRef}
          className="canvas-tab__surface"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <InkLayer
            aspect={aspect}
            baseWidthPx={baseWidthPx}
            shapes={shapes}
            tool={{ activeTool, color, width, opacity }}
            onCreate={(shape) => { addInternal(shape, true) }}
            onUpdate={(id, patch) => { updateInternal(id, patch, true) }}
            onRemove={(ids) => { removeInternal(ids, true) }}
            clampToBounds={true}
            deferTextCreation
            ariaLabel={`${board.title} 개인 화이트보드 캔버스`}
            className="canvas-tab__ink-layer"
            renderClip={renderClip}
            onOpenClip={openClip}
          />
        </div>
      </div>
    </section>
  )
}

export default function CanvasTab(props: IDockviewPanelProps): JSX.Element {
  const descriptor = descriptorFromParams(props.params)
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    if (descriptor === null) return
    let cancelled = false
    setLoadState({ phase: 'loading' })
    void invoke('canvas:open', { boardId: descriptor.boardId }).then((result) => {
      if (cancelled) return
      if (result.board.courseId !== descriptor.courseId) {
        setLoadState({
          phase: 'error',
          message: '이 화이트보드는 현재 과목에 속하지 않아요.'
        })
        return
      }
      setLoadState({ phase: 'loaded', result })
    }).catch((error: unknown) => {
      if (!cancelled) {
        setLoadState({
          phase: 'error',
          message: errorMessage(error, '화이트보드를 불러오지 못했어요.')
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [descriptor?.boardId, descriptor?.courseId])

  if (descriptor === null) {
    return <div className="canvas-state" data-state="invalid" />
  }
  if (loadState.phase === 'loading') {
    return (
      <div className="canvas-state" data-state="loading">
        <p>화이트보드를 불러오는 중…</p>
      </div>
    )
  }
  if (loadState.phase === 'error') {
    return (
      <div className="canvas-state" data-state="error">
        <h2>화이트보드를 열지 못했어요</h2>
        <p>{loadState.message}</p>
      </div>
    )
  }

  return (
    <CanvasSession
      key={loadState.result.board.id}
      initialBoard={loadState.result.board}
      initialShapes={loadState.result.shapes}
      panelApi={props.api}
    />
  )
}
