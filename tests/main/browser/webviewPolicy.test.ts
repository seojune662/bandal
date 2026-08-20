import { describe, expect, test } from 'vitest'
import {
  BROWSING_PARTITION,
  academicSite,
  decidePopup,
  isAllowedAttach,
  isBlockedEmbeddedAuthUrl,
  isNavigationAllowed,
  isOpenerScopedPopupTarget,
  isPermissionAllowed,
  isSameSiteAcademicPopup,
  passthroughShortcut,
  popupForwardUrl,
  popupWindowSize,
  sanitizeGuestWebPreferences
} from '../../../src/main/features/browser/webviewPolicy'

describe('isBlockedEmbeddedAuthUrl (Google embedded-login handoff)', () => {
  test('matches Google account sign-in origins', () => {
    expect(isBlockedEmbeddedAuthUrl('https://accounts.google.com/v3/signin')).toBe(true)
    expect(isBlockedEmbeddedAuthUrl('https://accounts.youtube.com/accounts/SetSID')).toBe(true)
  })

  test('leaves ordinary browsing and lookalikes alone', () => {
    expect(isBlockedEmbeddedAuthUrl('https://www.google.com/search?q=a')).toBe(false)
    expect(isBlockedEmbeddedAuthUrl('https://mail.google.com/mail')).toBe(false)
    expect(isBlockedEmbeddedAuthUrl('https://accounts.google.com.evil.io/')).toBe(false)
    expect(isBlockedEmbeddedAuthUrl('http://accounts.google.com/')).toBe(false)
    expect(isBlockedEmbeddedAuthUrl('not a url')).toBe(false)
  })
})

describe('isAllowedAttach (fail-closed will-attach-webview)', () => {
  test('allows https src on the browsing partition', () => {
    expect(
      isAllowedAttach({ src: 'https://example.com', partition: BROWSING_PARTITION })
    ).toBe(true)
  })

  test('allows about:blank on the browsing partition', () => {
    expect(
      isAllowedAttach({ src: 'about:blank', partition: BROWSING_PARTITION })
    ).toBe(true)
  })

  test('denies a missing partition', () => {
    expect(isAllowedAttach({ src: 'https://example.com' })).toBe(false)
  })

  test('denies foreign partitions', () => {
    expect(
      isAllowedAttach({ src: 'https://example.com', partition: 'persist:evil' })
    ).toBe(false)
  })

  test('denies file:// src', () => {
    expect(
      isAllowedAttach({ src: 'file:///etc/passwd', partition: BROWSING_PARTITION })
    ).toBe(false)
  })

  test('denies custom-scheme and malformed src', () => {
    expect(
      isAllowedAttach({ src: 'app://internal', partition: BROWSING_PARTITION })
    ).toBe(false)
    expect(
      isAllowedAttach({ src: 'not a url', partition: BROWSING_PARTITION })
    ).toBe(false)
    expect(isAllowedAttach({ src: 42, partition: BROWSING_PARTITION })).toBe(false)
  })
})

describe('isNavigationAllowed (will-navigate AND will-redirect guard)', () => {
  test('allows http(s) and about:blank', () => {
    expect(isNavigationAllowed('https://example.com/page')).toBe(true)
    expect(isNavigationAllowed('http://localhost:3000')).toBe(true)
    expect(isNavigationAllowed('about:blank')).toBe(true)
  })

  test('allows http(s)-origin blob URLs (challenge flows)', () => {
    expect(isNavigationAllowed('blob:https://example.com/uuid')).toBe(true)
    expect(isNavigationAllowed('blob:null/uuid')).toBe(false)
  })

  test('denies file:// navigation', () => {
    expect(isNavigationAllowed('file:///Users/me/secret.txt')).toBe(false)
  })

  test('denies javascript:, data:, chrome: and friends', () => {
    expect(isNavigationAllowed('javascript:alert(1)')).toBe(false)
    expect(isNavigationAllowed('data:text/html,<h1>x</h1>')).toBe(false)
    expect(isNavigationAllowed('chrome://settings')).toBe(false)
    expect(isNavigationAllowed('')).toBe(false)
  })
})

