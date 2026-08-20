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
  reloadIgnoringCache(): void
  stop(): void
  /**
   * Zoom is per RENDER PROCESS, not per guest: a cross-origin navigation
   * spawns a new process and silently drops the level. The store is the source
   * of truth and re-applies it — never read the level back from here.
   */
  setZoomLevel(level: number): void
  /**
   * Returns a request id SYNCHRONOUSLY; matches arrive later as a DOM
   * `found-in-page` event. Call with NO options to start a fresh search and
   * `{ findNext: true, forward }` to step — an explicit `{ findNext: false }`
   * silently emits no event at all (measured).
   */
  findInPage(text: string, options?: FindInPageOptions): number
  /** Must be called when the bar closes or the highlight stays forever. */
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  canGoBack(): boolean
  isLoadingMainFrame(): boolean
  canGoForward(): boolean
  getWebContentsId(): number
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  /** Same `will-download` path a real click takes — cookies, redirects, name. */
  downloadURL(url: string): void
  copy(): void
  cut(): void
  paste(): void
  selectAll(): void
  undo(): void
  redo(): void
  copyImageAt(x: number, y: number): void
  /**
   * The only way to find out why a site is broken from inside a release
   * build. `browserAgent/cdp.ts` already expects a student to have DevTools
   * attached and yields the debugger to them, so nothing else has to change.
   */
  openDevTools(options?: { mode?: 'detach' | 'right' | 'bottom' }): void
  /** Resolves with the page rendered to PDF bytes. */
  printToPDF(options: Record<string, unknown>): Promise<Uint8Array>
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

/** `did-fail-load`. Subframe failures also arrive here — check `isMainFrame`. */
export interface DidFailLoadEvent extends Event {
  errorCode: number
  errorDescription: string
  validatedURL: string
  isMainFrame: boolean
}

export interface FindInPageOptions {
  forward?: boolean
  findNext?: boolean
  matchCase?: boolean
}

export interface FoundInPageEvent extends Event {
  result: {
    requestId: number
    activeMatchOrdinal: number
    matches: number
    finalUpdate: boolean
  }
}

/**
 * `context-menu`. Coordinates are GUEST-viewport relative, so a host-rendered
 * menu has to offset them by the webview element's bounding rect.
 */
export interface ContextMenuEvent extends Event {
  params: {
    x: number
    y: number
    linkURL: string
    srcURL: string
    mediaType: 'none' | 'image' | 'audio' | 'video' | 'canvas' | 'file' | 'plugin'
    selectionText: string
    isEditable: boolean
    pageURL: string
  }
}

/** `page-favicon-updated`. Chromium reports every declared icon, best last. */
export interface PageFaviconUpdatedEvent extends Event {
  favicons: string[]
}
