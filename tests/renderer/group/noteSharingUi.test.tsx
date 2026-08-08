import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { MaterialNode } from '../../../src/shared/types/materials'
import { GroupComposer } from '../../../src/renderer/src/features/group/GroupComposer'
import { GroupMessageList } from '../../../src/renderer/src/features/group/GroupMessageList'
import { markdownNotes } from '../../../src/renderer/src/features/group/NoteSharePicker'
import { SharedNoteCard } from '../../../src/renderer/src/features/group/SharedNoteCard'
import {
  parseSharedNoteMessage,
  sharedNotePreview
} from '../../../src/renderer/src/features/group/sharedNoteMessage'

const BODY = [
  '📒 반달 노트 공유',
  '제목: 중간고사 정리',
  '원래 과목: 알고리즘',
  '그룹: 알고리즘 A조',
  '공유한 사람: 민지',
  '공유한 날짜: 2026-08-09T03:04:05.000Z',
  '--- 노트 내용 ---',
  '# 최단 경로',
  '',
  '다익스트라 핵심 내용'
].join('\n')

describe('shared-note message marker', () => {
  test('parses the readable marker and preserves the markdown payload', () => {
    expect(parseSharedNoteMessage(BODY)).toEqual({
      title: '중간고사 정리',
      courseName: '알고리즘',
      groupName: '알고리즘 A조',
      sharedBy: '민지',
      sharedAt: '2026-08-09T03:04:05.000Z',
      markdown: '# 최단 경로\n\n다익스트라 핵심 내용'
    })
  })

  test('leaves ordinary and malformed messages as ordinary chat text', () => {
    expect(parseSharedNoteMessage('그냥 채팅이에요')).toBeNull()
    expect(parseSharedNoteMessage('📒 반달 노트 공유\n제목만 있어요')).toBeNull()
  })

  test('makes a bounded one-line preview without silently changing saved content', () => {
    expect(sharedNotePreview('첫 줄\n\n둘째 줄', 8)).toBe('첫 줄 둘째 줄')
    expect(sharedNotePreview('가'.repeat(20), 5)).toBe('가가가가가…')
  })
})

describe('note picker and card', () => {
  test('flattens only markdown nodes from the existing materials tree', () => {
    const tree: MaterialNode[] = [
      {
        relPath: '정리',
        name: '정리',
        kind: 'dir',
        children: [
          { relPath: '정리/1주차.md', name: '1주차.md', kind: 'note' },
          { relPath: '정리/강의.pdf', name: '강의.pdf', kind: 'pdf' }
        ]
      },
      { relPath: '퀴즈.md', name: '퀴즈.md', kind: 'note' },
      { relPath: '외부.markdown', name: '외부.markdown', kind: 'note' }
    ]

    expect(markdownNotes(tree)).toEqual([
      { relPath: '정리/1주차.md', title: '1주차' },
      { relPath: '퀴즈.md', title: '퀴즈' }
    ])
  })

  test('renders a distinct card with title, preview, and save action', () => {
    const note = parseSharedNoteMessage(BODY)
    expect(note).not.toBeNull()
    if (note === null) return

    const html = renderToStaticMarkup(
      <SharedNoteCard note={note} messageBody={BODY} courseId="course-1" />
    )

    expect(html).toContain('group-note-card')
    expect(html).toContain('중간고사 정리')
    expect(html).toContain('다익스트라 핵심 내용')
    expect(html).toContain('내 자료로 저장')
  })

  test('shows the note-share entry next to the composer', () => {
    const html = renderToStaticMarkup(
      <GroupComposer
        value=""
        onChange={() => undefined}
        onSend={() => undefined}
        onShareNote={() => undefined}
        connection="live"
        cooldown={0}
      />
    )

    expect(html).toContain('group-composer__share')
    expect(html).toContain('노트 공유')
  })

  test('renders a marked chat message as a card instead of raw marker text', () => {
    const html = renderToStaticMarkup(
      <GroupMessageList
        messages={[
          {
            kind: 'committed',
            id: 'message-1',
            seq: 1,
            authorId: 'user-1',
            messageKind: 'text',
            body: BODY,
            createdAt: '2026-08-09T03:04:05.000Z',
            edited: false,
            deleted: false,
            authorNickname: '민지',
            authorColor: 'blue',
            authorEmoji: '🌙'
          }
        ]}
        pending={[]}
        members={[]}
        courseId="course-1"
        myUserId="user-2"
        blockedUserIds={new Set()}
        onRetry={() => undefined}
        onDelete={() => undefined}
        onReport={() => undefined}
      />
    )

    expect(html).toContain('group-note-card')
    expect(html).not.toContain('--- 노트 내용 ---')
  })
})
