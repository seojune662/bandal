import { describe, expect, test } from 'vitest'
import {
  CALLOUT_TYPES,
  normalizeCalloutType
} from '../../../../src/renderer/src/features/notes/callout/calloutTypes'

describe('callout type normalization', () => {
  test.each([
    ['summary', 'abstract'],
    ['tldr', 'abstract'],
    ['hint', 'tip'],
    ['important', 'tip'],
    ['check', 'success'],
    ['done', 'success'],
    ['help', 'question'],
    ['faq', 'question'],
    ['caution', 'warning'],
    ['attention', 'warning'],
    ['fail', 'failure'],
    ['missing', 'failure'],
    ['danger', 'failure'],
    ['error', 'failure'],
    ['cite', 'quote']
  ])('%s normalizes to %s', (source, expected) => {
    expect(normalizeCalloutType(source)).toBe(expected)
  })

  test('canonical types are case-insensitive', () => {
    for (const type of CALLOUT_TYPES) {
      expect(normalizeCalloutType(type.toLocaleUpperCase())).toBe(type)
    }
  })

  test('unknown types render with the note fallback', () => {
    expect(normalizeCalloutType('custom-alert')).toBe('note')
  })
})
