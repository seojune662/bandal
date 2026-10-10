import { expect, test } from 'vitest'
import { browserProfileStartUrl, externalAuthRestartUrl, isEmbeddedAuthProviderUrl } from '../../src/shared/browserAuth'

test('profile changes preserve ordinary documents but restart stateful sign-in flows', () => {
  expect(browserProfileStartUrl('https://portal.example.edu/course?id=4')).toBe('https://portal.example.edu/course?id=4')
  expect(browserProfileStartUrl('https://auth.openai.com/authorize?state=old')).toBe('https://chatgpt.com/')
  expect(browserProfileStartUrl('https://accounts.google.com/v3/signin?state=old', 'https://chatgpt.com/')).toBe('https://chatgpt.com/')
})

test('external login restarts at the source site without credentials, state, or fragments', () => {
  expect(externalAuthRestartUrl('https://accounts.google.com/v3/signin?state=old', 'https://student:password@portal.example.edu/callback?token=private#secret')).toBe('https://portal.example.edu/')
})

test('nested Google continuation addresses identify ChatGPT without passing one-time URLs', () => {
  const continuation = new URL('https://accounts.google.com/o/oauth2/auth')
  continuation.searchParams.set('redirect_uri', 'https://auth.openai.com/login/callback?code=private')
  const url = new URL('https://accounts.google.com/v3/signin/challenge')
  url.searchParams.set('continue', continuation.href)
  expect(externalAuthRestartUrl(url.href)).toBe('https://chatgpt.com/')
  expect(externalAuthRestartUrl(url.href, 'https://www.google.com/search?q=ChatGPT')).toBe('https://chatgpt.com/')
})

test('unrecognised redirects never become an external login destination', () => {
  expect(externalAuthRestartUrl('https://accounts.google.com/signin?continue=https://chatgpt.com.attacker.test/')).toBe('https://accounts.google.com/')
  expect(externalAuthRestartUrl('https://accounts.google.com/signin?redirect_uri=file:///private/secret')).toBe('https://accounts.google.com/')
})

test.each(['http://accounts.google.com/', 'https://accounts.google.com.attacker.test/', 'https://example.com/?next=accounts.google.com', 'not a URL'])('does not detect a Google provider from %s', url => {
  expect(isEmbeddedAuthProviderUrl(url)).toBe(false)
})
