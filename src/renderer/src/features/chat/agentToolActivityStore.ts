import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import type {
  AgentAction,
  AgentConfirmRequest
} from '../../../../shared/types/agentTools'
import { invoke, onPush, type Unsubscribe } from '../../lib/ipc'
import { showToast } from '../../app/toast'

export type AgentUndoState = 'idle' | 'pending' | 'complete' | 'error'

export interface AgentConfirmationActivity {
  kind: 'confirmation'
  request: AgentConfirmRequest
  response: boolean | null
  isResponding: boolean
  hasResponseError: boolean
}

export interface AgentChangesActivity {
  kind: 'changes'
  turnId: string
  actions: AgentAction[]
  loadState: 'loading' | 'ready' | 'error'
  undoState: AgentUndoState
}

export type AgentToolActivityItem =
  | AgentConfirmationActivity
  | AgentChangesActivity

export interface AgentToolActivitySnapshot {
  items: AgentToolActivityItem[]
}

interface AgentToolActivityStoreState {
  courses: Record<string, AgentToolActivitySnapshot>
}

interface AgentToolRuntime {
  refCount: number
  unsubscribe: Unsubscribe | null
}

const EMPTY_SNAPSHOT: AgentToolActivitySnapshot = { items: [] }
const runtimes = new Map<string, AgentToolRuntime>()

export const useAgentToolActivityStore =
  create<AgentToolActivityStoreState>(() => ({ courses: {} }))

function snapshotFor(courseId: string): AgentToolActivitySnapshot {
  return useAgentToolActivityStore.getState().courses[courseId] ?? EMPTY_SNAPSHOT
}

function updateSnapshot(
  courseId: string,
  update: (
    current: AgentToolActivitySnapshot
  ) => AgentToolActivitySnapshot
): void {
  useAgentToolActivityStore.setState((store) => {
    const current = store.courses[courseId] ?? EMPTY_SNAPSHOT
    const next = update(current)
    if (next === current) {
      return store
    }
    return { courses: { ...store.courses, [courseId]: next } }
  })
}

function runtimeFor(courseId: string): AgentToolRuntime {
  let runtime = runtimes.get(courseId)
  if (runtime === undefined) {
    runtime = { refCount: 0, unsubscribe: null }
    runtimes.set(courseId, runtime)
  }
  return runtime
}

function appendConfirmation(request: AgentConfirmRequest): void {
  updateSnapshot(request.courseId, (current) => {
    const existingIndex = current.items.findIndex(
      (item) =>
        item.kind === 'confirmation' &&
        item.request.requestId === request.requestId
    )
    if (existingIndex >= 0) {
      const items = [...current.items]
      const existing = items[existingIndex]
      if (existing?.kind !== 'confirmation') {
        return current
      }
      items[existingIndex] = { ...existing, request }
      return { items }
    }
    return {
      items: [
        ...current.items,
        {
          kind: 'confirmation',
          request,
          response: null,
          isResponding: false,
          hasResponseError: false
        }
      ]
    }
  })
}

function updateConfirmation(
  courseId: string,
  requestId: string,
  update: (item: AgentConfirmationActivity) => AgentConfirmationActivity
): void {
  updateSnapshot(courseId, (current) => {
    let changed = false
    const items = current.items.map((item) => {
      if (
        item.kind !== 'confirmation' ||
        item.request.requestId !== requestId
      ) {
        return item
      }
      changed = true
      return update(item)
    })
    return changed ? { items } : current
  })
}

function ensureChangesActivity(courseId: string, turnId: string): void {
  updateSnapshot(courseId, (current) => {
    const existing = current.items.find(
      (item) => item.kind === 'changes' && item.turnId === turnId
    )
    if (existing !== undefined) {
      return current
    }
    return {
      items: [
        ...current.items,
        {
          kind: 'changes',
          turnId,
          actions: [],
          loadState: 'loading',
          undoState: 'idle'
        }
      ]
    }
  })
}

function updateChanges(
  courseId: string,
  turnId: string,
  update: (item: AgentChangesActivity) => AgentChangesActivity
): void {
  updateSnapshot(courseId, (current) => {
    let changed = false
    const items = current.items.map((item) => {
      if (item.kind !== 'changes' || item.turnId !== turnId) {
        return item
      }
      changed = true
      return update(item)
    })
    return changed ? { items } : current
  })
}

