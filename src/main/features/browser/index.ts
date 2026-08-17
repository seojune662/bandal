// browser feature (main process) — hardened `<webview>` policies (M3-F)
// plus the browsing-partition user agent (backlog §6.1).
export { hardenWindowWebviews } from './hardenWebviews'
export { fetchLinkForMaterials } from './linkDownload'
export { BROWSING_PARTITION } from './webviewPolicy'
export { browsingUserAgent, hasChromeToken } from './userAgent'
export {
  LEGACY_BROWSER_SESSION_FILE_NAME,
  cookieOrigin,
  cookieUrl,
  createBrowserSessionStore
} from './sessionStore'
export type {
  BrowserSessionAppLike,
  BrowserSessionLike,
  BrowserSessionStore,
  BrowserSessionStoreDeps
} from './sessionStore'
