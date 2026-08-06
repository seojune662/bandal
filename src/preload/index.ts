/**
 * Preload bridge: exposes the typed `window.bandal` API.
 * contextIsolation: on, nodeIntegration: off, sandbox: on.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
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
  /**
   * [M5] Absolute filesystem path of a dropped File (drag & drop import).
   * Returns '' for files that have no path (e.g. dragged browser images).
   */
  pathForFile(file: File): string
  /**
   * [M9] Host platform ('darwin' | 'win32' | 'linux'). The renderer needs it
   * to reserve the macOS traffic-light inset in the tab strip — reserving it
   * anywhere else leaves a dead gap in the window chrome.
   */
  readonly platform: string
  /** Temporary M0 helper — opens the settings window. */
  openSettings(): Promise<void>
}

/** Only these push channels may be subscribed from the renderer. */
const PUSH_CHANNELS: readonly PushChannel[] = [
  'chat:event-batch',
  'materials:changed',
  'browser:open-url',
  'settings:changed',
  'shortcut:passthrough',
  // -- groups (P2-C) --------------------------------------------------------
  'auth:changed',
  'group:event-batch',
  'groups:invalidated',
  // -- auto update ----------------------------------------------------------
  'update:changed',
  'agent:install-progress'
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
  pathForFile(file) {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  platform: process.platform,
  async openSettings() {
    await ipcRenderer.invoke('window:openSettings')
  }
}

contextBridge.exposeInMainWorld('bandal', bridge)
