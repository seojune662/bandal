/**
 * HTTP authentication prompts.
 *
 * There was no handler at all, and Electron's default with no `login`
 * listener is to CANCEL the request — so 도서관 학외접속 프록시 and older
 * 학사 시스템 rendered a blank rect with no prompt, and a student behind an
 * authenticating campus proxy had a browser that failed every request.
 */
import { describe, expect, test, vi } from 'vitest'
import {
  authPromptCopy,
  authPromptKey,
  resolveAuthPrompt
} from '../../../src/main/features/browser/httpAuth'

const SITE = {
  isProxy: false,
  host: 'lib.snu.ac.kr',
  port: 443,
  realm: 'Library',
  scheme: 'basic'
}

describe('authPromptCopy', () => {
  test('names the site and its realm', () => {
    const copy = authPromptCopy(SITE)
    expect(copy.message).toContain('lib.snu.ac.kr')
    expect(copy.detail).toContain('Library')
  })

  test('says PROXY when it is a proxy', () => {
    // The classic attack is a site that triggers a 407 so the box reads like a
    // system prompt. Saying which it is costs one line.
    const copy = authPromptCopy({ ...SITE, isProxy: true })
    expect(copy.message).toContain('프록시')
    expect(copy.detail).toContain('웹사이트가 아니라')
  })

  test('a realm-less challenge does not print an empty 영역', () => {
    const copy = authPromptCopy({ ...SITE, realm: '' })
    expect(copy.detail).not.toContain('영역:')
  })

  test('the port is shown only when it is part of the identity', () => {
    expect(authPromptCopy({ ...SITE, port: 8443 }).message).toContain(':8443')
    expect(authPromptCopy({ ...SITE, port: 0 }).message).not.toContain(':0')
  })
})

describe('authPromptKey', () => {
  test('proxy and site challenges are different questions', () => {
    expect(authPromptKey(SITE)).not.toBe(authPromptKey({ ...SITE, isProxy: true }))
  })

  test('realm is part of the identity', () => {
    expect(authPromptKey(SITE)).not.toBe(authPromptKey({ ...SITE, realm: 'Other' }))
  })
})

describe('resolveAuthPrompt', () => {
  test('returns what the student typed', async () => {
    const ask = vi.fn(async () => ({ username: 'a', password: 'b' }))
    expect(await resolveAuthPrompt(SITE, { ask })).toEqual({
      username: 'a',
      password: 'b'
    })
  })

  test('cancelling means the request fails, as in a browser', async () => {
    const ask = vi.fn(async () => null)
    expect(await resolveAuthPrompt(SITE, { ask })).toBeNull()
  })

  test('a page cannot stack prompts by retrying in a loop', async () => {
    // A 401 loop would otherwise put an unbounded chain of modal boxes over
    // the whole app.
    let release: (value: null) => void = () => undefined
    const pending = new Promise<null>((resolve) => {
      release = resolve
    })
    const ask = vi.fn(() => pending)
    const first = resolveAuthPrompt(SITE, { ask })
    const second = await resolveAuthPrompt(SITE, { ask })
    expect(second).toBeNull()
    expect(ask).toHaveBeenCalledTimes(1)
    release(null)
    await first
  })

  test('a different challenge is still allowed while one is open', async () => {
    let release: (value: null) => void = () => undefined
    const pending = new Promise<null>((resolve) => {
      release = resolve
    })
    const ask = vi.fn(() => pending)
    const first = resolveAuthPrompt(SITE, { ask })
    void resolveAuthPrompt({ ...SITE, host: 'other.ac.kr' }, { ask })
    expect(ask).toHaveBeenCalledTimes(2)
    release(null)
    await first
  })
})
