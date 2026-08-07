import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { v4 as uuidv4 } from 'uuid'
import type { DrawingShape } from '../../../../shared/types/drawing'
import type {
  OpenWhiteboardResult,
  Whiteboard,
  WhiteboardAvailability
} from '../../../../shared/types/whiteboard'
import { invoke } from '../../lib/ipc'
import {
  useInkToolStore,
  type InkHistoryAction
} from '../ink'
import { isTabDescriptor } from '../workspace/tabIdentity'
import {
  WhiteboardCanvas,
  type DrawableWhiteboardAvailability
} from './WhiteboardCanvas'
import { mergeWhiteboardShapes } from './whiteboardModel'
import './whiteboard.css'

export const WHITEBOARD_SYNC_INTERVAL_MS = 4_000

type LoadState =
  | { phase: 'loading' }
  | { phase: 'loaded'; result: OpenWhiteboardResult }
  | { phase: 'error'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '화이트보드를 불러오는 중 오류가 발생했어요.'
}

function groupIdFromParams(params: unknown): string | null {
  if (typeof params !== 'object' || params === null) return null
  const descriptor = (params as Record<string, unknown>)['descriptor']
  return isTabDescriptor(descriptor) && descriptor.kind === 'group-whiteboard'
    ? descriptor.payload.groupId
    : null
}