describe('sanitizeGuestWebPreferences', () => {
  test('deletes any preload and forces the hardened preferences', () => {
    const prefs: Record<string, unknown> = {
      preload: '/app/preload.js',
      preloadURL: 'file:///app/preload.js',
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      partition: 'persist:evil'
    }
    sanitizeGuestWebPreferences(prefs)

    expect('preload' in prefs).toBe(false)
    expect('preloadURL' in prefs).toBe(false)
    expect(prefs['nodeIntegration']).toBe(false)
    expect(prefs['nodeIntegrationInSubFrames']).toBe(false)
    expect(prefs['nodeIntegrationInWorker']).toBe(false)
    expect(prefs['contextIsolation']).toBe(true)
    expect(prefs['sandbox']).toBe(true)
    expect(prefs['webSecurity']).toBe(true)
    expect(prefs['allowRunningInsecureContent']).toBe(false)
    expect(prefs['webviewTag']).toBe(false)
    expect(prefs['partition']).toBe(BROWSING_PARTITION)
  })
})

describe('permission policy (deny-by-default)', () => {
  test('allows fullscreen only', () => {
    expect(isPermissionAllowed('fullscreen')).toBe(true)
    for (const denied of [
      'media',
      'geolocation',
      'notifications',
      'clipboard-read',
      'midi',
      'openExternal',
      'pointerLock'
    ]) {
      expect(isPermissionAllowed(denied)).toBe(false)
    }
  })
})

describe('popupForwardUrl (window.open → new Bandal tab)', () => {
  test('forwards http(s) targets', () => {
    expect(popupForwardUrl('https://example.com')).toBe('https://example.com')
  })

  test('drops everything else', () => {
    expect(popupForwardUrl('file:///etc/passwd')).toBeNull()
    expect(popupForwardUrl('about:blank')).toBeNull()
    expect(popupForwardUrl('')).toBeNull()
  })
})

describe('passthroughShortcut (chords a focused guest would otherwise eat)', () => {
  const chord = (over: Partial<Parameters<typeof passthroughShortcut>[0]> = {}) => ({
    type: 'keyDown',
    key: 't',
    meta: true,
    control: false,
    alt: false,
    shift: false,
    ...over
  })

  test('passes ⌘T and ⌘W through', () => {
    expect(passthroughShortcut(chord({ key: 't' }))).toBe('new-tab')
    expect(passthroughShortcut(chord({ key: 'w' }))).toBe('close-tab')
  })

  test('accepts ctrl as well as meta, and is case-insensitive', () => {
    expect(passthroughShortcut(chord({ meta: false, control: true }))).toBe('new-tab')
    expect(passthroughShortcut(chord({ key: 'T' }))).toBe('new-tab')
  })

  test('only fires on keyDown', () => {
    expect(passthroughShortcut(chord({ type: 'keyUp' }))).toBeNull()
    expect(passthroughShortcut(chord({ type: 'char' }))).toBeNull()
  })

  test('passes browser-chrome chords through as well', () => {
    expect(passthroughShortcut(chord({ key: 'r' }))).toBe('reload')
    expect(passthroughShortcut(chord({ key: 'l' }))).toBe('focus-address')
    expect(passthroughShortcut(chord({ key: '=' }))).toBe('zoom-in')
    expect(passthroughShortcut(chord({ key: '-' }))).toBe('zoom-out')
    expect(passthroughShortcut(chord({ key: '0' }))).toBe('zoom-reset')
    expect(passthroughShortcut(chord({ key: '9' }))).toBe('activate-last-tab')
    // ⌘F belongs to the browser, not the page — Chrome steals it too.
    expect(passthroughShortcut(chord({ key: 'f' }))).toBe('find')
    expect(passthroughShortcut(chord({ key: 'd' }))).toBe('bookmark')
  })

  test('alt always disqualifies', () => {
    expect(passthroughShortcut(chord({ alt: true }))).toBeNull()
    expect(passthroughShortcut(chord({ meta: false, control: false }))).toBeNull()
  })

  test('takes the shifted browser conventions from the page', () => {
    expect(passthroughShortcut(chord({ key: 'r', shift: true }))).toBe(
      'reload-hard'
    )
    expect(passthroughShortcut(chord({ key: 't', shift: true }))).toBe(
      'reopen-tab'
    )
    expect(passthroughShortcut(chord({ key: '[', shift: true }))).toBe('prev-tab')
    expect(passthroughShortcut(chord({ key: ']', shift: true }))).toBe('next-tab')
  })

  test('leaves the app-only shifted chords with the page', () => {
    // ⌘⇧B (new browser tab) / ⌘⇧M (new note) are ours but would be startling
    // to fire from inside a page.
    for (const key of ['b', 'm', 'w']) {
      expect(passthroughShortcut(chord({ key, shift: true })), key).toBeNull()
    }
  })

  test('leaves app-only shortcuts dead inside a guest', () => {
    // The page owns its own keymap. ⌘P (quick search), ⌘, (settings) and
    // ⌘1..8 are ours but would be startling to fire mid-page.
    for (const key of ['p', ',', '1', '8']) {
      expect(passthroughShortcut(chord({ key })), key).toBeNull()
    }
  })
})

