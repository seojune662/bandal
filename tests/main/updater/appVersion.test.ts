import { describe, expect, test } from 'vitest'
import { resolveAppVersion } from '../../../src/main/features/updater/appVersion'

describe('resolveAppVersion', () => {
  test('uses the installed runtime version for a packaged app', () => {
    expect(resolveAppVersion(true, '0.24.1', '0.24.0')).toBe('0.24.1')
  })

  test('uses the injected package version for development and E2E builds', () => {
    expect(resolveAppVersion(false, '35.7.5', '0.24.0')).toBe('0.24.0')
  })
})
