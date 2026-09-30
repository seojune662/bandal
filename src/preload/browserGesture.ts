import { ipcRenderer } from 'electron'
import { waitForSwipe } from './browserSwipe'

// This isolated preload exposes no functions to websites and accepts only
// trusted wheel input. It never loads the privileged app preload.
let state = { canBack: false, canForward: false, enabled: false }
let lastRefresh = 0
window.addEventListener('wheel', event => {
  if (!event.isTrusted || Date.now() - lastRefresh < 200) return
  lastRefresh = Date.now()
  void ipcRenderer.invoke('browser-gesture:state').then(next => { state = next })
}, { capture: true, passive: true })
async function listen(): Promise<void> {
  while (true) {
    const action = await waitForSwipe(() => state)
    ipcRenderer.send('browser-gesture:navigate', action)
    await new Promise(resolve => setTimeout(resolve, 650))
  }
}
window.addEventListener('DOMContentLoaded', () => { void listen() }, { once: true })
