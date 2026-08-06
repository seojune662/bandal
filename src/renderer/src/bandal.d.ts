/**
 * Global typing for the preload bridge exposed as `window.bandal`.
 */

import type { IpcChannel, IpcRequest, IpcResponse } from '../../shared/ipc/contract'
import type { PushChannel, PushPayload } from '../../shared/ipc/events'

declare global {
  interface Window {
    bandal: {
      invoke<K extends IpcChannel>(
        channel: K,
        req: IpcRequest<K>
      ): Promise<IpcResponse<K>>
      on<K extends PushChannel>(
        channel: K,
        cb: (payload: PushPayload<K>) => void
      ): () => void
      /** [M5] Absolute path of a dropped File ('' when unavailable). */
      pathForFile(file: File): string
      /** [M9] 'darwin' | 'win32' | 'linux' — drives the traffic-light inset. */
      readonly platform: string
      /** Temporary M0 helper — opens the settings window. */
      openSettings(): Promise<void>
    }
  }
}

export {}
