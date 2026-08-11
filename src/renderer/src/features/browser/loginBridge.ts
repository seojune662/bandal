import { useEffect, type RefObject } from 'react'
import {
  LOGIN_CAPTURE_GLOBAL,
  type SavedLoginSummary
} from '../../../../shared/types/credentials'
import { invoke } from '../../lib/ipc'
import {
  useBrowserGuests,
  type BrowserLoginState
} from './browserGuestsStore'
import type { WebviewTag } from './webviewTypes'

const CONSOLE_PREFIX = '__bandal_login_form__'


interface WebviewConsoleMessageEvent extends Event {
  message: string
}

interface LoginFormReport {
  origin: string
  hasLoginForm: boolean
}

const REPORTER_SOURCE = `(() => {
  if (window.top !== window || window.__bandalLoginReporterInstalledV1__ === true) return;
  Object.defineProperty(window, '__bandalLoginReporterInstalledV1__', {
    value: true, configurable: false, enumerable: false, writable: false
  });
  const prefix = ${JSON.stringify(CONSOLE_PREFIX)};
  const touchedPasswords = new WeakSet();
  const fields = () => {
    const password = document.querySelector('input[type="password"]');
    const form = password instanceof HTMLInputElement ? password.form : null;
    if (!password || !form || password.disabled || password.readOnly) return null;
    const usernames = Array.from(form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
    )).filter((input) =>
      input instanceof HTMLInputElement &&
      !input.disabled &&
      !input.readOnly &&
      (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
    const username = usernames.at(-1);
    return username instanceof HTMLInputElement ? { username, password } : null;
  };
  document.addEventListener('input', (event) => {
    if (
      event.isTrusted &&
      event.target instanceof HTMLInputElement &&
      event.target.type === 'password'
    ) touchedPasswords.add(event.target);
  }, true);
  Object.defineProperty(window, ${JSON.stringify(LOGIN_CAPTURE_GLOBAL)}, {
    value: () => {
      const found = fields();
      if (!found || !touchedPasswords.has(found.password)) return null;
      return { username: found.username.value, password: found.password.value };
    },
    configurable: false,
    enumerable: false,
    writable: false
  });
  let previous = '';
  let timer = 0;
  const report = () => {
    timer = 0;
    const payload = JSON.stringify({
      origin: location.origin,
      hasLoginForm: fields() !== null
    });
    if (payload === previous) return;
    previous = payload;
    console.log(prefix + payload);
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(report, 80);
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['type', 'disabled', 'readonly']
  });
  report();
})();`


const elements = new Map<string, WebviewTag>()
const autoFilledOrigins = new Map<string, string>()
const navigationGenerations = new Map<string, number>()

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

function parseReport(message: string): LoginFormReport | null {
  if (!message.startsWith(CONSOLE_PREFIX)) return null
  try {
    const value: unknown = JSON.parse(message.slice(CONSOLE_PREFIX.length))
    if (typeof value !== 'object' || value === null) return null
    const report = value as Record<string, unknown>
    if (
      typeof report['origin'] !== 'string' ||
      typeof report['hasLoginForm'] !== 'boolean'
    ) {
      return null
    }
    const origin = httpsOrigin(report['origin'])
    return origin === null
      ? null
      : { origin, hasLoginForm: report['hasLoginForm'] }
  } catch {
    return null
  }
}


function liveOrigin(element: WebviewTag): string | null {
  try {
    return httpsOrigin(element.getURL())
  } catch {
    return null
  }
}

function update(tabId: string, patch: Partial<BrowserLoginState>): void {
  useBrowserGuests.getState().updateLogin(tabId, patch)
}

async function fill(tabId: string, origin: string): Promise<boolean> {
  const element = elements.get(tabId)
  if (element === undefined || liveOrigin(element) !== origin) return false
  let guestWebContentsId: number
  try {
    guestWebContentsId = element.getWebContentsId()
  } catch {
    return false
  }

  try {
    const result = await invoke('credentials:fill', {
      origin,
      guestWebContentsId
    })
    return result.filled
  } catch {
    return false
  }
}