function usePanelVisible(api: IDockviewPanelProps['api']): boolean {
  const [panelActive, setPanelActive] = useState(
    () => api.isActive && api.isVisible
  )
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  )

  useEffect(() => {
    const update = (): void => setPanelActive(api.isActive && api.isVisible)
    const activeDisposable = api.onDidActiveChange(update)
    const visibleDisposable = api.onDidVisibilityChange(update)
    return () => {
      activeDisposable.dispose()
      visibleDisposable.dispose()
    }
  }, [api])

  useEffect(() => {
    const update = (): void => setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  return panelActive && documentVisible
}

interface WhiteboardSessionProps {
  board: Whiteboard
  availability: DrawableWhiteboardAvailability
  initialShapes: readonly DrawingShape[]
  panelApi: IDockviewPanelProps['api']
}

function WhiteboardSession({
  board,
  availability,
  initialShapes,
  panelApi
}: WhiteboardSessionProps): JSX.Element {
  const surfaceKey = `whiteboard:${board.id}`
  const [shapes, setShapes] = useState<DrawingShape[]>(() =>
    mergeWhiteboardShapes([], initialShapes)
  )
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const shapesRef = useRef(shapes)
  const removedIdsRef = useRef(new Set<string>())
  const syncedAtRef = useRef<string | null>(null)
  const panelVisible = usePanelVisible(panelApi)
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

  const showSaveError = useCallback((error: unknown): void => {
    setStatusMessage(
      error instanceof Error
        ? error.message
        : '화이트보드 내용을 저장하지 못했어요.'
    )
  }, [])

  const addInternal = useCallback((
    input: Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'>,
    recordHistory: boolean
  ): DrawingShape => {
    const now = new Date().toISOString()
    const optimistic: DrawingShape = {
      ...input,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now
    }
    replace(mergeWhiteboardShapes(shapesRef.current, [optimistic]))
    if (recordHistory) {
      useInkToolStore.getState().recordHistory(surfaceKey, {
        kind: 'remove',
        drawings: [optimistic]
      })
    }
    void invoke('whiteboard:addShape', {
      boardId: board.id,
      id: optimistic.id,
      shape: input
    }).then((saved) => {
      replace(mergeWhiteboardShapes(
        shapesRef.current,
        [saved],
        [...removedIdsRef.current]
      ))
      setStatusMessage(null)
    }).catch(showSaveError)
    return optimistic
  }, [board.id, replace, showSaveError, surfaceKey])

  const removeInternal = useCallback((
    idsInput: readonly string[],
    recordHistory: boolean
  ): DrawingShape[] => {
    const ids = [...new Set(idsInput)]
    const idSet = new Set(ids)
    const removed = shapesRef.current.filter((shape) => idSet.has(shape.id))
    if (removed.length === 0) return []
    for (const id of ids) removedIdsRef.current.add(id)
    replace(mergeWhiteboardShapes(shapesRef.current, [], ids))
    if (recordHistory) {
      useInkToolStore.getState().recordHistory(surfaceKey, {
        kind: 'restore',
        drawings: removed
      })
    }
    void invoke('whiteboard:removeShapes', {
      boardId: board.id,
      ids: removed.map((shape) => shape.id)
    }).then(() => setStatusMessage(null)).catch(showSaveError)
    return removed
  }, [board.id, replace, showSaveError, surfaceKey])

  const updateInternal = useCallback((
    id: string,
    patch: Partial<Pick<DrawingShape, 'data' | 'style'>>,
    recordHistory: boolean
  ): DrawingShape | null => {
    const before = shapesRef.current.find((shape) => shape.id === id)
    if (before === undefined) return null
    removeInternal([id], false)
    const replacement = addInternal({
      kind: before.kind,
      data: patch.data ?? before.data,
      style: patch.style ?? before.style
    }, false)
    if (recordHistory) {
      useInkToolStore.getState().recordHistory(surfaceKey, {
        kind: 'update',
        drawings: [{ ...before, id: replacement.id }]
      })
    }
    return replacement
  }, [addInternal, removeInternal, surfaceKey])

  const executeHistory = useCallback((
    action: InkHistoryAction
  ): InkHistoryAction | null => {
    if (action.kind === 'remove') {
      const removed = removeInternal(action.drawings.map((shape) => shape.id), false)
      return { kind: 'restore', drawings: removed }
    }
    if (action.kind === 'restore') {
      const restored = action.drawings.map((shape) => addInternal({
        kind: shape.kind,
        data: shape.data,
        style: shape.style
      }, false))
      return { kind: 'remove', drawings: restored }
    }

    const inverse: DrawingShape[] = []
    for (const target of action.drawings) {
      const current = shapesRef.current.find((shape) => shape.id === target.id)
      if (current === undefined) return null
      const replacement = updateInternal(target.id, {
        data: target.data,
        style: target.style
      }, false)
      if (replacement === null) return null
      inverse.push({ ...current, id: replacement.id })
    }
    return { kind: 'update', drawings: inverse }
  }, [addInternal, removeInternal, updateInternal])

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

  useEffect(() => {
    if (!panelVisible || availability.state !== 'ready') return
    let cancelled = false
    let inFlight = false
    const sync = async (): Promise<void> => {
      if (inFlight) return
      inFlight = true
      try {
        const result = await invoke('whiteboard:sync', {
          boardId: board.id,
          since: syncedAtRef.current
        })
        if (!cancelled) {
          for (const id of result.removedIds) removedIdsRef.current.add(id)
          replace(mergeWhiteboardShapes(
            shapesRef.current,
            result.shapes,
            [...removedIdsRef.current]
          ))
          syncedAtRef.current = result.syncedAt
          setStatusMessage(null)
        }
      } catch (error: unknown) {
        if (!cancelled) setStatusMessage(errorMessage(error))
      } finally {
        inFlight = false
      }
    }
    void sync()
    const timer = window.setInterval(() => void sync(), WHITEBOARD_SYNC_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [availability.state, board.id, panelVisible, replace])

  return (
    <WhiteboardCanvas
      availability={availability}
      shapes={shapes}
      canUndo={canUndo}
      canRedo={canRedo}
      controlsEnabled={panelVisible}
      statusMessage={statusMessage}
      onCreate={(shape) => { addInternal(shape, true) }}
      onUpdate={(id, patch) => { updateInternal(id, patch, true) }}
      onRemove={(ids) => { removeInternal(ids, true) }}
      onUndo={undo}
      onRedo={redo}
    />
  )
}

function AvailabilityMessage({
  availability
}: { availability: WhiteboardAvailability }): JSX.Element {
  const message = availability.state === 'signed-out'
    ? '공유 화이트보드를 사용하려면 먼저 로그인해 주세요.'
    : '이 빌드에서는 함께하기 기능을 사용할 수 없어요.'
  return (
    <div className="whiteboard-state" data-availability={availability.state}>
      <h2 className="whiteboard-state__title">화이트보드</h2>
      <p className="whiteboard-state__message">{message}</p>
    </div>
  )
}

export default function WhiteboardTab(props: IDockviewPanelProps): JSX.Element {
  const groupId = groupIdFromParams(props.params)
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    if (groupId === null) return
    let cancelled = false
    setLoadState({ phase: 'loading' })
    void invoke('whiteboard:open', { groupId }).then((result) => {
      if (!cancelled) setLoadState({ phase: 'loaded', result })
    }).catch((error: unknown) => {
      if (!cancelled) setLoadState({ phase: 'error', message: errorMessage(error) })
    })
    return () => {
      cancelled = true
    }
  }, [groupId])

  if (groupId === null) {
    return <div className="whiteboard-state" data-availability="invalid" />
  }
  if (loadState.phase === 'loading') {
    return (
      <div className="whiteboard-state" data-availability="loading">
        <p className="whiteboard-state__message">화이트보드를 불러오는 중…</p>
      </div>
    )
  }
  if (loadState.phase === 'error') {
    return (
      <div className="whiteboard-state" data-availability="error">
        <h2 className="whiteboard-state__title">화이트보드를 열지 못했어요</h2>
        <p className="whiteboard-state__message">{loadState.message}</p>
      </div>
    )
  }

  const { availability, board, shapes } = loadState.result
  if (availability.state === 'signed-out' || availability.state === 'unconfigured') {
    return <AvailabilityMessage availability={availability} />
  }
  if (board === null) {
    return (
      <div className="whiteboard-state" data-availability="error">
        <h2 className="whiteboard-state__title">로컬 화이트보드를 준비하지 못했어요</h2>
        <p className="whiteboard-state__message">탭을 닫았다가 다시 열어 주세요.</p>
      </div>
    )
  }

  return (
    <WhiteboardSession
      key={board.id}
      board={board}
      availability={availability}
      initialShapes={shapes}
      panelApi={props.api}
    />
  )
}
