import { describe, expect, test, vi } from 'vitest'
import { createLoginFiller } from '../../../src/main/features/credentials'
import type {
  LoginGuestWebContents,
  ResolvedLogin
} from '../../../src/main/features/credentials'

function fakeStore(login: ResolvedLogin | null = {
  username: 'student',
  password: 'secret',
  autoSubmit: false
}) {
  return { resolve: vi.fn(() => login) }
}

function fakeGuest(url: string, result: unknown = {
  filled: true,
  submitted: false
}): LoginGuestWebContents & { scripts: string[] } {
  const scripts: string[] = []
  return {
    scripts,
    getType: () => 'webview',
    getURL: () => url,
    executeJavaScript: async (source) => {
      scripts.push(source)
      return result
    }
  }
}

describe('main login fill origin boundary', () => {
  test.each([
    {
      label: 'http request and page',
      requested: 'http://portal.example.edu',
      current: 'http://portal.example.edu/login'
    },
    {
      label: 'different origin',
      requested: 'https://portal.example.edu',
      current: 'https://accounts.example.edu/login'
    },
    {
      label: 'subdomain',
      requested: 'https://portal.example.edu',
      current: 'https://sso.portal.example.edu/login'
    }
  ])('does not inject for $label', async ({ requested, current }) => {
    const guest = fakeGuest(current)
    const store = fakeStore()
    const fill = createLoginFiller(store, { fromId: () => guest })

    await expect(fill({
      origin: requested,
      guestWebContentsId: 41
    })).resolves.toEqual({ filled: false, submitted: false })
    expect(guest.scripts).toEqual([])
    expect(store.resolve).not.toHaveBeenCalled()
  })

  test('does not inject into a non-webview WebContents', async () => {
    const guest = fakeGuest('https://portal.example.edu/login')
    guest.getType = () => 'window'
    const fill = createLoginFiller(fakeStore(), { fromId: () => guest })

    await expect(fill({
      origin: 'https://portal.example.edu',
      guestWebContentsId: 1
    })).resolves.toEqual({ filled: false, submitted: false })
    expect(guest.scripts).toEqual([])
  })

  test('injects only after exact canonical origin match and guards the top frame', async () => {
    const guest = fakeGuest('https://portal.example.edu/login?next=/course')
    const fill = createLoginFiller(fakeStore(), { fromId: () => guest })

    await expect(fill({
      origin: 'https://portal.example.edu/auth',
      guestWebContentsId: 7
    })).resolves.toEqual({ filled: true, submitted: false })
    expect(guest.scripts).toHaveLength(1)
    expect(guest.scripts[0]).toContain('window.top !== window')
    expect(guest.scripts[0]).toContain('location.origin !== "https://portal.example.edu"')
    expect(guest.scripts[0]).not.toContain('console.')
  })

  test('passes userGesture and reports submitted only for opted-in login', async () => {
    const guest = fakeGuest('https://portal.example.edu', {
      filled: true,
      submitted: true
    })
    const execute = vi.spyOn(guest, 'executeJavaScript')
    const fill = createLoginFiller(fakeStore({
      username: 'student',
      password: 'secret',
      autoSubmit: true
    }), { fromId: () => guest })

    await expect(fill({
      origin: 'https://portal.example.edu',
      guestWebContentsId: 7
    })).resolves.toEqual({ filled: true, submitted: true })
    expect(execute).toHaveBeenCalledWith(expect.any(String), true)
  })

  test('quietly returns not-filled when injection fails', async () => {
    const guest = fakeGuest('https://portal.example.edu')
    guest.executeJavaScript = async () => {
      throw new Error('guest disappeared')
    }
    const fill = createLoginFiller(fakeStore(), { fromId: () => guest })

    await expect(fill({
      origin: 'https://portal.example.edu',
      guestWebContentsId: 7
    })).resolves.toEqual({ filled: false, submitted: false })
  })

  test('quietly returns not-filled when guest inspection or secret resolution fails', async () => {
    const guest = fakeGuest('https://portal.example.edu')
    guest.getType = () => {
      throw new Error('destroyed')
    }
    const fillForDestroyedGuest = createLoginFiller(fakeStore(), {
      fromId: () => guest
    })
    await expect(fillForDestroyedGuest({
      origin: 'https://portal.example.edu',
      guestWebContentsId: 7
    })).resolves.toEqual({ filled: false, submitted: false })

    const fillForStoreFailure = createLoginFiller({
      resolve: () => {
        throw new Error('unreadable')
      }
    }, { fromId: () => fakeGuest('https://portal.example.edu') })
    await expect(fillForStoreFailure({
      origin: 'https://portal.example.edu',
      guestWebContentsId: 8
    })).resolves.toEqual({ filled: false, submitted: false })
  })
})
