/**
 * [M3-F] Minimal structural types for Electron's `<webview>` tag as seen from
 * the renderer. The renderer tsconfig has no electron types (by design — it
 * is sandboxed), so we type only the surface we actually use.
 */

export interface WebviewTag extends HTMLElement {
  src: string
  partition: string
  loadURL(url: string): Promise<void>
  getURL(): string
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  canGoBack(): boolean
  canGoForward(): boolean
  getWebContentsId(): number
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

export interface DidNavigateEvent extends Event {
  url: string
}

export interface DidNavigateInPageEvent extends Event {
  url: string
  isMainFrame: boolean
}

export interface PageTitleUpdatedEvent extends Event {
  title: string
}

export interface PageFaviconUpdatedEvent extends Event {
  favicons: string[]
}