function fetchTurnChanges(courseId: string, turnId: string): void {
  ensureChangesActivity(courseId, turnId)
  void invoke('agentTools:changes', { turnId })
    .then((changes) => {
      updateChanges(courseId, turnId, (item) => ({
        ...item,
        turnId: changes.turnId,
        actions: changes.actions,
        loadState: 'ready'
      }))
    })
    .catch(() => {
      updateChanges(courseId, turnId, (item) => ({
        ...item,
        loadState: 'error'
      }))
    })
}

/** Retains both assistant-tool push listeners while a course chat is mounted. */
export function acquireAgentToolActivity(courseId: string): () => void {
  const runtime = runtimeFor(courseId)
  runtime.refCount += 1
  if (runtime.refCount === 1) {
    const unsubscribeConfirm = onPush('agentTools:confirm', (request) => {
      if (request.courseId === courseId) {
        appendConfirmation(request)
      }
    })
    const unsubscribeChanged = onPush('agentTools:changed', (event) => {
      if (event.courseId === courseId) {
        fetchTurnChanges(courseId, event.turnId)
      }
    })
    // The in-app tools failed to come up. Say so — otherwise the assistant
    // just quietly cannot touch the app or the browser, and explains that as
    // if it were a limitation of the product.
    const unsubscribeUnavailable = onPush('agentTools:unavailable', (event) => {
      if (event.courseId !== courseId) return
      showToast(
        '앱 도구를 불러오지 못했어요. 대화를 다시 열면 복구돼요.',
        'danger'
      )
    })
    runtime.unsubscribe = () => {
      unsubscribeConfirm()
      unsubscribeChanged()
      unsubscribeUnavailable()
    }
  }

  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    runtime.refCount = Math.max(0, runtime.refCount - 1)
    if (runtime.refCount === 0) {
      runtime.unsubscribe?.()
      runtime.unsubscribe = null
    }
  }
}

export function respondToAgentConfirm(
  courseId: string,
  requestId: string,
  approved: boolean
): void {
  const confirmation = snapshotFor(courseId).items.find(
    (item) =>
      item.kind === 'confirmation' && item.request.requestId === requestId
  )
  if (
    confirmation?.kind !== 'confirmation' ||
    confirmation.response !== null ||
    confirmation.isResponding
  ) {
    return
  }

  updateConfirmation(courseId, requestId, (item) => ({
    ...item,
    isResponding: true,
    hasResponseError: false
  }))
  void invoke('agentTools:respondConfirm', { requestId, approved })
    .then(() => {
      updateConfirmation(courseId, requestId, (item) => ({
        ...item,
        response: approved,
        isResponding: false,
        hasResponseError: false
      }))
    })
    .catch(() => {
      updateConfirmation(courseId, requestId, (item) => ({
        ...item,
        isResponding: false,
        hasResponseError: true
      }))
    })
}

export function undoAgentTurn(courseId: string, turnId: string): void {
  const changes = snapshotFor(courseId).items.find(
    (item) => item.kind === 'changes' && item.turnId === turnId
  )
  if (
    changes?.kind !== 'changes' ||
    changes.undoState === 'pending' ||
    !changes.actions.some(
      (action) => action.undoable && action.undoneAt === null
    )
  ) {
    return
  }

  updateChanges(courseId, turnId, (item) => ({
    ...item,
    undoState: 'pending'
  }))
  void invoke('agentTools:undo', { turnId })
    .then(() => {
      const undoneAt = new Date().toISOString()
      updateChanges(courseId, turnId, (item) => ({
        ...item,
        actions: item.actions.map((action) =>
          action.undoable && action.undoneAt === null
            ? { ...action, undoneAt }
            : action
        ),
        undoState: 'complete'
      }))
      fetchTurnChanges(courseId, turnId)
    })
    .catch(() => {
      updateChanges(courseId, turnId, (item) => ({
        ...item,
        undoState: 'error'
      }))
    })
}

export interface AgentToolActivityApi extends AgentToolActivitySnapshot {
  respondConfirm: (requestId: string, approved: boolean) => void
  undoTurn: (turnId: string) => void
}

export function useAgentToolActivity(courseId: string): AgentToolActivityApi {
  const snapshot = useAgentToolActivityStore(
    useCallback(
      (store) => store.courses[courseId] ?? EMPTY_SNAPSHOT,
      [courseId]
    )
  )

  useEffect(() => acquireAgentToolActivity(courseId), [courseId])

  const respondConfirm = useCallback(
    (requestId: string, approved: boolean) => {
      respondToAgentConfirm(courseId, requestId, approved)
    },
    [courseId]
  )
  const undoTurn = useCallback(
    (turnId: string) => undoAgentTurn(courseId, turnId),
    [courseId]
  )

  return { ...snapshot, respondConfirm, undoTurn }
}
