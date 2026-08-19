import { describe, expect, test } from 'vitest'
import {
  BROWSING_PARTITION,
  isAllowedAttach,
  isBlockedEmbeddedAuthUrl,
  isNavigationAllowed,
  isPermissionAllowed,
  passthroughShortcut,
  popupForwardUrl,
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
