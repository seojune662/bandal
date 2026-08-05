/**
 * settings.json is a plain file: a newer build, a hand edit, or a truncated
 * write must degrade to defaults rather than brick the app.
 */

import { describe, expect, test } from 'vitest'
import {
  sanitizeService,
  sanitizeUniversitySettings
} from '../../../src/shared/universities/sanitize'
import { DEFAULT_UNIVERSITY_SETTINGS } from '../../../src/shared/types/university'

describe('sanitizeUniversitySettings', () => {
  test('junk falls back to the defaults', () => {
    for (const raw of [null, undefined, 42, 'snu', []]) {
      expect(sanitizeUniversitySettings(raw)).toEqual(DEFAULT_UNIVERSITY_SETTINGS)
    }
  })

  test('keeps a valid preset selection', () => {
    expect(
      sanitizeUniversitySettings({ universityId: 'snu' }).universityId
    ).toBe('snu')
  })

  test('drops non-string entries from the hidden list and overrides map', () => {
    const result = sanitizeUniversitySettings({
      hiddenServiceIds: ['snu.food', 7, null],
      openExternallyOverrides: { 'snu.mail': false, 'snu.portal': 'yes' }
    })

    expect(result.hiddenServiceIds).toEqual(['snu.food'])
    expect(result.openExternallyOverrides).toEqual({ 'snu.mail': false })
  })

  test('drops a custom school with no name and keeps a valid one', () => {
    expect(
      sanitizeUniversitySettings({ customUniversity: { id: 'custom:1' } })
        .customUniversity
    ).toBeNull()

    const kept = sanitizeUniversitySettings({
      customUniversity: { id: 'custom:1', nameKo: '한밭대학교', services: [] }
    }).customUniversity
    expect(kept?.nameKo).toBe('한밭대학교')
  })
})

describe('sanitizeService', () => {
  test('accepts a minimal valid service and normalises its URL', () => {
    const service = sanitizeService({
      id: 'x.lms',
      label: '강의실',
      url: 'lms.x.ac.kr'
    })

    expect(service?.url).toBe('https://lms.x.ac.kr/')
    // Unknown kind/verification fall back to the most conservative values.
    expect(service?.kind).toBe('other')
    expect(service?.verification).toBe('unverified')
  })

  test('rejects a service whose URL is not http(s)', () => {
    expect(
      sanitizeService({ id: 'x.bad', label: 'bad', url: 'javascript:alert(1)' })
    ).toBeNull()
    expect(sanitizeService({ id: 'x.bad', label: 'bad' })).toBeNull()
  })

  test('carries the external flag only with a known reason', () => {
    const withReason = sanitizeService({
      id: 'x.mail',
      label: '메일',
      url: 'https://mail.google.com/',
      opensExternally: true,
      externalReason: 'federated-login'
    })
    expect(withReason?.opensExternally).toBe(true)
    expect(withReason?.externalReason).toBe('federated-login')

    const bogusReason = sanitizeService({
      id: 'x.mail',
      label: '메일',
      url: 'https://mail.google.com/',
      opensExternally: true,
      externalReason: 'because'
    })
    expect(bogusReason?.opensExternally).toBe(true)
    expect(bogusReason?.externalReason).toBeUndefined()
  })
})
