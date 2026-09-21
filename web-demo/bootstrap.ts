import { adapter } from './adapter'
import { setIpcAdapter } from '../src/renderer/src/lib/ipc'

// Lazy product previews must never steal focus or scroll the landing page while
// their real editors initialize. Normal app focus behavior starts on interaction.
if (window.parent !== window) {
  let engaged = false
  window.addEventListener('pointerdown', () => { engaged = true }, true)
  window.addEventListener('keydown', () => { engaged = true }, true)
  window.addEventListener('blur', () => { engaged = false })
  const focus = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (options) { if (engaged) focus.call(this, options) }
  const scroll = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function (options) { if (engaged) scroll.call(this, options) }
}

// Some production stores subscribe at module evaluation. Install before importing the UI.
setIpcAdapter(adapter)
window.bandal = { ...adapter, platform: 'web', pathForFile: () => '', startMaterialDrag: () => {}, openSettings: async () => {} }
try {
  const key = 'bandal:course-sidebar:collapsed:v1'
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(['demo-data-structures','demo-course-1','demo-course-2','demo-course-3']))
} catch { /* The demo also runs without storage. */ }
void import('./main')
