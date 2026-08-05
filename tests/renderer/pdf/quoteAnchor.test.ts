import { describe, expect, test } from 'vitest'
import {
  ANCHOR_CONTEXT_MAX,
  buildAnchor,
  findAnchor,
  isAnchorStale,
  normalizeWhitespace
} from '../../../src/renderer/src/features/pdf/lib/quoteAnchor'

const pageText =
  'Operating systems manage hardware resources. ' +
  'A process is a program in execution, owning its own address space. ' +
  'Threads share the address space of their parent process.'

describe('buildAnchor', () => {
  test('extracts quote with prefix/suffix context windows', () => {
    // Arrange
    const start = pageText.indexOf('A process is')
    const end = start + 'A process is a program in execution'.length

    // Act
    const anchor = buildAnchor(pageText, start, end)

    // Assert
    expect(anchor).not.toBeNull()
    expect(anchor?.quote).toBe('A process is a program in execution')
    expect(anchor?.prefix.endsWith('hardware resources. ')).toBe(true)
    expect(anchor?.suffix.startsWith(', owning its own')).toBe(true)
  })

  test('caps prefix and suffix at ANCHOR_CONTEXT_MAX characters', () => {
    const start = 100
    const anchor = buildAnchor(pageText, start, start + 10)

    expect(anchor?.prefix.length).toBeLessThanOrEqual(ANCHOR_CONTEXT_MAX)
    expect(anchor?.suffix.length).toBeLessThanOrEqual(ANCHOR_CONTEXT_MAX)
    expect(anchor?.prefix).toBe(pageText.slice(start - ANCHOR_CONTEXT_MAX, start))
  })

  test('quote at the start of the page gets a short prefix', () => {
    const anchor = buildAnchor(pageText, 0, 9)

    expect(anchor?.quote).toBe('Operating')
    expect(anchor?.prefix).toBe('')
  })

  test('returns null for empty or whitespace-only ranges', () => {
    expect(buildAnchor(pageText, 5, 5)).toBeNull()
    expect(buildAnchor('a   b', 1, 4)).toBeNull()
  })

  test('clamps out-of-bounds offsets instead of throwing', () => {
    const anchor = buildAnchor('short', -5, 999)

    expect(anchor?.quote).toBe('short')
    expect(anchor?.prefix).toBe('')
    expect(anchor?.suffix).toBe('')
  })
})

describe('findAnchor', () => {
  test('finds a unique quote with a perfect context score', () => {
    const anchor = buildAnchor(pageText, 46, 46 + 9)

    const match = findAnchor(pageText, anchor!)

    expect(match).not.toBeNull()
    expect(match?.score).toBe(1)
  })

  test('disambiguates repeated quotes using surrounding context', () => {
    // Arrange: "address space" appears twice — anchor built on the second.
    const second = pageText.lastIndexOf('address space')
    const anchor = buildAnchor(pageText, second, second + 'address space'.length)

    // Act
    const match = findAnchor(pageText, anchor!)

    // Assert: normalized index must point at the later occurrence.
    const normalized = normalizeWhitespace(pageText)
    expect(match?.index).toBe(normalized.lastIndexOf('address space'))
    expect(match?.score).toBe(1)
  })

  test('is tolerant of whitespace differences from text re-extraction', () => {
    const anchor = buildAnchor(pageText, 46, 46 + 33)
    const reflowed = pageText.replace(/ /g, '\n  ')

    expect(findAnchor(reflowed, anchor!)).not.toBeNull()
  })

  test('returns null when the quote is gone', () => {
    const anchor = buildAnchor(pageText, 46, 46 + 9)

    expect(findAnchor('completely different text', anchor!)).toBeNull()
  })
})

describe('isAnchorStale', () => {
  const anchor = buildAnchor(pageText, 46, 46 + 33)!

  test('unchanged page text is not stale', () => {
    expect(isAnchorStale(pageText, anchor)).toBe(false)
  })

  test('unknown page text (not yet extracted) is never stale', () => {
    expect(isAnchorStale(null, anchor)).toBe(false)
  })

  test('quote removed from the page is stale', () => {
    expect(isAnchorStale('rewritten page about something else', anchor)).toBe(true)
  })

  test('quote found in a completely different context is stale', () => {
    const moved = `zzz qqq ${anchor.quote} kkk vvv`

    expect(isAnchorStale(moved, anchor)).toBe(true)
  })

  test('quote with mostly-intact context is not stale', () => {
    // Small edit far from the quote: context around it survives.
    const edited = pageText.replace('Operating systems', 'Modern kernels')

    expect(isAnchorStale(edited, anchor)).toBe(false)
  })

  test('context-free anchor is not stale as long as the quote exists', () => {
    const bare = { quote: 'shared text', prefix: '', suffix: '' }

    expect(isAnchorStale('the shared text remains', bare)).toBe(false)
  })
})
