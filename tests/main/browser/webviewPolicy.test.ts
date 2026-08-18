import { describe, expect, test } from 'vitest'
import {
  BROWSING_PARTITION,
  isAllowedAttach,
  isBlockedEmbeddedAuthUrl,
  isNavigationAllowed,
  isPermissionAllowed,
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
