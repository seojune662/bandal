/**
 * Saving a login must not route the password through the renderer.
 *
 * The first implementation had the browser tab read the password field itself
 * and forward it over IPC. That works, but it puts the secret in a second
 * process for no reason. Main can read the same field directly, so the only
 * places the password exists are the page the student typed it into and the
 * encrypted file.
 *
 * These pin that, plus the origin boundary — storing a password against the
 * wrong origin is worse than not storing it, because the fill path would then
 * hand it to that other site.
 */

import { describe, expect, test, vi } from 'vitest'
import { createLoginCapturer } from '../../../src/main/features/credentials'
import type { LoginGuestWebContents } from '../../../src/main/features/credentials'
import type { SaveLoginInput } from '../../../src/shared/types/credentials'

const TYPED = { username: 'student', password: 'hunter2' }

function fakeStore() {
  const saved: SaveLoginInput[] = []
  return {
    saved,
    save: vi.fn((input: SaveLoginInput) => {
      saved.push(input)
      return {
        origin: input.origin,
        username: input.username,
        autoSubmit: input.autoSubmit ?? false,
        updatedAt: '2026-08-09T00:00:00.000Z'
      }
    })
  }
}

function fakeGuest(
  url: string,
  typed: unknown = TYPED
): LoginGuestWebContents & { scripts: string[] } {
  const scripts: string[] = []
  return {
    scripts,
    getType: () => 'webview',
    getURL: () => url,
    executeJavaScript: async (source) => {
      scripts.push(source)
      return typed
    }
  }
}

describe('saving a login reads the password inside main', () => {
  test('stores what the page reports, and returns a summary with no password', async () => {
    const guest = fakeGuest('https://portal.example.edu/login?next=/course')
    const store = fakeStore()
    const capture = createLoginCapturer(store, { fromId: () => guest })

    const summary = await capture({
      origin: 'https://portal.example.edu',
      guestWebContentsId: 7
    })

    expect(summary).toEqual({
      origin: 'https://portal.example.edu',
      username: 'student',
      autoSubmit: false,
      updatedAt: '2026-08-09T00:00:00.000Z'
    })
    expect(JSON.stringify(summary)).not.toContain('hunter2')
    expect(store.saved[0]?.password).toBe('hunter2')
  })

  test('auto-submit stays off unless the caller asks for it', async () => {
    const store = fakeStore()
    const capture = createLoginCapturer(store, {
      fromId: () => fakeGuest('https://portal.example.edu')
    })

    await capture({ origin: 'https://portal.example.edu', guestWebContentsId: 1 })

    // A wrong stored password submitted on every visit locks out a university
    // portal, so opting in has to be a separate, deliberate act.
    expect(store.saved[0]?.autoSubmit).toBe(false)
  })

  test.each([
    { label: 'http', requested: 'http://portal.example.edu', current: 'http://portal.example.edu/login' },
    { label: 'another origin', requested: 'https://portal.example.edu', current: 'https://evil.example.com/login' },
    { label: 'a subdomain', requested: 'https://portal.example.edu', current: 'https://sso.portal.example.edu' }
  ])('refuses to read the field on $label', async ({ requested, current }) => {
    const guest = fakeGuest(current)
    const store = fakeStore()
    const capture = createLoginCapturer(store, { fromId: () => guest })

    await expect(
      capture({ origin: requested, guestWebContentsId: 2 })
    ).resolves.toBeNull()
    expect(guest.scripts).toEqual([])
    expect(store.save).not.toHaveBeenCalled()
  })

  test('refuses a WebContents that is not a browser tab', async () => {
    const guest = fakeGuest('https://portal.example.edu')
    guest.getType = () => 'window'
    const store = fakeStore()
    const capture = createLoginCapturer(store, { fromId: () => guest })

    await expect(
      capture({ origin: 'https://portal.example.edu', guestWebContentsId: 3 })
    ).resolves.toBeNull()
    expect(store.save).not.toHaveBeenCalled()
  })

  test('discards the read if the page navigated away while it was in flight', async () => {
    let url = 'https://portal.example.edu/login'
    const store = fakeStore()
    const capture = createLoginCapturer(store, {
      fromId: () => ({
        getType: () => 'webview',
        getURL: () => url,
        executeJavaScript: async () => {
          url = 'https://evil.example.com/'
          return TYPED
        }
      })
    })

    await expect(
      capture({ origin: 'https://portal.example.edu', guestWebContentsId: 4 })
    ).resolves.toBeNull()
    // Storing it now would file the portal password under whichever origin
    // happened to win the race.
    expect(store.save).not.toHaveBeenCalled()
  })

  test.each([
    { label: 'nothing typed yet', typed: null },
    { label: 'an empty password', typed: { username: 'student', password: '' } },
    { label: 'a blank username', typed: { username: '   ', password: 'x' } },
    { label: 'a non-string payload', typed: { username: 1, password: 2 } },
    { label: 'an absurd payload', typed: { username: 'a', password: 'x'.repeat(100_001) } }
  ])('saves nothing for $label', async ({ typed }) => {
    const store = fakeStore()
    const capture = createLoginCapturer(store, {
      fromId: () => fakeGuest('https://portal.example.edu', typed)
    })

    await expect(
      capture({ origin: 'https://portal.example.edu', guestWebContentsId: 5 })
    ).resolves.toBeNull()
    expect(store.save).not.toHaveBeenCalled()
  })

  test('a failing read or a refused store is quiet, never an error carrying the secret', async () => {
    const guest = fakeGuest('https://portal.example.edu')
    guest.executeJavaScript = async () => {
      throw new Error('guest destroyed')
    }
    const capture = createLoginCapturer(fakeStore(), { fromId: () => guest })
    await expect(
      capture({ origin: 'https://portal.example.edu', guestWebContentsId: 6 })
    ).resolves.toBeNull()

    const captureWithoutEncryption = createLoginCapturer(
      {
        save: () => {
          throw new Error('OS-backed encryption is unavailable')
        }
      },
      { fromId: () => fakeGuest('https://portal.example.edu') }
    )
    await expect(
      captureWithoutEncryption({
        origin: 'https://portal.example.edu',
        guestWebContentsId: 7
      })
    ).resolves.toBeNull()
  })
})
