import { ipcMain, nativeTheme, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import { getSettings } from '../../settingsStore'
import { isManagedBrowserPage } from './managedPages'
import { resolveThemeId } from '../../../shared/theme'
const last = new Map<number, number>()
let registered = false
export function installGestureSession(session: Session): void {
  session.registerPreloadScript({ id: 'bandal-browser-gestures', type: 'frame', filePath: join(__dirname, '../preload/browserGesture.js') })
  if (registered) return
  registered = true
  ipcMain.handle('browser-gesture:state', event => {
    const wc = event.sender
    if (!isManagedBrowserPage(wc.id)) return { canBack: false, canForward: false, enabled: false }
    const settings = getSettings()
    return {
      canBack: wc.navigationHistory.canGoBack(),
      canForward: wc.navigationHistory.canGoForward(),
      enabled: settings.browser.swipeNavigation,
      theme: resolveThemeId(settings.theme, nativeTheme.shouldUseDarkColors)
    }
  })
  ipcMain.on('browser-gesture:navigate', (event, action: unknown) => navigateBySwipe(event.sender, action))
}
export function installSwipeNavigation(wc: WebContents): void {
  wc.once('destroyed', () => last.delete(wc.id))
}

export function navigateBySwipe(wc: WebContents, action: unknown): void {
  if (!isManagedBrowserPage(wc.id) || !getSettings().browser.swipeNavigation || Date.now() - (last.get(wc.id) ?? 0) < 650) return
  if (action === 'back' && wc.navigationHistory.canGoBack()) { last.set(wc.id, Date.now()); wc.navigationHistory.goBack() }
  if (action === 'forward' && wc.navigationHistory.canGoForward()) { last.set(wc.id, Date.now()); wc.navigationHistory.goForward() }
}
