// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))

import {
  consumeStagedPrompt,
  isLoginPromptSuppressed,
  isSameLoginSite,
  LOGIN_REPORT_PREFIX,
  parseLoginReport,
  REPORTER_SOURCE,
  resetLoginBridgeForTests,
  saveStagedLoginForTab,
  suppressLoginPromptForSite,
  useBrowserLoginBridge,
  type StagedPromptCandidate
} from '../../../src/renderer/src/features/browser/loginBridge'
import { resetBrowserGuestsForTests, useBrowserGuests } from '../../../src/renderer/src/features/browser/browserGuestsStore'
import type { BrowserPageHandle } from '../../../src/renderer/src/features/browser/browserPageTypes'
import { STAGED_LOGIN_TTL_MS, type SavedLoginSummary } from '../../../src/shared/types/credentials'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  resetLoginBridgeForTests()
  vi.unstubAllGlobals()
})

describe('login reporter', () => {
  test('parses a submission report without accepting field values', () => {
    const report = parseLoginReport(
      LOGIN_REPORT_PREFIX + JSON.stringify({
        kind: 'submit',
        origin: 'https://PORTAL.example.edu',
        username: 'must-not-cross',
        password: 'must-not-cross'
      })
    )

    expect(report).toEqual({
      kind: 'submit',
      origin: 'https://portal.example.edu'
    })
    expect(report).not.toHaveProperty('username')
    expect(report).not.toHaveProperty('password')
  })

  test('detects password fields without requiring a form ancestor', () => {
    expect(REPORTER_SOURCE).toContain('document.querySelectorAll(')
    expect(REPORTER_SOURCE).not.toContain('password.form')
    expect(REPORTER_SOURCE).toContain("document.addEventListener('submit'")
    expect(REPORTER_SOURCE).toContain("event.key === 'Enter'")
    expect(REPORTER_SOURCE).toContain("event.target.closest('button, input')")
  })
})

describe('post-navigation saved-login prompt', () => {
  test('appears once only after a related-site navigation removes the form', () => {
    const candidate: StagedPromptCandidate = {
      origin: 'https://nsso.snu.ac.kr',
      username: 'student',
      kind: 'save',
      ready: true,
      navigated: false,
      prompted: false
    }

    expect(
      consumeStagedPrompt(candidate, 'https://my.snu.ac.kr', false)
    ).toBe(false)
    candidate.navigated = true
    expect(
      consumeStagedPrompt(candidate, 'https://my.snu.ac.kr', true)
    ).toBe(false)
    expect(
      consumeStagedPrompt(candidate, 'https://my.snu.ac.kr', false)
    ).toBe(true)
    expect(
      consumeStagedPrompt(candidate, 'https://my.snu.ac.kr', false)
    ).toBe(false)
  })

  test.each(['challenge/pk/presend', 'challenge/totp', 'signin/oauth/consent', 'denied'])('does not treat Google %s as a completed login', path => {
    const candidate: StagedPromptCandidate = {
      origin: 'https://accounts.google.com', username: 'student', kind: 'save',
      ready: true, navigated: true, prompted: false
    }
    expect(consumeStagedPrompt(candidate, `https://accounts.google.com/${path}`, false)).toBe(false)
    expect(candidate.prompted).toBe(false)
    expect(consumeStagedPrompt(candidate, 'https://drive.google.com', false)).toBe(true)
  })

  test('does not confuse unrelated Korean academic domains', () => {
    expect(
      isSameLoginSite('https://nsso.snu.ac.kr', 'https://my.snu.ac.kr')
    ).toBe(true)
    expect(
      isSameLoginSite('https://nsso.snu.ac.kr', 'https://evil.ac.kr')
    ).toBe(false)
  })

  test('persists the do-not-ask decision by site', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    })

    expect(suppressLoginPromptForSite('snu.ac.kr')).toBe(true)
    resetLoginBridgeForTests()
    expect(isLoginPromptSuppressed('snu.ac.kr')).toBe(true)
  })
})

