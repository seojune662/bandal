/**
 * Preload bridge: exposes the typed `window.bandal` API.
 * contextIsolation: on, nodeIntegration: off, sandbox: on.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse } from '../shared/ipc/contract'
import type { PushChannel, PushPayload } from '../shared/ipc/events'

type Unsubscribe = () => void

export interface BandalBridge {
  invoke<K extends IpcChannel>(
    channel: K,
    req: IpcRequest<K>
  ): Promise<IpcResponse<K>>
  on<K extends PushChannel>(
    channel: K,
    cb: (payload: PushPayload<K>) => void
  ): Unsubscribe
  /** Temporary M0 helper — opens the settings window. */
  openSettings(): Promise<void>
}

/** Only these push channels may be subscribed from the renderer. */
const PUSH_CHANNELS: readonly PushChannel[] = [
  'chat:event-batch',
  'materials:changed',
  'browser:state',
  'settings:changed'
]

const bridge: BandalBridge = {
  invoke(channel, req) {
    return ipcRenderer.invoke(channel, req) as Promise<
      IpcResponse<typeof channel>
    >
  },
  on(channel, cb) {
    if (!PUSH_CHANNELS.includes(channel)) {
      throw new Error(`[bandal] Unknown push channel: ${String(channel)}`)
    }
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: PushPayload<typeof channel>
    ): void => {
      cb(payload)
    }
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  async openSettings() {
    await ipcRenderer.invoke('window:openSettings')
  }
}

contextBridge.exposeInMainWorld('bandal', bridge)
