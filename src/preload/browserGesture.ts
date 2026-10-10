import { ipcRenderer } from 'electron'
import { waitForSwipe, type BrowserSwipeState } from './browserSwipe'

// This isolated preload exposes no functions to websites and accepts only
// trusted wheel input. It never loads the privileged app preload.
let state: BrowserSwipeState = { canBack: false, canForward: false, enabled: false, theme: 'light' }
let lastRefresh = 0
function refreshState(): void {
  lastRefresh = Date.now()
  void ipcRenderer.invoke('browser-gesture:state')
    .then(next => { state = next })
    .catch(() => { state = { ...state, enabled: false } })
}
window.addEventListener('wheel', event => {
  if (!event.isTrusted || Date.now() - lastRefresh < 200) return
  refreshState()
}, { capture: true, passive: true })
async function listen(): Promise<void> {
  while (true) {
    const action = await waitForSwipe(() => state)
    ipcRenderer.send('browser-gesture:navigate', action)
    await new Promise(resolve => setTimeout(resolve, 650))
  }
}
window.addEventListener('DOMContentLoaded', () => { refreshState(); void listen() }, { once: true })
