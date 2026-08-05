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
      /** Temporary M0 helper — opens the settings window. */
      openSettings(): Promise<void>
    }
  }
}

export {}
