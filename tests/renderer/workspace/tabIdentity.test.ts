import { describe, expect, test } from 'vitest'
import type { TabDescriptor } from '../../../src/shared/tabs'
import {
  descriptorFor,
  isTabDescriptor,
  looksLikeUrl,
  normalizeUrl,
  tabPanelId,
  tabTitle
} from '../../../src/renderer/src/features/workspace/tabIdentity'

const pdfTab: TabDescriptor = descriptorFor('pdf', {
  courseId: 'c1',
  relPath: 'week1/intro.pdf'
})

describe('tabPanelId', () => {
  test('same pdf payload produces the same panel id (dedupe key)', () => {
    // Arrange
    const duplicate = descriptorFor('pdf', {
      courseId: 'c1',
      relPath: 'week1/intro.pdf'
    })

    // Act / Assert
    expect(tabPanelId(pdfTab)).toBe(tabPanelId(duplicate))
    expect(tabPanelId(pdfTab)).toBe('pdf:c1:week1/intro.pdf')
  })

  test('different files produce different ids', () => {
    const other = descriptorFor('pdf', { courseId: 'c1', relPath: 'b.pdf' })
    expect(tabPanelId(pdfTab)).not.toBe(tabPanelId(other))
  })

  test('chat is singleton per course, board is a global singleton', () => {
    expect(tabPanelId(descriptorFor('chat', { courseId: 'c1' }))).toBe('chat:c1')
    expect(tabPanelId(descriptorFor('board', {}))).toBe('board')
  })

  test('browser tabs key off their stable tabId', () => {
    const a = descriptorFor('browser', { tabId: 't1', initialUrl: 'https://a.com' })
    const b = descriptorFor('browser', { tabId: 't2', initialUrl: 'https://a.com' })
    expect(tabPanelId(a)).not.toBe(tabPanelId(b))
  })

  test('[P2] group-chat is a singleton per REMOTE group id', () => {
    // The id shape alone gives per-group dedupe — no `singleton` entry needed,
    // which is fortunate since that field only understands courses.
    expect(tabPanelId(descriptorFor('group-chat', { groupId: 'g1' }))).toBe(
      'group-chat:g1'
    )
    expect(
      tabPanelId(descriptorFor('group-chat', { groupId: 'g1' }))
    ).toBe(tabPanelId(descriptorFor('group-chat', { groupId: 'g1' })))
    expect(
      tabPanelId(descriptorFor('group-chat', { groupId: 'g1' }))
    ).not.toBe(tabPanelId(descriptorFor('group-chat', { groupId: 'g2' })))
  })

  test('[P2] a group id never collides with a course-scoped chat id', () => {
    expect(tabPanelId(descriptorFor('group-chat', { groupId: 'c1' }))).not.toBe(
      tabPanelId(descriptorFor('chat', { courseId: 'c1' }))
    )
  })
})

describe('isTabDescriptor', () => {
  test('accepts every valid kind', () => {
    expect(isTabDescriptor(pdfTab)).toBe(true)
    expect(
      isTabDescriptor(descriptorFor('note', { courseId: 'c', relPath: 'n.md' }))
    ).toBe(true)
    expect(
      isTabDescriptor(
        descriptorFor('browser', { tabId: 't', initialUrl: 'https://x.dev' })
      )
    ).toBe(true)
    expect(isTabDescriptor(descriptorFor('chat', { courseId: 'c' }))).toBe(true)
    expect(isTabDescriptor(descriptorFor('board', {}))).toBe(true)
    expect(
      isTabDescriptor(descriptorFor('group-chat', { groupId: 'g1' }))
    ).toBe(true)
  })

  test('rejects unknown kinds and malformed payloads', () => {
    expect(isTabDescriptor({ kind: 'terminal', payload: {} })).toBe(false)
    expect(isTabDescriptor({ kind: 'pdf', payload: { courseId: 'c' } })).toBe(false)
    expect(isTabDescriptor({ kind: 'pdf', payload: null })).toBe(false)
    expect(isTabDescriptor({ kind: 'chat', payload: { courseId: '' } })).toBe(false)
    expect(isTabDescriptor(null)).toBe(false)
    expect(isTabDescriptor('pdf')).toBe(false)
  })

  test('[P2] rejects a group-chat tab with no groupId', () => {
    // A persisted layout is untrusted input; a malformed group tab must be
    // dropped on hydration rather than mounting a panel with no group.
    expect(isTabDescriptor({ kind: 'group-chat', payload: {} })).toBe(false)
    expect(
      isTabDescriptor({ kind: 'group-chat', payload: { groupId: '' } })
    ).toBe(false)
    expect(
      isTabDescriptor({ kind: 'group-chat', payload: { courseId: 'c1' } })
    ).toBe(false)
  })
})

describe('tabTitle', () => {
  test('derives titles from payloads', () => {
    expect(tabTitle(pdfTab)).toBe('intro.pdf')
    expect(
      tabTitle(descriptorFor('note', { courseId: 'c', relPath: 'a/메모.md' }))
    ).toBe('메모')
    expect(
      tabTitle(
        descriptorFor('browser', { tabId: 't', initialUrl: 'https://ko.wikipedia.org/wiki/x' })
      )
    ).toBe('ko.wikipedia.org')
    expect(
      tabTitle(descriptorFor('browser', { tabId: 't', initialUrl: 'not a url' }))
    ).toBe('브라우저')
    expect(tabTitle(descriptorFor('board', {}))).toBe('학업 보드')
  })

  test('[P2] group-chat falls back to a generic title', () => {
    // This module is pure, so it cannot read the group name out of the local
    // cache; GroupChatTab renames the panel once `groupChat:open` resolves.
    expect(tabTitle(descriptorFor('group-chat', { groupId: 'g1' }))).toBe(
      '그룹 채팅'
    )
  })
})

describe('omnibox url detection', () => {
  test('recognizes urls with and without scheme', () => {
    expect(looksLikeUrl('https://example.com/path')).toBe(true)
    expect(looksLikeUrl('example.com')).toBe(true)
    expect(looksLikeUrl('sub.example.co.kr/page?q=1')).toBe(true)
    expect(looksLikeUrl('localhost:3000')).toBe(false)
    expect(looksLikeUrl('새 필기')).toBe(false)
    expect(looksLikeUrl('two words.com')).toBe(false)
    expect(looksLikeUrl('')).toBe(false)
  })

  test('normalizes bare domains to https', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('  https://a.dev ')).toBe('https://a.dev')
  })
})