describe('academicSite', () => {
  test('treats ac.kr as a public suffix', () => {
    // `inha.ac.kr` is the university; `ac.kr` is everyone.
    expect(academicSite('https://portal.inha.ac.kr:8443/x')).toBe('inha.ac.kr')
    expect(academicSite('https://sso.inha.ac.kr/')).toBe('inha.ac.kr')
    expect(academicSite('https://myetl.snu.ac.kr/courses/1')).toBe('snu.ac.kr')
  })

  test('a bare public suffix is not a site', () => {
    expect(academicSite('https://ac.kr/')).toBeNull()
  })

  test('ordinary domains use the last two labels', () => {
    expect(academicSite('https://a.b.example.com/')).toBe('example.com')
  })

  test('junk and non-http are not sites', () => {
    for (const url of ['', 'nope', 'file:///x', 'https://localhost']) {
      expect(academicSite(url), url).toBeNull()
    }
  })
})

describe('isSameSiteAcademicPopup (SSO exception)', () => {
  const portal = 'https://portal.inha.ac.kr:8443/main'

  test('allows a real popup within the same university', () => {
    // Forwarding it to a tab severs window.opener, and an SSO popup that
    // reports back with postMessage then waits forever.
    expect(isSameSiteAcademicPopup(portal, 'https://sso.inha.ac.kr/login')).toBe(
      true
    )
  })

  test('ignores the port — the IdP is :8443 and the portal is :443', () => {
    expect(
      isSameSiteAcademicPopup('https://portal.inha.ac.kr/', 'https://sso.inha.ac.kr:8443/')
    ).toBe(true)
  })

  test('refuses a popup to a different institution', () => {
    expect(isSameSiteAcademicPopup(portal, 'https://myetl.snu.ac.kr/')).toBe(false)
  })

  test('refuses a popup to anywhere off-campus', () => {
    // Keeping the opener relationship is exactly what an attacker would want.
    for (const target of [
      'https://evil.example.com/',
      'https://inha.ac.kr.evil.com/',
      'file:///etc/passwd',
      'javascript:alert(1)'
    ]) {
      expect(isSameSiteAcademicPopup(portal, target), target).toBe(false)
    }
  })

  test('never allows embedded Google auth as a popup', () => {
    expect(
      isSameSiteAcademicPopup(
        'https://accounts.google.com/x',
        'https://accounts.google.com/signin'
      )
    ).toBe(false)
  })
})


describe('isOpenerScopedPopupTarget', () => {
  test('the two forms window.open("") can resolve to', () => {
    // Chromium reports the empty target as either, depending on resolution.
    expect(isOpenerScopedPopupTarget('')).toBe(true)
    expect(isOpenerScopedPopupTarget('about:blank')).toBe(true)
  })

  test('a blob URL from an http(s) opener', () => {
    expect(isOpenerScopedPopupTarget('blob:https://shine.snu.ac.kr/uuid')).toBe(true)
    expect(isOpenerScopedPopupTarget('blob:http://127.0.0.1:8080/uuid')).toBe(true)
  })

  test('nothing else, including near-misses', () => {
    // Exact match on about:blank, or about:config walks in behind it.
    expect(isOpenerScopedPopupTarget('about:blankx')).toBe(false)
    expect(isOpenerScopedPopupTarget('about:srcdoc')).toBe(false)
    expect(isOpenerScopedPopupTarget('about:config')).toBe(false)
    expect(isOpenerScopedPopupTarget('blob:null/uuid')).toBe(false)
    expect(isOpenerScopedPopupTarget('blob:file:///uuid')).toBe(false)
    expect(isOpenerScopedPopupTarget('javascript:alert(1)')).toBe(false)
    expect(isOpenerScopedPopupTarget('https://example.com')).toBe(false)
  })
})

