import { useEffect, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import type { OverlayState } from '../../../../shared/types/overlay'
import { invoke, onPush, type Unsubscribe } from '../../lib/ipc'

export const INITIAL_OVERLAY_STATE: OverlayState = {
  mode: 'desktop',
  courseId: null,
  conversationId: null,
  popupOpen: false,
  screenPermission: 'unknown',
  desktopVisible: false
} as OverlayState

interface OverlayStateStore {
  state: OverlayState
}

export const useOverlayStateStore = create<OverlayStateStore>()(() => ({
  state: INITIAL_OVERLAY_STATE
}))

let pushRevision = 0
let loadSequence = 0
let subscribers = 0
let stopPush: Unsubscribe | null = null

export function setOverlayState(state: OverlayState): void {
  pushRevision += 1
  useOverlayStateStore.setState({ state })
}

/** Loads the current snapshot without overwriting a newer pushed state. */
export async function loadOverlayState(): Promise<OverlayState> {
  const sequence = ++loadSequence
  const revisionAtStart = pushRevision
  const state = await invoke('overlay:getState', {})
  if (sequence === loadSequence && revisionAtStart === pushRevision) {
    useOverlayStateStore.setState({ state })
  }
  return useOverlayStateStore.getState().state
}

export function acquireOverlayState(): Unsubscribe {
  subscribers += 1
  if (subscribers === 1) {
    stopPush = onPush('overlay:state', setOverlayState)
    void loadOverlayState().catch((error: unknown) => {
      console.error('[Bandal] 데스크톱 오버레이 상태를 불러오지 못했습니다.', error)
    })
  }

  let released = false
  return () => {
    if (released) return
    released = true
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0) {
      stopPush?.()
      stopPush = null
    }
  }
}

export function useOverlayState(): OverlayState {
  const state = useSyncExternalStore(
    useOverlayStateStore.subscribe,
    () => useOverlayStateStore.getState().state,
    () => useOverlayStateStore.getState().state
  )

  useEffect(() => acquireOverlayState(), [])

  return state
}
