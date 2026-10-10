import type { WebContents } from 'electron'
import { externalAuthRestartUrl, isBrowserAuthFlowUrl, isEmbeddedAuthProviderUrl } from '../../../shared/browserAuth'

const sources = new WeakMap<WebContents, string>()
export const EMBEDDED_AUTH_BLOCKED = '__bandalEmbeddedAuthBlocked__'

/** Read only: Google can render its refusal after the document finishes loading. */
export const EMBEDDED_AUTH_OBSERVER = `(() => {
  if (window.__bandalEmbeddedAuthObserver) return;
  window.__bandalEmbeddedAuthObserver = true;
  let reported = false, pending = false;
  const check = () => {
    pending = false;
    const text = (document.body?.innerText || document.body?.textContent || '').slice(0, 40000);
    const blocked = /disallowed[_ -]?useragent|browser or app may not be secure|브라우저 또는 앱이 안전하지 않을 수|지원되지 않는 브라우저/i.test(text);
    if (blocked && !reported) console.debug('${EMBEDDED_AUTH_BLOCKED}');
    reported = blocked;
  };
  new MutationObserver(() => {
    if (!pending) { pending = true; setTimeout(check, 100); }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  check();
})()`

export function inheritEmbeddedAuthSource(child: WebContents, parent: WebContents): void {
  const source = sources.get(parent) ?? parent.getURL()
  if (source) sources.set(child, source)
}

export function attachEmbeddedAuthFallback(page: WebContents, onBlocked: (url: string) => void): void {
  let lastNotification = ''
  const remember = (url: string): void => {
    if (!isBrowserAuthFlowUrl(url) && /^https?:\/\//.test(url)) sources.set(page, url)
  }
  remember(page.getURL())
  page.on('did-navigate', (_event, url) => { lastNotification = ''; remember(url) })
  // Capture the initiating site before redirects replace it in the same tab.
  page.on('will-navigate', () => remember(page.getURL()))
  page.on('dom-ready', () => {
    if (isEmbeddedAuthProviderUrl(page.getURL())) void page.executeJavaScript(EMBEDDED_AUTH_OBSERVER).catch(() => undefined)
  })
  page.on('console-message', (_event, _level, message) => {
    if (message !== EMBEDDED_AUTH_BLOCKED || page.isDestroyed() || !isEmbeddedAuthProviderUrl(page.getURL())) return
    const url = page.getURL()
    if (url === lastNotification) return
    lastNotification = url
    onBlocked(externalAuthRestartUrl(url, sources.get(page)))
  })
}
