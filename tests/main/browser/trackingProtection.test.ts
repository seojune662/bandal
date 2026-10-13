import { describe, expect, test } from 'vitest'
import {
  privacyRequestHeaders,
  shouldBlockTrackingRequest
} from '../../../src/main/features/browser/trackingProtection'

describe('browser tracking protection', () => {
  test('blocks a known third-party tracker in balanced mode', () => {
    expect(shouldBlockTrackingRequest({
      url: 'https://www.google-analytics.com/g/collect',
      referrer: 'https://portal.example.edu/course',
      resourceType: 'xhr'
    }, 'balanced')).toBe(true)
  })

  test('does not block top-level navigation or same-site resources', () => {
    expect(shouldBlockTrackingRequest({
      url: 'https://google-analytics.com/',
      referrer: 'https://example.edu/',
      resourceType: 'mainFrame'
    }, 'strict')).toBe(false)
    expect(shouldBlockTrackingRequest({
      url: 'https://static.example.edu/app.js',
      referrer: 'https://portal.example.edu/',
      resourceType: 'script'
    }, 'strict')).toBe(false)
  })

  test('strict mode covers additional advertising endpoints', () => {
    const request = {
      url: 'https://pixel.adsrvr.org/track',
      referrer: 'https://example.edu/',
      resourceType: 'image'
    }
    expect(shouldBlockTrackingRequest(request, 'balanced')).toBe(false)
    expect(shouldBlockTrackingRequest(request, 'strict')).toBe(true)
  })

  test.each([
    'https://accounts.google.com/RotateCookies',
    'https://accounts.youtube.com/accounts/SetSID',
    'https://www.youtube.com/youtubei/v1/account/accounts_list',
    'https://rr1.googlevideo.com/videoplayback'
  ])('keeps authentication and media available: %s', url => {
    expect(shouldBlockTrackingRequest({
      url, referrer: 'https://www.youtube.com/', resourceType: 'xhr'
    }, 'strict')).toBe(false)
  })

  test('normalizes a tracker host with a terminal dot without broadening domain matches', () => {
    const request = { referrer: 'https://www.youtube.com/', resourceType: 'script' }
    expect(shouldBlockTrackingRequest({ ...request, url: 'https://ad.doubleclick.net./track' }, 'balanced')).toBe(true)
    expect(shouldBlockTrackingRequest({ ...request, url: 'https://notdoubleclick.net/track' }, 'strict')).toBe(false)
    expect(shouldBlockTrackingRequest({ ...request, url: 'https://doubleclick.net.example.com/track' }, 'strict')).toBe(false)
  })

  test('adds privacy headers without mutating the input', () => {
    const original = { Accept: 'text/html' }
    expect(privacyRequestHeaders(original, true)).toEqual({
      Accept: 'text/html',
      DNT: '1',
      'Sec-GPC': '1'
    })
    expect(original).toEqual({ Accept: 'text/html' })
    expect(privacyRequestHeaders(original, false)).toBe(original)
  })
})
