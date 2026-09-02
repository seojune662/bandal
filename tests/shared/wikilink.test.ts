import { describe, expect, test } from 'vitest'
import {
  WIKILINK_RE,
  createWikilinkResolver,
  formatWikilink,
  parseWikilink,
  resolveWikilinkTarget,
  wikilinkKey,
  wikilinkPattern
} from '../../src/shared/wikilink'

describe('parseWikilink / formatWikilink', () => {
  test.each([
    ['[[강의 1]]', { target: '강의 1', heading: null, alias: null, embed: false }],
    ['[[강의 1|별칭]]', { target: '강의 1', heading: null, alias: '별칭', embed: false }],
    ['[[강의 1#요약]]', { target: '강의 1', heading: '요약', alias: null, embed: false }],
    [
      '[[강의 1#요약|별칭]]',
      { target: '강의 1', heading: '요약', alias: '별칭', embed: false }
    ],
    ['![[그림.png]]', { target: '그림.png', heading: null, alias: null, embed: true }],
    [
      '[[notes/Chap1.md|ch1]]',
      { target: 'notes/Chap1.md', heading: null, alias: 'ch1', embed: false }
    ]
  ])('parses %s and formats it back byte-for-byte', (text, parts) => {
    expect(parseWikilink(text)).toEqual(parts)
    expect(formatWikilink(parts)).toBe(text)
  })

  test('rejects text that is not exactly one wikilink', () => {
    expect(parseWikilink('[[]]')).toBeNull()
    expect(parseWikilink('[[a]] tail')).toBeNull()
    expect(parseWikilink('[link](url)')).toBeNull()
    expect(parseWikilink('[[a\nb]]')).toBeNull()
  })

  test('the global pattern finds every link in a document', () => {
    const doc = '본문 [[강의 1]] 과 [[강의 1|별칭]] 그리고 [[강의 1#요약]] 및 ![[그림.png]]'
    expect([...doc.matchAll(WIKILINK_RE)].map((match) => match[0])).toEqual([
      '[[강의 1]]',
      '[[강의 1|별칭]]',
      '[[강의 1#요약]]',
      '![[그림.png]]'
    ])
    expect(wikilinkPattern().global).toBe(true)
    expect(WIKILINK_RE.global).toBe(true)
  })
})

describe('wikilinkKey', () => {
  test('folds case, whitespace, NFC/NFD, and a trailing .md', () => {
    const nfd = '강의 1.md'.normalize('NFD')
    expect(wikilinkKey(nfd)).toBe('강의 1'.normalize('NFC'))
    expect(wikilinkKey('  Chap1.MD ')).toBe('chap1')
    expect(wikilinkKey('Chap1.pdf')).toBe('chap1.pdf')
  })
})

describe('resolveWikilinkTarget', () => {
  const files = [
    { relPath: 'Chap1.pdf' },
    { relPath: 'notes/Chap1.md' },
    { relPath: 'a/b/Deep.md' },
    { relPath: 'a/Deep.md' },
    { relPath: '자료/강의 1.md'.normalize('NFD') },
    { relPath: 'Only.pdf' }
  ]

  test('matches case-insensitively and treats .md as optional', () => {
    expect(resolveWikilinkTarget('chap1', files)).toBe('notes/Chap1.md')
    expect(resolveWikilinkTarget('CHAP1.md', files)).toBe('notes/Chap1.md')
    expect(resolveWikilinkTarget('notes/Chap1', files)).toBe('notes/Chap1.md')
  })

  test('an NFC target finds an NFD-spelled file and keeps its spelling', () => {
    const resolved = resolveWikilinkTarget('강의 1'.normalize('NFC'), files)
    expect(resolved).toBe('자료/강의 1.md'.normalize('NFD'))
  })

  test('prefers .md over .pdf on a stem tie, and the explicit extension wins', () => {
    expect(resolveWikilinkTarget('Chap1', files)).toBe('notes/Chap1.md')
    expect(resolveWikilinkTarget('Chap1.pdf', files)).toBe('Chap1.pdf')
  })

  test('falls back to other kinds when no note matches the stem', () => {
    expect(resolveWikilinkTarget('Only', files)).toBe('Only.pdf')
  })

  test('picks the shortest path on a tie', () => {
    expect(resolveWikilinkTarget('Deep', files)).toBe('a/Deep.md')
  })

  test('returns null when nothing matches', () => {
    expect(resolveWikilinkTarget('Missing', files)).toBeNull()
    expect(resolveWikilinkTarget('   ', files)).toBeNull()
    expect(createWikilinkResolver([]).resolve('Chap1')).toBeNull()
  })
})
