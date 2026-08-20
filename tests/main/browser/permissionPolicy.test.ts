/**
 * What a website may do.
 *
 * The policy this replaces was a single allowlist containing `fullscreen`. It
 * was a defensible default for embedding an untrusted page and completely
 * wrong for a browser a student uses as their browser — so the tests here are
 * mostly about the things that used to be silently refused.
 */
import { describe, expect, test } from 'vitest'
import {
  permissionLabel,
  permissionTier
} from '../../../src/main/features/browser/permissionPolicy'

describe('permissionTier', () => {
  test('clipboard writing is granted, because a "복사" button is not a decision', () => {
    // Chrome auto-grants this on a user gesture. Refusing it is what made
    // every LMS 복사 button do nothing at all, with no error anywhere.
    expect(permissionTier('clipboard-sanitized-write')).toBe('grant')
  })

  test('the Storage Access API is granted, because SSO runs in iframes', () => {
    // Safari satisfies these with its own prompt; refusing outright breaks
    // logins that work fine in every other browser.
    expect(permissionTier('storage-access')).toBe('grant')
    expect(permissionTier('top-level-storage-access')).toBe('grant')
  })

  test('fullscreen and pointer lock stay granted', () => {
    expect(permissionTier('fullscreen')).toBe('grant')
    expect(permissionTier('pointerLock')).toBe('grant')
  })

  test('real capabilities are asked about, not assumed', () => {
    for (const permission of [
      'notifications',
      'geolocation',
      'media',
      'clipboard-read',
      'display-capture',
      'midi'
    ]) {
      expect(permissionTier(permission)).toBe('ask')
    }
  })

  test('physical devices are refused without a prompt', () => {
    // A prompt a student cannot evaluate teaches them to press 허용.
    for (const permission of ['hid', 'serial', 'usb', 'fileSystem']) {
      expect(permissionTier(permission)).toBe('deny')
    }
  })

  test('DRM is refused, not asked about — Electron ships no Widevine', () => {
    // A prompt the student answers and nothing happens is the worst failure
    // shape a permission can have. Playing DRM lecture video needs the
    // castlabs Electron fork: a build decision, not a permission one.
    expect(permissionTier('mediaKeySystem')).toBe('deny')
  })

  test('openExternal is refused here, because it has its own flow', () => {
    // externalScheme.ts shows the full URL and the requesting origin. A
    // generic yes/no would hide exactly the detail that matters.
    expect(permissionTier('openExternal')).toBe('deny')
  })

  test('an unknown permission is refused, never asked about', () => {
    // Chromium adds permissions faster than we can review them, and "ask"
    // would put a question in front of the student that neither of us
    // understands.
    expect(permissionTier('some-future-capability')).toBe('deny')
    expect(permissionTier('')).toBe('deny')
  })
})

describe('permissionLabel', () => {
  test('every asked-about permission has Korean copy', () => {
    for (const permission of [
      'notifications',
      'geolocation',
      'media',
      'clipboard-read',
      'display-capture',
      'midi',
      'midiSysex',
      'window-management'
    ]) {
      expect(permissionTier(permission)).toBe('ask')
      // A prompt that says "media" in a Korean app is not a prompt.
      expect(permissionLabel(permission)).not.toBe(permission)
    }
  })
})
