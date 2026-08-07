import type { IDockviewPanelProps } from 'dockview'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject
} from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { DrawingShape } from '../../../../shared/types/drawing'
import type {
  OpenPersonalBoardResult,
  PersonalBoard
} from '../../../../shared/types/whiteboard'
import { invoke } from '../../lib/ipc'
import {
  InkLayer,
  useInkToolStore,
  type InkHistoryAction
} from '../ink'
import { isTabDescriptor } from '../workspace/tabIdentity'
import {
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

  const persistShape = useCallback((shape: DrawingShape): void => {
    const operation = nextOperation(shape.id)
    void invoke('canvas:putShape', {
      boardId: board.id,
      id: shape.id,
      shape: {
        kind: shape.kind,
        data: shape.data,
        style: shape.style
      }
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
    persistShape(restored)
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

  useEffect(() => {
    panelApi.setTitle(board.title)
  }, [board.title, panelApi])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select()
  }, [editingTitle])

  const aspect = size.width > 0 ? size.height / size.width : 1
  const baseWidthPx = size.width > 0 ? size.width : 1

  return (
    <section className="canvas-tab" data-tool={activeTool}>
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
        onUndo={undo}
        onRedo={redo}
      />

      {statusMessage !== null && (
        <p className="canvas-tab__status" role="status">{statusMessage}</p>
      )}

      <div className="canvas-tab__viewport">
        <div ref={canvasRef} className="canvas-tab__surface">
          <InkLayer
            aspect={aspect}
            baseWidthPx={baseWidthPx}
            shapes={shapes}
            tool={{ activeTool, color, width, opacity }}
            onCreate={(shape) => { addInternal(shape, true) }}
            onUpdate={(id, patch) => { updateInternal(id, patch, true) }}
            onRemove={(ids) => { removeInternal(ids, true) }}
            clampToBounds={true}
            ariaLabel={`${board.title} 개인 화이트보드 캔버스`}
            className="canvas-tab__ink-layer"
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
