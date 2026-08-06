/**
 * Auto-update state mirrored from main.
 *
 * Main owns the truth (electron-updater lives there); this is a projection fed
 * by the `update:changed` push channel, so the workspace toast and the Settings
 * → About panel can never disagree about what phase we are in.
 */

import { create } from 'zustand'
import type { UpdateStatus } from '../../../shared/types/update'
import { invoke, onPush } from '../lib/ipc'

interface UpdateState {
  status: UpdateStatus | null
  /** Fetches the current status and subscribes to changes. Idempotent. */
  init: () => void
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
}

let unsubscribe: (() => void) | null = null

export const useUpdateStore = create<UpdateState>()((set) => ({
  status: null,

  init: () => {
    if (unsubscribe !== null) return
    unsubscribe = onPush('update:changed', (status) => set({ status }))
    void invoke('update:status', {})
      .then((status) => set({ status }))
      .catch(() => {
        // Main answers this synchronously from memory; a failure here means
        // the window is tearing down. Nothing useful to show.
      })
  },

  check: async () => {
    // The push subscription delivers every intermediate phase, so the resolved
    // value is only a fallback for the window that asked.
    const status = await invoke('update:check', {})
    set({ status })
  },

  download: async () => {
    const status = await invoke('update:download', {})
    set({ status })
  },

  install: async () => {
    await invoke('update:install', {})
  }
}))
