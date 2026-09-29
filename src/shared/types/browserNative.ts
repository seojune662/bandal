export interface BrowserPageState {
  id: number
  url: string
  title: string
  httpStatus?: number
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}
export interface BrowserPageEvent {
  tabId: string
  name: string
  state: BrowserPageState
  detail: Record<string, unknown>
}
export type BrowserPageAction = 'loadURL' | 'goBack' | 'goForward' | 'reload' |
  'reloadIgnoringCache' | 'stop' | 'setZoomLevel' | 'findInPage' | 'stopFindInPage' |
  'executeJavaScript' | 'downloadURL' | 'copy' | 'cut' | 'paste' | 'selectAll' |
  'undo' | 'redo' | 'copyImageAt' | 'openDevTools' | 'printToPDF' | 'focus'
