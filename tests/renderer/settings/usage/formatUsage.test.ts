import { describe, expect, test } from 'vitest'
import {
  formatDuration,
  formatRelative,
  formatTokens
} from '../../../../src/renderer/src/features/settings/usage/formatUsage'

describe('usage formatters', () => {
  test('formats totals, durations, and relative times for the usage panel', () => {
    expect(formatTokens(1_234_567)).toBe('1,234,567')
    expect(formatDuration((5 * 60 + 12) * 60_000)).toBe('5시간 12분')
    expect(formatDuration(48 * 60_000)).toBe('48분')
    expect(formatDuration(0)).toBe('—')
    expect(
      formatRelative(
        '2026-09-05T01:00:00.000Z',
        new Date('2026-09-05T04:00:00.000Z')
      )
    ).toBe('3시간 전')
  })
})
