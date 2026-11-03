import { adapter } from './adapter'
import { setIpcAdapter } from '../src/renderer/src/lib/ipc'

// Some production stores subscribe at module evaluation. Install before importing any UI.
setIpcAdapter(adapter)
window.bandal = { ...adapter, platform: 'web', pathForFile: () => '', startMaterialDrag: () => {}, startExternalFileDrag: () => {}, openSettings: async () => {} }
document.documentElement.dataset.platform = 'web'
// Phase 1 is view-only: notes open non-editable and never save (src/renderer/src/lib/readOnlyWorkspace.ts).
document.documentElement.dataset.readOnly = 'true'
if (!window.requestIdleCallback) {
  window.requestIdleCallback = callback => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 15 }), 1)
  window.cancelIdleCallback = window.clearTimeout
}
void import('./main')
