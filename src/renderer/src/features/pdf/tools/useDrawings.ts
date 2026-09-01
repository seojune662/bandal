import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  CreateDrawingInput,
  Drawing,
  UpdateDrawingInput
} from '../../../../../shared/types/drawing'
import { invoke } from '../../../lib/ipc'
import {
  drawingFileKey,
  usePdfToolStore,
  type DrawingHistoryAction
} from './toolStore'
import { instanceSurfaceKey } from '../../ink/inkToolStore'

export interface DrawingsApi {
  drawings: Drawing[]
  byPage: Map<number, Drawing[]>
  loading: boolean
  historyBusy: boolean
  canUndo: boolean
  canRedo: boolean
  error: string | null
  create(input: CreateDrawingInput): Promise<Drawing | null>
  update(input: UpdateDrawingInput): Promise<Drawing | null>
  /** 무음 보정(손상 박스 힐링) — undo 히스토리에 기록하지 않는다. */
  refine(input: UpdateDrawingInput): Promise<Drawing | null>
  remove(ids: string[]): Promise<boolean>
  undo(): Promise<void>
  redo(): Promise<void>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return '필기 내용을 저장하는 중 오류가 발생했어요.'
}

function sortDrawings(drawings: Drawing[]): Drawing[] {
  return [...drawings].sort((left, right) =>
    left.page - right.page || left.createdAt.localeCompare(right.createdAt)
  )
}

function inputFor(drawing: Drawing): CreateDrawingInput {
  return {
    courseId: drawing.courseId,
    relPath: drawing.relPath,
    page: drawing.page,
    kind: drawing.kind,
    data: drawing.data,
    style: drawing.style
  }
}

