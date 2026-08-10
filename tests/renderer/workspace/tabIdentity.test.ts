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

  test('images dedupe by course and relative path', () => {
    const image = descriptorFor('image', {
      courseId: 'c1',
      relPath: 'figures/diagram.png'
    })
    const duplicate = descriptorFor('image', {
      courseId: 'c1',
      relPath: 'figures/diagram.png'
    })

    expect(tabPanelId(image)).toBe('image:c1:figures/diagram.png')
    expect(tabPanelId(image)).toBe(tabPanelId(duplicate))
    expect(tabPanelId(image)).not.toBe(
      tabPanelId(
        descriptorFor('image', {
          courseId: 'c2',
          relPath: 'figures/diagram.png'
        })
      )
    )
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

  test('[P2] group-chat is a singleton per course', () => {
    expect(
      tabPanelId(
        descriptorFor('group-chat', { courseId: 'c1', groupId: 'g1' })
      )
    ).toBe('group-chat:c1')
    expect(
      tabPanelId(
        descriptorFor('group-chat', { courseId: 'c1', groupId: 'g1' })
      )
    ).toBe(
      tabPanelId(
        descriptorFor('group-chat', { courseId: 'c1', groupId: 'g2' })
      )
    )
    expect(
      tabPanelId(descriptorFor('group-chat', { courseId: 'c1' }))
    ).not.toBe(tabPanelId(descriptorFor('group-chat', { courseId: 'c2' })))
    expect(tabPanelId(descriptorFor('group-chat', { courseId: null }))).toBe(
      'group-chat:unassigned'
    )
  })

  test('group-chat identity ignores its requested view', () => {
    const chat = descriptorFor('group-chat', {
      courseId: 'c1',
      groupId: 'g1',
      view: 'chat'
    })
    const whiteboard = descriptorFor('group-chat', {
      courseId: 'c1',
      groupId: 'g1',
      view: 'whiteboard'
    })

    expect(tabPanelId(chat)).toBe(tabPanelId(whiteboard))
  })

  test('personal whiteboards are keyed by course and board', () => {
    const board = descriptorFor('whiteboard', {
      courseId: 'c1',
      boardId: 'b1'
    })

    expect(tabPanelId(board)).toBe('whiteboard:c1:b1')
    expect(tabPanelId(board)).not.toBe(
      tabPanelId(
        descriptorFor('whiteboard', { courseId: 'c1', boardId: 'b2' })
      )
    )
  })

  test('[P2] a group id never collides with a course-scoped chat id', () => {
    expect(
      tabPanelId(
        descriptorFor('group-chat', { courseId: 'c1', groupId: 'c1' })
      )
    ).not.toBe(tabPanelId(descriptorFor('chat', { courseId: 'c1' })))
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
        descriptorFor('image', { courseId: 'c', relPath: 'figure.png' })
      )
    ).toBe(true)
    expect(
      isTabDescriptor(
        descriptorFor('browser', { tabId: 't', initialUrl: 'https://x.dev' })
      )
    ).toBe(true)
    expect(isTabDescriptor(descriptorFor('chat', { courseId: 'c' }))).toBe(true)
    expect(isTabDescriptor(descriptorFor('board', {}))).toBe(true)
    expect(
      isTabDescriptor(
        descriptorFor('whiteboard', { courseId: 'c', boardId: 'b1' })
      )
    ).toBe(true)
    expect(
      isTabDescriptor(
        descriptorFor('group-chat', { courseId: 'c', groupId: 'g1' })
      )
    ).toBe(true)
    expect(
      isTabDescriptor(
        descriptorFor('group-chat', {
          courseId: 'c',
          groupId: 'g1',
          view: 'whiteboard'
        })
      )
    ).toBe(true)
    expect(isTabDescriptor(descriptorFor('group-chat', { courseId: null }))).toBe(
      true
    )
  })

  test('rejects unknown kinds and malformed payloads', () => {
    expect(isTabDescriptor({ kind: 'terminal', payload: {} })).toBe(false)
    expect(isTabDescriptor({ kind: 'pdf', payload: { courseId: 'c' } })).toBe(false)
    expect(isTabDescriptor({ kind: 'pdf', payload: null })).toBe(false)
    expect(isTabDescriptor({ kind: 'chat', payload: { courseId: '' } })).toBe(false)
    expect(isTabDescriptor(null)).toBe(false)
    expect(isTabDescriptor('pdf')).toBe(false)
  })

  test('[P2] rejects legacy or malformed group-chat payloads', () => {
    // Legacy persisted descriptors lack courseId and are dropped on hydration.
    expect(isTabDescriptor({ kind: 'group-chat', payload: {} })).toBe(false)
    expect(
      isTabDescriptor({ kind: 'group-chat', payload: { groupId: '' } })
    ).toBe(false)
    expect(
      isTabDescriptor({ kind: 'group-chat', payload: { courseId: 'c1' } })
    ).toBe(true)
    expect(
      isTabDescriptor({
        kind: 'group-chat',
        payload: { courseId: 'c1', groupId: '' }
      })
    ).toBe(false)
    expect(
      isTabDescriptor({
        kind: 'group-chat',
        payload: { courseId: 'c1', view: 'files' }
      })
    ).toBe(false)
  })
})

describe('tabTitle', () => {
  test('derives titles from payloads', () => {
    expect(tabTitle(pdfTab)).toBe('intro.pdf')
    expect(
      tabTitle(
        descriptorFor('image', {
          courseId: 'c',
          relPath: 'figures/diagram.final.png'
        })
      )
    ).toBe('diagram.final.png')
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
    expect(
      tabTitle(
        descriptorFor('whiteboard', { courseId: 'c', boardId: 'b1' })
      )
    ).toBe('화이트보드')
  })

  test('[P2] group-chat falls back to a generic title', () => {
    // This module is pure, so it cannot read the group name out of the local
    // cache; GroupChatTab renames the panel once `groupChat:open` resolves.
    expect(
      tabTitle(
        descriptorFor('group-chat', { courseId: 'c1', groupId: 'g1' })
      )
    ).toBe('그룹 채팅')
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
