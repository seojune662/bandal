/**
 * The agent's navigation guard.
 *
 * These are the checks that stand in for `will-navigate`, which Electron does
 * NOT emit for `webContents.loadURL()` — so the hardening in hardenWebviews
 * simply does not run on the agent path. If this file is wrong, the guest's
 * scheme allowlist is wrong.
 */
import { describe, expect, test } from 'vitest'
import { checkNavigation } from '../../../src/main/features/browserAgent/navigation'
import { denyReasonFor } from '../../../src/main/features/browserAgent/denylist'

const granted = (url: string, capability = 'read' as const) =>
  checkNavigation({ url, capability, heldCapability: 'read' })

describe('checkNavigation', () => {
  test('allows an ordinary granted page', () => {
    const verdict = granted('https://myetl.snu.ac.kr/courses/1')
    expect(verdict.allowed).toBe(true)
  })

  test('re-applies the scheme allowlist loadURL would have skipped', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'chrome://settings',
      'bandal-media://x'
    ]) {
      const verdict = granted(url)
      expect(verdict.allowed, url).toBe(false)
      if (!verdict.allowed) expect(verdict.reason, url).toBe('scheme')
    }
  })

  test('refuses embedded Google auth even with a grant', () => {
    const verdict = granted('https://accounts.google.com/signin')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('external-auth')
  })

  test('refuses 수강신청 regardless of any grant', () => {
    // A grant was never the thing standing in the way here.
    const verdict = checkNavigation({
      url: 'https://sugang.snu.ac.kr/sugang/main',
      capability: 'read',
      heldCapability: 'interact'
    })
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('registration')
  })

  test('refuses a payment gateway regardless of any grant', () => {
    const verdict = checkNavigation({
      url: 'https://stdpay.inicis.com/pay',
      capability: 'read',
      heldCapability: 'interact'
    })
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('payment')
  })

  test('refuses a granted-looking page when there is no grant', () => {
    const verdict = checkNavigation({
      url: 'https://myetl.snu.ac.kr/courses/1',
      capability: 'read',
      heldCapability: null
    })
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('no-grant')
  })

  test('one approval covers interaction too', () => {
    // Splitting read from interact is what produced four prompts for one
    // task. Writing to a site is still a separate question — browser_submit
    // asks every time and is never remembered.
    const verdict = checkNavigation({
      url: 'https://myetl.snu.ac.kr/courses/1',
      capability: 'interact',
      heldCapability: 'read'
    })
    expect(verdict.allowed).toBe(true)
  })

  test('interact implies read', () => {
    const verdict = checkNavigation({
      url: 'https://myetl.snu.ac.kr/courses/1',
      capability: 'read',
      heldCapability: 'interact'
    })
    expect(verdict.allowed).toBe(true)
  })

  test('empty and malformed input never resolves to allowed', () => {
    for (const url of ['', '   ', 'not a url']) {
      expect(granted(url).allowed, JSON.stringify(url)).toBe(false)
    }
  })

  test('every refusal carries a line the agent can relay', () => {
    const verdict = granted('file:///etc/passwd')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.message.length).toBeGreaterThan(5)
  })
})

describe('denyReasonFor', () => {
  test('matches a registration host by label, at any subdomain depth', () => {
    for (const url of [
      'https://sugang.snu.ac.kr/',
      'https://sugang.knu.ac.kr/login',
      'https://my.sugang.ac.kr/x',
      'https://enroll.example.ac.kr/'
    ]) {
      expect(denyReasonFor(url)?.reason, url).toBe('registration')
    }
  })

  test('does not catch a host that merely contains the word', () => {
    // Substring matching here would block real course pages.
    for (const url of [
      'https://notsugang.ac.kr/',
      'https://sugangbook.co.kr/',
      'https://lms.ac.kr/sugang/notice'
    ]) {
      expect(denyReasonFor(url)?.reason, url).not.toBe('registration')
    }
  })

  test('matches a payment host by suffix, not substring', () => {
    expect(denyReasonFor('https://stdpay.inicis.com/')?.reason).toBe('payment')
    expect(denyReasonFor('https://inicis.com.evil.kr/')?.reason).not.toBe(
      'payment'
    )
  })

  test('allows ordinary school pages', () => {
    for (const url of [
      'https://myetl.snu.ac.kr/courses/1',
      'https://portal.inha.ac.kr:8443/',
      'http://127.0.0.1:8080/x'
    ]) {
      expect(denyReasonFor(url), url).toBeNull()
    }
  })
})
