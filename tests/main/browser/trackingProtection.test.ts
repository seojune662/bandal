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
