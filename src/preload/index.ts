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
   * Promotes a material row drag to a NATIVE OS file drag (fire-and-forget).
   * Needed so 웹뷰 안의 업로드 폼(메일 첨부, 과제 제출)이 진짜 파일로 받는다.
   */
  startMaterialDrag(courseId: string, relPath: string): void
  /**
   * [M9] Host platform ('darwin' | 'win32' | 'linux'). The renderer needs it
   * to reserve the macOS traffic-light inset in the tab strip — reserving it
   * anywhere else leaves a dead gap in the window chrome.
   */
  readonly platform: string
  /** Temporary M0 helper — opens the settings window. */
  openSettings(): Promise<void>
}

/**
 * Only these push channels may be subscribed from the renderer.
 *
 * Hand-keeping this list has bitten us four times now (IPC channels, drawing
 * kinds, tab kinds, and this). Declaring a channel in `events.ts` and
 * forgetting it here does not fail quietly: `on()` throws, which takes down
 * whatever component subscribed — the last time, the whole shell rendered
 * blank. The assignment below stops compiling when a channel is missing.
 */
const PUSH_CHANNELS = [
  'chat:event-batch',
  'materials:changed',
  'browser:open-url',
  'browser:activate-tab',
  'browser:close-tab',
  'ui:print',
  'browser:blocked',
  'browser:popup-blocked',
  'browser:external-scheme',
  'browser:external-auth',
  'browser:download',
  'browserAgent:run-state',
  'settings:changed',
  'ui:openSettings',
  'shortcut:passthrough',
  // -- groups (P2-C) --------------------------------------------------------
  'auth:changed',
  'group:event-batch',
  'groups:invalidated',
  // -- auto update ----------------------------------------------------------
  'update:changed',
  'agent:install-progress',
  'whiteboard:changed',
  // -- surfaces the assistant can now change --------------------------------
  'courses:changed',
  'board:changed',
  'canvas:changed',
  'agentTools:confirm',
  'agentTools:unavailable',
  'agentTools:changed'
] as const satisfies readonly PushChannel[]

type MissingPushChannel = Exclude<PushChannel, (typeof PUSH_CHANNELS)[number]>
const _allPushChannelsListed: MissingPushChannel extends never ? true : never =
  true
void _allPushChannelsListed

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
  startMaterialDrag(courseId, relPath) {
    ipcRenderer.send('materials:startDrag', { courseId, relPath })
  },
  async openSettings() {
    await ipcRenderer.invoke('window:openSettings')
  }
}

contextBridge.exposeInMainWorld('bandal', bridge)
