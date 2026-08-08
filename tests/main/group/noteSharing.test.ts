import { describe, expect, test, vi } from 'vitest'
import type { NotesRepo } from '../../../src/main/features/notes'
import type { GroupService } from '../../../src/main/features/group/GroupService'
import {
  createGroupNoteSharingService,
  formatSharedNoteMessage,
  GROUP_MESSAGE_MAX_CHARS,
  sanitizeSharedNoteTitle,
  SharedNoteTooLongError,
  type GroupNoteSharingService
} from '../../../src/main/features/group/noteSharing'

const NOW = new Date('2026-08-09T03:04:05.000Z')

interface Harness {
  service: GroupNoteSharingService
  send: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  setMarkdown(markdown: string): void
}

function harness(): Harness {
  let markdown = '# 다익스트라\n\n최단 경로 정리'
  const send = vi.fn()
  const create = vi.fn(() => ({
    courseId: 'course-2',
    relPath: '시험 정리-2.md'
  }))
  const write = vi.fn(() => ({ mtime: 1 }))
  const notesRepo = {
    read: (input: { courseId: string; relPath: string }) => ({
      ...input,
      markdown,
      mtime: 1
    }),
    create,
    write
  } as unknown as Pick<NotesRepo, 'read' | 'create' | 'write'>
  const groupService = {
    getAuthState: () => ({
      phase: 'signed-in' as const,
      profile: {
        id: 'user-1',
        nickname: '민지',
        avatarColor: 'blue',
        avatarEmoji: '🌙'
      },
      online: true,
      errorCode: null
    }),
    listGroups: () => [
      {
        id: 'group-1',
        name: '알고리즘 A조',
        color: 'blue',
        courseId: 'course-1',
        memberCount: 4,
        unread: 0,
        lastMsgAt: null,
        joinedAt: NOW.toISOString()
      }
    ],
    send
  } as unknown as Pick<GroupService, 'getAuthState' | 'listGroups' | 'send'>

  return {
    service: createGroupNoteSharingService({
      notesRepo,
      getGroupService: () => groupService,
      getCourseName: () => '알고리즘',
      now: () => NOW
    }),
    send,
    create,
    write,
    setMarkdown(next) {
      markdown = next
    }
  }
}

function message(markdown = '본문', title = '시험 정리'): string {
  return formatSharedNoteMessage({
    title,
    courseName: '알고리즘',
    groupName: '알고리즘 A조',
    sharedBy: '민지',
    sharedAt: NOW.toISOString(),
    markdown
  })
}

describe('shareNote', () => {
  test('reads through notesRepo and reuses the group send/outbox entry point', () => {
    const test1 = harness()

    expect(
      test1.service.shareNote({
        groupId: 'group-1',
        courseId: 'course-1',
        relPath: '정리/시험 정리.md'
      })
    ).toEqual({ ok: true })

    expect(test1.send).toHaveBeenCalledTimes(1)
    const [groupId, body] = test1.send.mock.calls[0] as [string, string]
    expect(groupId).toBe('group-1')
    expect(body).toContain('📒 반달 노트 공유\n제목: 시험 정리')
    expect(body).toContain('원래 과목: 알고리즘')
    expect(body).toContain('그룹: 알고리즘 A조')
    expect(body).toContain('공유한 사람: 민지')
    expect(body).toContain('# 다익스트라')
  })

  test('accepts a message that is exactly 4000 Unicode characters', () => {
    const test1 = harness()
    const empty = message('')
    const headerLength = Array.from(empty).length
    test1.setMarkdown('가'.repeat(GROUP_MESSAGE_MAX_CHARS - headerLength))

    test1.service.shareNote({
      groupId: 'group-1',
      courseId: 'course-1',
      relPath: '시험 정리.md'
    })

    const body = test1.send.mock.calls[0]?.[1] as string
    expect(Array.from(body)).toHaveLength(GROUP_MESSAGE_MAX_CHARS)
  })

  test('rejects an oversized note before anything enters the outbox', () => {
    const test1 = harness()
    test1.setMarkdown('가'.repeat(GROUP_MESSAGE_MAX_CHARS))

    expect(() =>
      test1.service.shareNote({
        groupId: 'group-1',
        courseId: 'course-1',
        relPath: '시험 정리.md'
      })
    ).toThrow(SharedNoteTooLongError)
    expect(test1.send).not.toHaveBeenCalled()
  })
})

describe('saveSharedNote', () => {
  test('creates at the course root, preserves collision naming, and writes provenance', () => {
    const test1 = harness()
    const body = message('# 핵심\n\n내용')

    const saved = test1.service.saveSharedNote({
      courseId: 'course-2',
      title: '시험 정리',
      markdown: body
    })

    expect(test1.create).toHaveBeenCalledWith({
      courseId: 'course-2',
      dirRelPath: '',
      title: '시험 정리'
    })
    expect(saved).toEqual({ relPath: '시험 정리-2.md' })
    const written = test1.write.mock.calls[0]?.[0] as {
      courseId: string
      relPath: string
      markdown: string
    }
    expect(written.courseId).toBe('course-2')
    expect(written.relPath).toBe('시험 정리-2.md')
    expect(written.markdown).toContain('> 반달에서 받은 공유 노트')
    expect(written.markdown).toContain('> 그룹: 알고리즘 A조')
    expect(written.markdown).toContain('> 공유한 사람: 민지')
    expect(written.markdown).toContain(`> 공유한 날짜: ${NOW.toISOString()}`)
    expect(written.markdown).toContain('# 핵심\n\n내용')
  })

  test.each(['../탈출', '폴더/탈출', '폴더\\탈출', '위험\u0000제목', '위험\n제목'])(
    'rejects a separator/control title: %s',
    (title) => {
      const test1 = harness()
      expect(() =>
        test1.service.saveSharedNote({
          courseId: 'course-2',
          title,
          markdown: message('본문', title)
        })
      ).toThrow(/path separator or control character/)
      expect(test1.create).not.toHaveBeenCalled()
    }
  )

  test('sanitizes other filesystem-hostile characters', () => {
    expect(sanitizeSharedNoteTitle('  시험:*? 정리  ')).toBe('시험 정리')
  })

  test('refuses a title that does not match the embedded shared-note title', () => {
    const test1 = harness()
    expect(() =>
      test1.service.saveSharedNote({
        courseId: 'course-2',
        title: '바꾼 제목',
        markdown: message('본문', '원래 제목')
      })
    ).toThrow(/does not match/)
    expect(test1.create).not.toHaveBeenCalled()
  })
})
