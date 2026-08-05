/**
 * The deep-link parser is the only thing standing between an OS-delivered
 * string and `exchangeCodeForSession`, so its whole job is classification —
 * including refusing to guess. Every case below is one that has actually
 * shipped as a bug in some Electron OAuth app.
 */

import { describe, expect, test } from 'vitest'
import {
  AUTH_CALLBACK_URL,
  describeAuthCallback,
  findDeepLinkArg,
  isAuthCallbackUrl,
  isBandalDeepLink,
  parseAuthCallbackUrl
} from '../../../src/main/features/group/authCallbackUrl'

const CODE = 'e9d1a0b2-4c3f-4a5b-8c7d-1e2f3a4b5c6d'

describe('parseAuthCallbackUrl — the happy path', () => {
  test('extracts the authorization code', () => {
    const result = parseAuthCallbackUrl(`${AUTH_CALLBACK_URL}?code=${CODE}`)
    expect(result).toEqual({ kind: 'code', code: CODE })
  })

  test('tolerates a trailing slash and extra params', () => {
    expect(
      parseAuthCallbackUrl(`bandal://auth/callback/?code=${CODE}&state=xyz`)
    ).toEqual({ kind: 'code', code: CODE })
  })

  test('tolerates surrounding whitespace from argv handling', () => {
    expect(
      parseAuthCallbackUrl(`  ${AUTH_CALLBACK_URL}?code=${CODE}\n`)
    ).toEqual({ kind: 'code', code: CODE })
  })

  test('accepts base64url-shaped codes, not just uuids', () => {
    const base64url = 'abcDEF-123_x.y~z'
    expect(
      parseAuthCallbackUrl(`${AUTH_CALLBACK_URL}?code=${base64url}`)
    ).toEqual({ kind: 'code', code: base64url })
  })

  test('a raw "+" in the query decodes to a space and is rejected', () => {
    // Not pedantry: `+` means space in a query string, so an unencoded code
    // containing one is already corrupted by the time we see it. Exchanging it
    // would fail server-side with a far less obvious message.
    expect(parseAuthCallbackUrl(`${AUTH_CALLBACK_URL}?code=ab+cd`).kind).toBe(
      'failed'
    )
  })
})

describe('parseAuthCallbackUrl — cancellation is not an error', () => {
  test('access_denied reads as cancelled', () => {
    expect(
      parseAuthCallbackUrl(
        `${AUTH_CALLBACK_URL}?error=access_denied&error_description=The+user+denied`
      )
    ).toEqual({ kind: 'cancelled' })
  })

  test('a user_cancelled error_code reads as cancelled', () => {
    expect(
      parseAuthCallbackUrl(`${AUTH_CALLBACK_URL}?error_code=user_cancelled`)
    ).toEqual({ kind: 'cancelled' })
  })

  test('a code arriving alongside an error is never exchanged', () => {
    const result = parseAuthCallbackUrl(
      `${AUTH_CALLBACK_URL}?error=server_error&code=${CODE}`
    )
    expect(result.kind).toBe('failed')
  })
})

