import { invoke, onPush } from '../../lib/ipc'
import type { BrowserPageAction, BrowserPageState } from '../../../../shared/types/browserNative'
import type { BrowserPageHandle } from './browserPageTypes'

/** A native page transport with an independent, presentation-only DOM anchor. */
export function attachNativePage(element: HTMLElement, tabId: string, isPrivate: boolean, courseId: string | null, profileId = 'default') {
  const events = new EventTarget()
  let current: BrowserPageState = { id: 0, url: '', title: '', loading: false, canGoBack: false, canGoForward: false }
  let adopted = false, disposed = false, boundsSerial = 0
  let creationError: unknown
  const emit = (name: string, detail: Record<string, unknown> = {}): void => {
    events.dispatchEvent(Object.assign(new Event(name), detail))
  }
  const unsubscribe = onPush('browser:page-event', (event) => {
    if (disposed || event.tabId !== tabId) return
    current = event.state
    emit(event.name, event.detail)
  })
  const ready = invoke('browser:createPage', { tabId, isPrivate, courseId, profileId }).then(result => {
    current = result.state
    if (disposed) return
    adopted = result.adopted
    emit('native-ready')
    if (adopted && current.url) {
      emit('did-navigate', { url: current.url, httpResponseCode: current.httpStatus ?? 0 })
      emit('page-title-updated', { title: current.title })
      emit('dom-ready')
      if (!current.loading) emit('did-stop-loading')
    }
  }).catch(error => {
    creationError = error
    if (!disposed) emit('did-fail-load', {
      errorCode: -2, errorDescription: '페이지를 열지 못했어요.', validatedURL: '', isMainFrame: true
    })
  })
  const call = async <T = void>(action: BrowserPageAction, args: unknown[] = []): Promise<T> => {
    await ready
    if (disposed) throw new Error('Browser page closed')
    if (creationError) throw creationError
    return await invoke('browser:pageAction', { tabId, action, args }) as T
  }
  const handle: BrowserPageHandle = {
    element,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    getURL: () => current.url,
    getWebContentsId: () => current.id,
    canGoBack: () => current.canGoBack,
    canGoForward: () => current.canGoForward,
    isLoadingMainFrame: () => current.loading,
    loadURL: url => call('loadURL', [url]),
    executeJavaScript: (source, userGesture) => call('executeJavaScript', [source, userGesture === true]),
    printToPDF: options => call('printToPDF', [options]),
    findInPage: (text, options) => call('findInPage', [text, options]),
    goBack: () => call('goBack'),
    goForward: () => call('goForward'),
    reload: () => call('reload'),
    reloadIgnoringCache: () => call('reloadIgnoringCache'),
    stop: () => call('stop'),
    setZoomLevel: level => call('setZoomLevel', [level]),
    stopFindInPage: action => call('stopFindInPage', [action]),
    downloadURL: url => call('downloadURL', [url]),
    copy: () => call('copy'),
    cut: () => call('cut'),
    paste: () => call('paste'),
    selectAll: () => call('selectAll'),
    undo: () => call('undo'),
    redo: () => call('redo'),
    copyImageAt: (x, y) => call('copyImageAt', [x, y]),
    openDevTools: () => call('openDevTools'),
    focus: () => call('focus')
  }
  return {
    handle,
    isAdopted: () => adopted,
    bounds: (bounds: { x: number; y: number; width: number; height: number } | null, preview = false) => {
      const serial = ++boundsSerial
      if (bounds) element.style.backgroundImage = ''
      void ready.then(async () => {
        if (disposed || creationError || serial !== boundsSerial) return
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
      void ready.then(() => {
        if (current.id > 0) return invoke('browser:destroyPage', { tabId, expectedWebContentsId: current.id })
      }).catch(() => undefined)
    }
  }
}
