import { describe, expect, test } from 'vitest'
import {
  canOpenMentionAt,
  mentionHref,
  mentionQueryEnds
} from '../../../src/renderer/src/features/notes/mentionMenuPlugin'
import { parseMaterialLinkHref } from '../../../src/renderer/src/features/notes/materialLinkNavigation'

describe('mentionHref', () => {
  test('round-trips through the renderer link parser', () => {
    const relPath = '자료/1주차 강의 (복사본)!.pdf'
    const parsed = parseMaterialLinkHref(mentionHref(relPath))
    expect(parsed).toEqual({ relPath, page: null })
  })

  test('escapes markdown-breaking RFC 3986 characters', () => {
    expect(mentionHref("a'b(c)d*e!.md")).not.toMatch(/[!'()*]/)
  })
})

describe('canOpenMentionAt', () => {
  test('opens at paragraph start and after whitespace', () => {
    expect(canOpenMentionAt('')).toBe(true)
    expect(canOpenMentionAt(' ')).toBe(true)
    expect(canOpenMentionAt(' ')).toBe(true)
  })

  test('stays closed mid-word so emails are untouched', () => {
    expect(canOpenMentionAt('e')).toBe(false)
    expect(canOpenMentionAt('.')).toBe(false)
  })
})

describe('mentionQueryEnds', () => {
  test('a space ends the mention query', () => {
    expect(mentionQueryEnds('강의')).toBe(false)
    expect(mentionQueryEnds('강의 ')).toBe(true)
  })
})