describe('parseAuthCallbackUrl — refusals', () => {
  test('a provider error carries only a sanitized token', () => {
    expect(
      parseAuthCallbackUrl(
        `${AUTH_CALLBACK_URL}?error=server_error&error_code=bad_oauth_state`
      )
    ).toEqual({ kind: 'failed', reason: 'provider', detail: 'bad_oauth_state' })
  })

  test('an untrusted error value is collapsed, never echoed', () => {
    const result = parseAuthCallbackUrl(
      `${AUTH_CALLBACK_URL}?error=${encodeURIComponent('<script>alert(1)</script>')}`
    )
    expect(result).toEqual({ kind: 'failed', reason: 'provider', detail: 'unknown' })
  })

  test('a callback with no code and no error fails loudly', () => {
    // Silence here is the worse bug: the UI would sit on "signing-in" forever.
    expect(parseAuthCallbackUrl(AUTH_CALLBACK_URL)).toEqual({
      kind: 'failed',
      reason: 'missing_code',
      detail: null
    })
  })

  test('an empty code is not a code', () => {
    expect(parseAuthCallbackUrl(`${AUTH_CALLBACK_URL}?code=`).kind).toBe('failed')
  })

  test('two different codes are ambiguous and never guessed at', () => {
    expect(
      parseAuthCallbackUrl(`${AUTH_CALLBACK_URL}?code=${CODE}&code=other-code`)
    ).toEqual({ kind: 'failed', reason: 'ambiguous_code', detail: null })
  })

  test('a duplicated but identical code is fine', () => {
    expect(
      parseAuthCallbackUrl(`${AUTH_CALLBACK_URL}?code=${CODE}&code=${CODE}`)
    ).toEqual({ kind: 'code', code: CODE })
  })

  test('a code with junk in it is rejected', () => {
    expect(
      parseAuthCallbackUrl(
        `${AUTH_CALLBACK_URL}?code=${encodeURIComponent('abc def"; rm -rf')}`
      )
    ).toEqual({ kind: 'failed', reason: 'malformed_code', detail: null })
  })
})

describe('parseAuthCallbackUrl — not ours', () => {
  test('another app scheme is ignored', () => {
    expect(parseAuthCallbackUrl(`otherapp://auth/callback?code=${CODE}`)).toEqual({
      kind: 'ignored',
      why: 'not-bandal'
    })
    expect(parseAuthCallbackUrl(`https://example.com/auth/callback?code=${CODE}`)).toEqual(
      { kind: 'ignored', why: 'not-bandal' }
    )
  })

  test('a different bandal route is ignored, not failed', () => {
    expect(parseAuthCallbackUrl('bandal://open/course/abc')).toEqual({
      kind: 'ignored',
      why: 'not-auth-callback'
    })
  })

  test('junk is ignored', () => {
    for (const junk of ['', '   ', 'not a url', '://', 'bandal', '?code=1']) {
      expect(parseAuthCallbackUrl(junk)).toEqual({
        kind: 'ignored',
        why: 'unparseable'
      })
    }
  })
})

describe('isBandalDeepLink / isAuthCallbackUrl', () => {
  test('the auth route is both a bandal link and the callback', () => {
    expect(isBandalDeepLink(`${AUTH_CALLBACK_URL}?code=${CODE}`)).toBe(true)
    expect(isAuthCallbackUrl(`${AUTH_CALLBACK_URL}?code=${CODE}`)).toBe(true)
  })

  test('another bandal route must not wake the auth runtime', () => {
    expect(isBandalDeepLink('bandal://open/course/abc')).toBe(true)
    expect(isAuthCallbackUrl('bandal://open/course/abc')).toBe(false)
  })

  test('foreign and malformed urls are neither', () => {
    expect(isBandalDeepLink('https://bandal.app/auth/callback')).toBe(false)
    expect(isAuthCallbackUrl('nonsense')).toBe(false)
  })
})

describe('describeAuthCallback', () => {
  test('never leaks the code into a log line', () => {
    const described = describeAuthCallback(
      `${AUTH_CALLBACK_URL}?code=${CODE}&access_token=secret`
    )
    expect(described).toBe(AUTH_CALLBACK_URL)
    expect(described).not.toContain(CODE)
    expect(described).not.toContain('secret')
  })

  test('degrades to a placeholder rather than echoing junk', () => {
    expect(describeAuthCallback('%%%')).toBe('<unparseable>')
  })
})

describe('findDeepLinkArg', () => {
  test('picks the bandal url out of a Windows-style argv', () => {
    const argv = [
      '/Applications/Bandal.app/Contents/MacOS/Bandal',
      '--allow-file-access',
      `${AUTH_CALLBACK_URL}?code=${CODE}`
    ]
    expect(findDeepLinkArg(argv)).toBe(`${AUTH_CALLBACK_URL}?code=${CODE}`)
  })

  test('returns null for an ordinary launch', () => {
    expect(findDeepLinkArg(['/path/to/electron', '.'])).toBeNull()
    expect(findDeepLinkArg([])).toBeNull()
  })
})