describe('submitted login lifecycle', () => {
  let root: Root
  let host: HTMLDivElement
  let page: BrowserPageHandle
  let pageUrl: string
  let stored: SavedLoginSummary[]
  let captured: SavedLoginSummary
  const origin = 'https://accounts.google.com'

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T00:00:00.000Z'))
    resetBrowserGuestsForTests()
    pageUrl = `${origin}/signin/v2/challenge/pwd`
    stored = [{ id: 'school', origin, username: 'school', autoSubmit: false, updatedAt: '' }]
    captured = { id: 'staged:7', origin, username: 'personal', autoSubmit: false, updatedAt: new Date().toISOString() }
    mocks.invoke.mockReset().mockImplementation((channel, request) => {
      if (channel === 'credentials:list') return Promise.resolve(stored)
      if (channel === 'credentials:capture') return Promise.resolve(request.mode === 'stage' ? captured : null)
      return Promise.resolve({ filled: false })
    })
    const events = new EventTarget()
    page = Object.assign(events, {
      getURL: () => pageUrl,
      getWebContentsId: () => 7,
      isLoadingMainFrame: () => true,
      executeJavaScript: vi.fn(async () => undefined)
    }) as unknown as BrowserPageHandle
    useBrowserGuests.getState().ensureGuest('login', pageUrl, false, 'default', null)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const ref = { current: page }
    function Harness(): null {
      useBrowserLoginBridge('login', ref)
      return null
    }
    act(() => root.render(React.createElement(Harness)))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  const report = async (payload: object): Promise<void> => {
    await act(async () => {
      page.dispatchEvent(Object.assign(new Event('console-message'), {
        message: LOGIN_REPORT_PREFIX + JSON.stringify(payload)
      }))
    })
  }

  const navigate = async (url: string, hasLoginForm = false): Promise<void> => {
    await act(async () => {
      page.dispatchEvent(new Event('did-start-loading'))
      pageUrl = url
      page.dispatchEvent(new Event('did-navigate'))
    })
    await report({ kind: 'form', origin: new URL(url).origin, hasLoginForm, usernameFocused: false })
  }

  test('adding another account uses save wording and waits through passkey verification', async () => {
    await report({ kind: 'form', origin, hasLoginForm: true, usernameFocused: false })
    expect(useBrowserGuests.getState().login.login?.savedLogin?.username).toBe('school')
    await report({ kind: 'submit', origin })
    await navigate(`${origin}/v3/signin/challenge/pk/presend`)
    expect(useBrowserGuests.getState().login.login?.savePrompt).toBeNull()
    await navigate('https://drive.google.com/drive/u/1/home')
    expect(useBrowserGuests.getState().login.login?.savePrompt).toEqual({
      origin, username: 'personal', kind: 'save'
    })
  })

  test('an existing submitted account uses update wording', async () => {
    captured.username = 'school'
    await report({ kind: 'submit', origin })
    await navigate('https://www.google.com/')
    expect(useBrowserGuests.getState().login.login?.savePrompt).toEqual({
      origin, username: 'school', kind: 'update'
    })
  })

  test('expires the visible prompt with the main-only candidate instead of leaving a dead save button', async () => {
    await report({ kind: 'submit', origin })
    await navigate('https://www.google.com/')
    expect(useBrowserGuests.getState().login.login?.savePrompt).not.toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(STAGED_LOGIN_TTL_MS) })
    expect(useBrowserGuests.getState().login.login?.savePrompt).toBeNull()
    expect(mocks.invoke).toHaveBeenCalledWith('credentials:capture', expect.objectContaining({ mode: 'discard' }))
    await expect(saveStagedLoginForTab('login')).resolves.toBe('expired')
    expect(mocks.invoke.mock.calls.some(([, request]) => request?.mode === 'commit')).toBe(false)
  })

  test('a refused storage write returns failure and preserves the still-live candidate for retry', async () => {
    await report({ kind: 'submit', origin })
    await navigate('https://www.google.com/')
    await act(async () => { await expect(saveStagedLoginForTab('login')).resolves.toBe('failed') })
    expect(useBrowserGuests.getState().login.login?.savePrompt).not.toBeNull()
    expect(useBrowserGuests.getState().login.login?.pending).toBe(false)
    expect(useBrowserGuests.getState().login.login?.message).toBe('failed')
  })

  test('a thrown save failure returns no error detail and can be retried successfully', async () => {
    await report({ kind: 'submit', origin })
    await navigate('https://www.google.com/')
    mocks.invoke.mockRejectedValueOnce(new Error('private credential failure detail'))
    await act(async () => { await expect(saveStagedLoginForTab('login')).resolves.toBe('failed') })
    expect(useBrowserGuests.getState().login.login?.savePrompt).not.toBeNull()
    expect(useBrowserGuests.getState().login.login?.pending).toBe(false)
    expect(JSON.stringify(useBrowserGuests.getState().login.login)).not.toContain('private credential')
    mocks.invoke.mockResolvedValueOnce({ ...captured, id: 'saved-personal' })
    await act(async () => { await expect(saveStagedLoginForTab('login')).resolves.toBe('saved') })
    expect(useBrowserGuests.getState().login.login?.savePrompt).toBeNull()
    expect(useBrowserGuests.getState().login.login?.message).toBe('saved')
  })

  test('a missing candidate reports expiration without sending a save request', async () => {
    await expect(saveStagedLoginForTab('login')).resolves.toBe('expired')
    expect(mocks.invoke.mock.calls.some(([, request]) => request?.mode === 'commit')).toBe(false)
  })

  test('leaving the login site discards the staged candidate', async () => {
    await report({ kind: 'submit', origin })
    await navigate('https://unrelated.example/')
    await navigate('https://www.google.com/')
    expect(useBrowserGuests.getState().login.login?.savePrompt).toBeNull()
  })
})