export function useDrawings(courseId: string, relPath: string): DrawingsApi {
  // Per-mount undo stack: duplicate views of the same PDF must not share
  // history (undo in one panel would erase strokes drawn in the other).
  const instanceId = useId()
  const fileKey = instanceSurfaceKey(drawingFileKey(courseId, relPath), instanceId)
  useEffect(() => {
    return () => {
      usePdfToolStore.getState().clearHistory(fileKey)
    }
  }, [fileKey])
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const drawingsRef = useRef<Drawing[]>([])

  const canUndo = usePdfToolStore((state) =>
    (state.histories[fileKey]?.undo.length ?? 0) > 0
  )
  const canRedo = usePdfToolStore((state) =>
    (state.histories[fileKey]?.redo.length ?? 0) > 0
  )

  const replace = useCallback((next: Drawing[]): void => {
    const sorted = sortDrawings(next)
    drawingsRef.current = sorted
    setDrawings(sorted)
  }, [])

  useEffect(() => {
    let cancelled = false
    drawingsRef.current = []
    setDrawings([])
    setLoading(true)
    invoke('drawings:listForFile', { courseId, relPath })
      .then((list) => {
        if (!cancelled) {
          replace(list)
          setError(null)
          setLoading(false)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(errorMessage(cause))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [courseId, relPath, replace])

  const createInternal = useCallback(async (
    input: CreateDrawingInput,
    recordHistory: boolean
  ): Promise<Drawing | null> => {
    const now = new Date().toISOString()
    const temporary: Drawing = {
      ...input,
      id: `pending:${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now
    }
    replace([...drawingsRef.current, temporary])
    try {
      const created = await invoke('drawings:create', input)
      const withoutTemporary = drawingsRef.current.filter(
        (drawing) => drawing.id !== temporary.id
      )
      replace([...withoutTemporary.filter((drawing) => drawing.id !== created.id), created])
      if (recordHistory) {
        usePdfToolStore.getState().recordHistory(fileKey, {
          kind: 'remove',
          drawings: [created]
        })
      }
      setError(null)
      return created
    } catch (cause: unknown) {
      replace(drawingsRef.current.filter((drawing) => drawing.id !== temporary.id))
      setError(errorMessage(cause))
      return null
    }
  }, [fileKey, replace])

  const updateInternal = useCallback(async (
    input: UpdateDrawingInput,
    recordHistory: boolean
  ): Promise<Drawing | null> => {
    const before = drawingsRef.current.find((drawing) => drawing.id === input.id)
    if (before === undefined) return null
    const optimistic: Drawing = {
      ...before,
      data: input.data ?? before.data,
      style: input.style ?? before.style,
      updatedAt: new Date().toISOString()
    }
    replace(drawingsRef.current.map((drawing) =>
      drawing.id === input.id ? optimistic : drawing
    ))
    try {
      const updated = await invoke('drawings:update', input)
      replace(drawingsRef.current.map((drawing) =>
        drawing.id === updated.id ? updated : drawing
      ))
      if (recordHistory) {
        usePdfToolStore.getState().recordHistory(fileKey, {
          kind: 'update',
          drawings: [before]
        })
      }
      setError(null)
      return updated
    } catch (cause: unknown) {
      replace(drawingsRef.current.map((drawing) =>
        drawing.id === before.id ? before : drawing
      ))
      setError(errorMessage(cause))
      return null
    }
  }, [fileKey, replace])

  const removeInternal = useCallback(async (
    idsInput: string[],
    recordHistory: boolean
  ): Promise<{ ok: boolean; removed: Drawing[] }> => {
    const ids = [...new Set(idsInput)]
    const idSet = new Set(ids)
    const removed = drawingsRef.current.filter((drawing) => idSet.has(drawing.id))
    if (removed.length === 0) return { ok: true, removed: [] }
    replace(drawingsRef.current.filter((drawing) => !idSet.has(drawing.id)))
    try {
      await invoke('drawings:delete', { ids: removed.map((drawing) => drawing.id) })
      if (recordHistory) {
        usePdfToolStore.getState().recordHistory(fileKey, {
          kind: 'restore',
          drawings: removed
        })
      }
      setError(null)
      return { ok: true, removed }
    } catch (cause: unknown) {
      replace([...drawingsRef.current, ...removed])
      setError(errorMessage(cause))
      return { ok: false, removed: [] }
    }
  }, [fileKey, replace])

  const create = useCallback(
    (input: CreateDrawingInput) => createInternal(input, true),
    [createInternal]
  )
  const update = useCallback(
    (input: UpdateDrawingInput) => updateInternal(input, true),
    [updateInternal]
  )
  const refine = useCallback(
    (input: UpdateDrawingInput) => updateInternal(input, false),
    [updateInternal]
  )
  const remove = useCallback(async (ids: string[]): Promise<boolean> =>
    (await removeInternal(ids, true)).ok,
  [removeInternal])

  const executeHistory = useCallback(async (
    action: DrawingHistoryAction
  ): Promise<DrawingHistoryAction | null> => {
    if (action.kind === 'remove') {
      const result = await removeInternal(
        action.drawings.map((drawing) => drawing.id),
        false
      )
      return result.ok ? { kind: 'restore', drawings: result.removed } : null
    }
    if (action.kind === 'restore') {
      const created: Drawing[] = []
      for (const drawing of action.drawings) {
        const restored = await createInternal(inputFor(drawing), false)
        if (restored === null) {
          if (created.length > 0) {
            await removeInternal(created.map((entry) => entry.id), false)
          }
          return null
        }
        created.push(restored)
      }
      return { kind: 'remove', drawings: created }
    }

    const previous = action.drawings
      .map((target) => drawingsRef.current.find((drawing) => drawing.id === target.id))
      .filter((drawing): drawing is Drawing => drawing !== undefined)
    for (const target of action.drawings) {
      const updated = await updateInternal({
        id: target.id,
        data: target.data,
        style: target.style
      }, false)
      if (updated === null) return null
    }
    return { kind: 'update', drawings: previous }
  }, [createInternal, removeInternal, updateInternal])

  const undo = useCallback(async (): Promise<void> => {
    if (historyBusy) return
    const store = usePdfToolStore.getState()
    const action = store.beginUndo(fileKey)
    if (action === null) return
    setHistoryBusy(true)
    try {
      const inverse = await executeHistory(action)
      if (inverse === null) store.cancelUndo(fileKey, action)
      else store.finishUndo(fileKey, inverse)
    } finally {
      setHistoryBusy(false)
    }
  }, [executeHistory, fileKey, historyBusy])

  const redo = useCallback(async (): Promise<void> => {
    if (historyBusy) return
    const store = usePdfToolStore.getState()
    const action = store.beginRedo(fileKey)
    if (action === null) return
    setHistoryBusy(true)
    try {
      const inverse = await executeHistory(action)
      if (inverse === null) store.cancelRedo(fileKey, action)
      else store.finishRedo(fileKey, inverse)
    } finally {
      setHistoryBusy(false)
    }
  }, [executeHistory, fileKey, historyBusy])

  const byPage = useMemo(() => {
    const result = new Map<number, Drawing[]>()
    for (const drawing of drawings) {
      const page = result.get(drawing.page)
      if (page === undefined) result.set(drawing.page, [drawing])
      else page.push(drawing)
    }
    return result
  }, [drawings])

  return {
    drawings,
    byPage,
    loading,
    historyBusy,
    canUndo,
    canRedo,
    error,
    create,
    update,
    refine,
    remove,
    undo,
    redo
  }
}