async function applyReport(
  tabId: string,
  generation: number,
  report: LoginFormReport
): Promise<void> {
  const element = elements.get(tabId)
  if (
    element === undefined ||
    navigationGenerations.get(tabId) !== generation ||
    liveOrigin(element) !== report.origin
  ) {
    return
  }
  update(tabId, {
    origin: report.origin,
    hasLoginForm: report.hasLoginForm,
    savedLogin: null,
    pending: report.hasLoginForm,
    message: null
  })
  if (!report.hasLoginForm) return

  let saved: SavedLoginSummary | undefined
  try {
    const logins = await invoke('credentials:list', {})
    saved = logins.find((login) => login.origin === report.origin)
  } catch {
    update(tabId, { pending: false, message: 'failed' })
    return
  }
  if (
    navigationGenerations.get(tabId) !== generation ||
    liveOrigin(element) !== report.origin
  ) {
    return
  }
  update(tabId, { savedLogin: saved ?? null, pending: false })

  if (saved !== undefined && autoFilledOrigins.get(tabId) !== report.origin) {
    autoFilledOrigins.set(tabId, report.origin)
    update(tabId, { pending: true })
    const filled = await fill(tabId, report.origin)
    update(tabId, { pending: false, message: filled ? 'filled' : 'failed' })
  }
}

export async function saveLoginForTab(tabId: string): Promise<void> {
  const element = elements.get(tabId)
  const state = useBrowserGuests.getState().login[tabId]
  const origin = element === undefined ? null : liveOrigin(element)
  if (
    element === undefined ||
    state === undefined ||
    origin === null ||
    state.origin !== origin ||
    state.pending
  ) {
    return
  }

  let guestWebContentsId: number
  try {
    guestWebContentsId = element.getWebContentsId()
  } catch {
    return
  }

  update(tabId, { pending: true, message: null })
  try {
    // Main reads the typed password out of the page and stores it. This window
    // names the tab and gets back a summary; it never holds the secret.
    const saved = await invoke('credentials:capture', {
      origin,
      guestWebContentsId,
      autoSubmit: false
    })
    if (saved === null) {
      update(tabId, { pending: false, message: 'needs-input' })
      return
    }
    update(tabId, { pending: false, savedLogin: saved, message: 'saved' })
  } catch {
    update(tabId, { pending: false, message: 'failed' })
  }
}

export async function fillLoginForTab(tabId: string): Promise<void> {
  const state = useBrowserGuests.getState().login[tabId]
  if (
    state === undefined ||
    state.origin === null ||
    state.savedLogin === null ||
    state.pending
  ) {
    return
  }
  update(tabId, { pending: true, message: null })
  const filled = await fill(tabId, state.origin)
  update(tabId, { pending: false, message: filled ? 'filled' : 'failed' })
}

export function useWebviewLoginBridge(
  tabId: string,
  webviewRef: RefObject<WebviewTag | null>
): void {
  useEffect(() => {
    const webview = webviewRef.current
    if (webview === null) return
    elements.set(tabId, webview)
    navigationGenerations.set(tabId, 0)

    const inject = (): void => {
      try {
        void webview.executeJavaScript(REPORTER_SOURCE).catch(() => undefined)
      } catch {
        // The next dom-ready retries after an attach/navigation race.
      }
    }
    const onConsoleMessage = (rawEvent: Event): void => {
      const event = rawEvent as WebviewConsoleMessageEvent
      if (typeof event.message !== 'string') return
      const report = parseReport(event.message)
      if (report !== null) {
        void applyReport(tabId, navigationGenerations.get(tabId) ?? 0, report)
      }
    }
    const onStartLoading = (): void => {
      navigationGenerations.set(
        tabId,
        (navigationGenerations.get(tabId) ?? 0) + 1
      )
      const previousOrigin = useBrowserGuests.getState().login[tabId]?.origin
      const nextOrigin = liveOrigin(webview)
      if (
        previousOrigin !== null &&
        previousOrigin !== undefined &&
        nextOrigin !== previousOrigin
      ) {
        autoFilledOrigins.delete(tabId)
      }
      update(tabId, {
        origin: null,
        hasLoginForm: false,
        savedLogin: null,
        pending: false,
        message: null
      })
    }

    webview.addEventListener('dom-ready', inject)
    webview.addEventListener('console-message', onConsoleMessage)
    webview.addEventListener('did-start-loading', onStartLoading)
    inject()
    return () => {
      webview.removeEventListener('dom-ready', inject)
      webview.removeEventListener('console-message', onConsoleMessage)
      webview.removeEventListener('did-start-loading', onStartLoading)
      if (elements.get(tabId) === webview) elements.delete(tabId)
      autoFilledOrigins.delete(tabId)
      navigationGenerations.delete(tabId)
    }
  }, [tabId, webviewRef])
}
