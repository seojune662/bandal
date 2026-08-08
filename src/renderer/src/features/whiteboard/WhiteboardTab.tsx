import type { IDockviewPanelProps } from 'dockview'
import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { DrawingShape } from '../../../../shared/types/drawing'
import type {
  OpenWhiteboardResult,
  Whiteboard,
  WhiteboardAvailability,
  WhiteboardShape
} from '../../../../shared/types/whiteboard'
import { invoke, onPush } from '../../lib/ipc'
import {
  useInkToolStore,
  type InkHistoryAction
} from '../ink'
import {
  WhiteboardCanvas,
  type DrawableWhiteboardAvailability
} from './WhiteboardCanvas'
import {
  mergeWhiteboardShapes,
  updateWhiteboardShape
} from './whiteboardModel'
import './whiteboard.css'

export const WHITEBOARD_SYNC_INTERVAL_MS = 20_000

type LoadState =
  | { phase: 'loading' }
  | { phase: 'loaded'; result: OpenWhiteboardResult }
  | { phase: 'error'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '화이트보드를 불러오는 중 오류가 발생했어요.'
}

function useDocumentVisible(): boolean {
  const [documentVisible, setDocumentVisible] = useState(
    () =>
      typeof document === 'undefined' || document.visibilityState === 'visible'
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = (): void =>
      setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  return documentVisible
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

type RendererWhiteboardPushEvent =
  | { type: 'shape'; shape: WhiteboardShape }
  | { type: 'remove'; boardId: string; ids: string[] }
  | {
      type: 'sync'
      boardId: string
      shapes: WhiteboardShape[]
      removedIds: string[]
      syncedAt: string
    }

function asPushEvent(value: unknown): RendererWhiteboardPushEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const event = value as Record<string, unknown>
  if (event['type'] === 'shape') {
    const shape = event['shape'] as WhiteboardShape | undefined
    return shape !== undefined && typeof shape.id === 'string' &&
      typeof shape.boardId === 'string'
      ? { type: 'shape', shape }
      : null
  }
  if (event['type'] === 'remove') {
    const ids = event['ids']
    return typeof event['boardId'] === 'string' && Array.isArray(ids)
      ? {
          type: 'remove',
          boardId: event['boardId'],
          ids: ids.filter((id): id is string => typeof id === 'string')
        }
      : null
  }
  if (event['type'] === 'sync') {
    const shapes = event['shapes']
    const removedIds = event['removedIds']
    return typeof event['boardId'] === 'string' && Array.isArray(shapes) &&
      Array.isArray(removedIds) && typeof event['syncedAt'] === 'string'
      ? {
          type: 'sync',
          boardId: event['boardId'],
          shapes: shapes as WhiteboardShape[],
          removedIds: removedIds.filter(
            (id): id is string => typeof id === 'string'
          ),
          syncedAt: event['syncedAt']
        }
      : null
  }
  return null
}

export function settleWhiteboardUndo(
  surfaceKey: string,
  execute: (action: InkHistoryAction) => InkHistoryAction | null
): void {
  const store = useInkToolStore.getState()
  const action = store.beginUndo(surfaceKey)
  if (action === null) return
  const inverse = execute(action)
  // A stale action is deliberately discarded. Putting it back would leave a
  // permanently live undo button that can never reach the entry below it.
  if (inverse !== null) store.finishUndo(surfaceKey, inverse)
}

export function settleWhiteboardRedo(
  surfaceKey: string,
  execute: (action: InkHistoryAction) => InkHistoryAction | null
): void {
  const store = useInkToolStore.getState()
  const action = store.beginRedo(surfaceKey)
  if (action === null) return
  const inverse = execute(action)
  if (inverse !== null) store.finishRedo(surfaceKey, inverse)
}

interface WhiteboardSessionProps {
  board: Whiteboard
  availability: DrawableWhiteboardAvailability
  initialShapes: readonly DrawingShape[]
  panelActive: boolean
}

function WhiteboardSession({
  board,
  availability,
  initialShapes,
  panelActive
}: WhiteboardSessionProps): JSX.Element {
  const surfaceKey = `whiteboard:${board.id}`
  const [shapes, setShapes] = useState<DrawingShape[]>(() =>
    mergeWhiteboardShapes([], initialShapes)
  )
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const shapesRef = useRef(shapes)
  const removedIdsRef = useRef(new Set<string>())
  const syncedAtRef = useRef<string | null>(null)
  const documentVisible = useDocumentVisible()
  const sessionActive = panelActive && documentVisible
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
    const next = updateWhiteboardShape(
      shapesRef.current,
      id,
      patch,
      new Date().toISOString()
    )
    const updated = next.find((shape) => shape.id === id)
    if (updated === undefined) return null
    replace(next)
    if (recordHistory) {
      useInkToolStore.getState().recordHistory(surfaceKey, {
        kind: 'update',
        drawings: [before]
      })
    }
    void invoke('whiteboard:updateShape', {
      boardId: board.id,
      id: updated.id,
      shape: {
        kind: updated.kind,
        data: updated.data,
        style: updated.style
      }
    }).then((saved) => {
      replace(mergeWhiteboardShapes(
        shapesRef.current,
        [saved],
        [...removedIdsRef.current]
      ))
      setStatusMessage(null)
    }).catch(showSaveError)
    return updated
  }, [board.id, replace, showSaveError, surfaceKey])

  const executeHistory = useCallback((
    action: InkHistoryAction
  ): InkHistoryAction | null => {
    if (action.kind === 'remove') {
      const removed = removeInternal(action.drawings.map((shape) => shape.id), false)
      return removed.length === 0
        ? null
        : { kind: 'restore', drawings: removed }
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
      inverse.push(current)
    }
    return { kind: 'update', drawings: inverse }
  }, [addInternal, removeInternal, updateInternal])

  const undo = useCallback((): void => {
    settleWhiteboardUndo(surfaceKey, executeHistory)
  }, [executeHistory, surfaceKey])

  const redo = useCallback((): void => {
    settleWhiteboardRedo(surfaceKey, executeHistory)
  }, [executeHistory, surfaceKey])

  useEffect(() => {
    if (!sessionActive) return
    return onPush('whiteboard:changed', ({ groupId, event: rawEvent }) => {
      if (groupId !== board.groupId) return
      const event = asPushEvent(rawEvent)
      const eventBoardId = event?.type === 'shape'
        ? event.shape.boardId
        : event?.boardId
      if (event === null || eventBoardId !== board.id) return
      if (event.type === 'shape') {
        replace(mergeWhiteboardShapes(
          shapesRef.current,
          [event.shape],
          [...removedIdsRef.current]
        ))
        return
      }
      const removedIds = event.type === 'remove'
        ? event.ids
        : event.removedIds
      for (const id of removedIds) removedIdsRef.current.add(id)
      replace(mergeWhiteboardShapes(
        shapesRef.current,
        event.type === 'sync' ? event.shapes : [],
        [...removedIdsRef.current]
      ))
      if (event.type === 'sync') syncedAtRef.current = event.syncedAt
    })
  }, [board.groupId, board.id, replace, sessionActive])

  useEffect(() => {
    if (!sessionActive || availability.state !== 'ready') return
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
  }, [availability.state, board.id, replace, sessionActive])

  return (
    <WhiteboardCanvas
      availability={availability}
      shapes={shapes}
      canUndo={canUndo}
      canRedo={canRedo}
      controlsEnabled={sessionActive}
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

export interface GroupWhiteboardViewProps {
  groupId: string
  api: IDockviewPanelProps['api']
}

export function GroupWhiteboardView(
  props: GroupWhiteboardViewProps
): JSX.Element {
  const { groupId, api } = props
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' })
  const panelActive = usePanelActive(api)

  useEffect(() => {
    if (!panelActive) return
    let cancelled = false
    setLoadState({ phase: 'loading' })
    void invoke('whiteboard:open', { groupId }).then((result) => {
      if (!cancelled) setLoadState({ phase: 'loaded', result })
    }).catch((error: unknown) => {
      if (!cancelled) {
        setLoadState({ phase: 'error', message: errorMessage(error) })
      }
    })
    return () => {
      cancelled = true
      void invoke('whiteboard:close', { groupId })
    }
  }, [groupId, panelActive])

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
  if (
    availability.state === 'signed-out' ||
    availability.state === 'unconfigured'
  ) {
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
      panelActive={panelActive}
    />
  )
}
