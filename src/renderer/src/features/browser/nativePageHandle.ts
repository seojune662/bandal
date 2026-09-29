import { invoke, onPush } from '../../lib/ipc'
import type { BrowserPageAction, BrowserPageState } from '../../../../shared/types/browserNative'
import type { WebviewTag } from './webviewTypes'

/** DOM anchor + asynchronous native-page transport. The anchor never hosts a webview. */
export function attachNativePage(element: HTMLElement, tabId: string, isPrivate: boolean, courseId: string | null) {
  const handle = element as WebviewTag
  let current: BrowserPageState = { id: 0, url: '', title: '', loading: false, canGoBack: false, canGoForward: false }
  let adopted = false, disposed = false, boundsSerial = 0
  const emit = (name: string, detail: Record<string, unknown> = {}): void => {
    element.dispatchEvent(Object.assign(new Event(name), detail))
  }
  const unsubscribe = onPush('browser:page-event', (event) => {
    if (disposed || event.tabId !== tabId) return
    current = event.state
    emit(event.name, event.detail)
  })
  const ready = invoke('browser:createPage', { tabId, isPrivate, courseId }).then(result => {
    if (disposed) return
    current = result.state
    adopted = result.adopted
    // This also registers the id for direct downloads, which never emit dom-ready.
    emit('native-ready')
    if (adopted && current.url) {
      emit('did-navigate', { url: current.url, httpResponseCode: current.httpStatus ?? 0 })
      emit('page-title-updated', { title: current.title })
      emit('dom-ready')
      if (!current.loading) emit('did-stop-loading')
    }
  }).catch(() => emit('did-fail-load', {
    errorCode: -2, errorDescription: '페이지를 열지 못했어요.', validatedURL: '', isMainFrame: true
  }))
  const call = async (action: BrowserPageAction, args: unknown[]): Promise<unknown> => {
    await ready
    if (disposed) return
    return invoke('browser:pageAction', { tabId, action, args })
  }
  const asyncMethods = ['loadURL', 'executeJavaScript', 'printToPDF'] as const
  for (const name of asyncMethods) Object.assign(handle, { [name]: (...args: unknown[]) => call(name, args) })
  const methods = ['goBack', 'goForward', 'reload', 'reloadIgnoringCache', 'stop', 'setZoomLevel', 'stopFindInPage', 'downloadURL', 'copy', 'cut', 'paste', 'selectAll', 'undo', 'redo', 'copyImageAt', 'openDevTools', 'focus'] as const
  for (const name of methods) Object.assign(handle, { [name]: (...args: unknown[]) => { void call(name, args).catch(() => undefined) } })
  Object.assign(handle, {
    getURL: () => current.url, getWebContentsId: () => current.id,
    canGoBack: () => current.canGoBack, canGoForward: () => current.canGoForward,
    isLoadingMainFrame: () => current.loading,
    findInPage: (...args: unknown[]) => { void call('findInPage', args).catch(() => undefined); return 0 }
  })
  return {
    handle,
    isAdopted: () => adopted,
    bounds: (bounds: { x: number; y: number; width: number; height: number } | null, preview = false) => {
      const serial = ++boundsSerial
      if (bounds) element.style.backgroundImage = ''
      void ready.then(async () => {
        if (disposed) return
        const result = await invoke('browser:pageBounds', { tabId, bounds, preview })
        if (!disposed && serial === boundsSerial && result.snapshot) {
          element.style.backgroundImage = `url("${result.snapshot}")`
          element.style.backgroundSize = '100% 100%'
        }
      }).catch(() => undefined)
    },
    dispose: () => {
      disposed = true
      unsubscribe()
      void invoke('browser:destroyPage', { tabId }).catch(() => undefined)
    }
  }
}
