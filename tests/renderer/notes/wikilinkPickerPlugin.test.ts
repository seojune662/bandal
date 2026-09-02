import { describe, expect, test } from 'vitest'
import {
  isWikilinkTrigger,
  wikilinkQueryAwaitsClose,
  wikilinkQueryEnds,
  wikilinkTargetFor
} from '../../../src/renderer/src/features/notes/wikilink/wikilinkPickerPlugin'
import { createWikilinkResolver } from '../../../src/shared/wikilink'

describe('isWikilinkTrigger', () => {
  test('opens on the second [ of [[', () => {
    expect(isWikilinkTrigger('[', '[')).toBe(true)
  })

  test('stays closed for a single [ or other text', () => {
    expect(isWikilinkTrigger('', '[')).toBe(false)
    expect(isWikilinkTrigger(' ', '[')).toBe(false)
    expect(isWikilinkTrigger('[', 'a')).toBe(false)
  })
})

describe('wikilinkQueryEnds', () => {
  test('spaces, | and # are part of a target', () => {
    expect(wikilinkQueryEnds('강의 1')).toBe(false)
    expect(wikilinkQueryEnds('강의 1|별칭')).toBe(false)
    expect(wikilinkQueryEnds('강의 1#요약')).toBe(false)
  })

  test('a line break or a nested [ ends the query', () => {
    expect(wikilinkQueryEnds('강의\n')).toBe(true)
    expect(wikilinkQueryEnds('강의 [')).toBe(true)
  })

  test('a single trailing ] is the pending half of ]] and keeps the menu open', () => {
    expect(wikilinkQueryEnds('강의]')).toBe(false)
    expect(wikilinkQueryAwaitsClose('강의]')).toBe(true)
    expect(wikilinkQueryAwaitsClose('강의')).toBe(false)
  })

  test('a ] anywhere else ends the query', () => {
    expect(wikilinkQueryEnds('강의] 뒤')).toBe(true)
  })
})

describe('wikilinkTargetFor', () => {
  const files = [
    { relPath: 'notes/Chap1.md', name: 'Chap1.md', kind: 'note' as const },
    { relPath: 'Chap1.pdf', name: 'Chap1.pdf', kind: 'pdf' as const },
    { relPath: 'a/Dup.md', name: 'Dup.md', kind: 'note' as const },
    { relPath: 'b/Dup.md', name: 'Dup.md', kind: 'note' as const }
  ]
  const { resolve } = createWikilinkResolver(files)

  test('uses the bare stem for a note that resolves uniquely', () => {
    expect(wikilinkTargetFor(files[0]!, resolve)).toBe('Chap1')
  })

  test('keeps the extension for a non-note so it does not fall back to the note', () => {
    expect(wikilinkTargetFor(files[1]!, resolve)).toBe('Chap1.pdf')
  })

  test('falls back to the path (without .md) when the stem is ambiguous', () => {
    expect(wikilinkTargetFor(files[3]!, resolve)).toBe('b/Dup')
    expect(resolve('b/Dup')).toBe('b/Dup.md')
  })
})
