import { describe, expect, test } from 'vitest'
import {
  compareSemver,
  isValidSemver
} from '../../../src/shared/plugins/semver'

describe('plugin semver', () => {
  test('keeps numeric precedence exact beyond IEEE-754 precision and overflow', () => {
    for (const [left, right] of [
      ['9007199254740992.0.0', '9007199254740993.0.0'],
      ['1.9007199254740992.0', '1.9007199254740993.0'],
      ['1.0.9007199254740992', '1.0.9007199254740993'],
      ['1.0.0-9007199254740992', '1.0.0-9007199254740993'],
      [`1.0.0-${'9'.repeat(310)}`, `1.0.0-1${'0'.repeat(310)}`]
    ]) {
      expect(compareSemver(left!, right!)).toBe(-1)
      expect(compareSemver(right!, left!)).toBe(1)
      expect(compareSemver(left!, left!)).toBe(0)
    }
  })
  test.each([
    '0.0.0',
    '1.2.3',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0+build.42',
    '1.0.0-rc.1+sha.abcdef'
  ])('accepts SemVer 2.0.0 value %s', (version) => {
    expect(isValidSemver(version)).toBe(true)
  })

  test.each([
    '',
    '1',
    '1.2',
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-',
    '1.2.3+bad space'
  ])('rejects non-semver value %s', (version) => {
    expect(isValidSemver(version)).toBe(false)
  })

  test('orders major, minor and patch numerically', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1)
    expect(compareSemver('2.1.0', '2.0.9')).toBe(1)
    expect(compareSemver('2.1.10', '2.1.9')).toBe(1)
    expect(compareSemver('2.1.10', '2.1.10')).toBe(0)
  })

  test('orders prereleases by SemVer precedence and ignores build metadata', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0'
    ]

    for (let index = 0; index < ordered.length - 1; index += 1) {
      expect(compareSemver(ordered[index]!, ordered[index + 1]!)).toBe(-1)
    }
    expect(compareSemver('1.0.0+one', '1.0.0+two')).toBe(0)
  })
})
