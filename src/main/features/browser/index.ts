// browser feature (main process) — hardened `<webview>` policies (M3-F)
// plus the browsing-partition user agent (backlog §6.1).
export { hardenWindowWebviews } from './hardenWebviews'
export { BROWSING_PARTITION } from './webviewPolicy'
export { browsingUserAgent, hasChromeToken } from './userAgent'
export {
  BROWSER_SESSION_FILE_NAME,
  RESTORED_COOKIE_TTL_SECONDS,
  cookieOrigin,
  cookieUrl,
  createBrowserSessionStore,
  isSessionCookie
} from './sessionStore'
export type {
  BrowserSessionAppLike,
  BrowserSessionLike,
  BrowserSessionStore,
  BrowserSessionStoreDeps,
  SafeStorageLike
} from './sessionStore'
