import { describe, expect, test } from 'vitest'
import {
  formatDuration,
  formatRelative,
  formatTokens
} from '../../../../src/renderer/src/features/settings/usage/formatUsage'
import { translate } from '../../../../src/renderer/src/i18n/translate'

const ko = (key: string, vars?: Record<string, string | number>) => translate('ko-KR', key, vars)
const en = (key: string, vars?: Record<string, string | number>) => translate('en-US', key, vars)

describe('usage formatters', () => {
  test('formats totals, durations, and relative times for the usage panel', () => {
    expect(formatTokens(1_234_567)).toBe('1,234,567')
    expect(formatDuration((5 * 60 + 12) * 60_000, ko)).toBe('5시간 12분')
    expect(formatDuration(48 * 60_000, ko)).toBe('48분')
    expect(formatDuration(0, ko)).toBe('—')
    expect(
      formatRelative(
        '2026-09-05T01:00:00.000Z',
        new Date('2026-09-05T04:00:00.000Z'),
        ko
      )
    ).toBe('3시간 전')
    expect(formatDuration(48 * 60_000, en)).toBe('48m')
    expect(formatRelative('2026-09-05T03:59:30.000Z', new Date('2026-09-05T04:00:00.000Z'), en)).toBe('just now')
  })
})
