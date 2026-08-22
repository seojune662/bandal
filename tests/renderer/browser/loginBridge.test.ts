import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  consumeStagedPrompt,
  isLoginPromptSuppressed,
  isSameLoginSite,
  LOGIN_REPORT_PREFIX,
  parseLoginReport,
  REPORTER_SOURCE,
  resetLoginBridgeForTests,
  suppressLoginPromptForSite,
  type StagedPromptCandidate
} from '../../../src/renderer/src/features/browser/loginBridge'

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