describe('decidePopup', () => {
  const OPENER = 'https://shine.snu.ac.kr/com/ozReportViewer.action'
  const decide = (targetUrl: string, openerUrl = OPENER) =>
    decidePopup({ openerUrl, targetUrl })

  test('an opener-written document becomes a real window', () => {
    // THE regression. This returning null is what made OZ Report Viewer die
    // with "Failed to create the report manager" — the next line was
    // w.document.write(...) on null.
    expect(decide('')).toEqual({ kind: 'window', scope: 'opener' })
    expect(decide('about:blank')).toEqual({ kind: 'window', scope: 'opener' })
    expect(decide('blob:https://shine.snu.ac.kr/x')).toEqual({
      kind: 'window',
      scope: 'opener'
    })
  })

  test('a same-university target keeps the SSO window path', () => {
    expect(
      decide('https://portal.inha.ac.kr:8443/sso', 'https://portal.inha.ac.kr/')
    ).toEqual({ kind: 'window', scope: 'sso' })
  })

  test('an ordinary web target still becomes a Bandal tab', () => {
    expect(decide('https://google.com/')).toEqual({
      kind: 'tab',
      url: 'https://google.com/'
    })
  })

  test('embedded-blocked auth goes to the system browser', () => {
    expect(decide('https://accounts.google.com/v3/signin')).toEqual({
      kind: 'external'
    })
  })

  test('a launcher scheme is offered to the student, not silently dropped', () => {
    expect(decide('wizvera://install?x=1')).toEqual({ kind: 'scheme' })
    expect(decide('ozviewer://open')).toEqual({ kind: 'scheme' })
  })

  test('the dangerous shapes are denied outright', () => {
    expect(decide('data:text/html,<script>1</script>')).toEqual({ kind: 'deny' })
    expect(decide('javascript:alert(1)')).toEqual({ kind: 'deny' })
    expect(decide('about:config')).toEqual({ kind: 'deny' })
  })
})

describe('popupForwardUrl regression locks', () => {
  test('opener-scoped targets are NOT smuggled into the tab branch', () => {
    // They have no URL to forward; a tab would 404 on a blob and be blank on
    // about:blank, with window.opener severed either way.
    expect(popupForwardUrl('about:blank')).toBeNull()
    expect(popupForwardUrl('blob:https://a/b')).toBeNull()
  })
})

describe('popupWindowSize', () => {
  test('a login sheet stays narrow, a document gets room', () => {
    expect(popupWindowSize('sso', '')).toEqual({ width: 520, height: 640 })
    // A 고지서 at 520x640 is unreadable.
    expect(popupWindowSize('opener', '')).toEqual({ width: 900, height: 760 })
  })

  test('the site may size its own window', () => {
    expect(popupWindowSize('sso', 'width=680,height=900')).toEqual({
      width: 680,
      height: 900
    })
  })

  test('but not to something invisible or larger than a screen', () => {
    expect(popupWindowSize('opener', 'width=1,height=1')).toEqual({
      width: 320,
      height: 320
    })
    expect(popupWindowSize('opener', 'width=9000,height=9000')).toEqual({
      width: 1400,
      height: 1200
    })
  })
})

describe('sanitizeGuestWebPreferences — the PDF viewer', () => {
  test('plugins is on, so a PDF renders instead of downloading', () => {
    const prefs: Record<string, unknown> = {}
    sanitizeGuestWebPreferences(prefs)
    expect(prefs['plugins']).toBe(true)
  })

  test('and every hardening flag still holds', () => {
    const prefs: Record<string, unknown> = {
      preload: '/evil.js',
      nodeIntegration: true,
      sandbox: false
    }
    sanitizeGuestWebPreferences(prefs)
    expect(prefs['preload']).toBeUndefined()
    expect(prefs['nodeIntegration']).toBe(false)
    expect(prefs['sandbox']).toBe(true)
    expect(prefs['contextIsolation']).toBe(true)
    expect(prefs['webSecurity']).toBe(true)
  })
})
