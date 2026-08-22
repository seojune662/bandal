import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Course } from '../../../src/shared/types/course'
import {
  AgentAccessPanel,
  AgentToolGrantRevokeButton,
  loadAgentBrowserAccess,
  loadAgentToolGrants,
  resetAgentToolGrantsForTests,
} from '../../../src/renderer/src/features/settings/AgentAccessPanel'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

const course: Course = {
  id: 'course-1',
  name: '자료구조',
  slug: 'data-structures',
  color: 'blue',
  folderPath: '/courses/data-structures',
  source: 'managed',
  missing: false,
  archived: false,
  groupId: null,
  sortOrder: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

afterEach(() => {
  setIpcAdapter(null)
  resetAgentToolGrantsForTests()
})

describe('AgentAccessPanel tool grants', () => {
  test('renders two grants and revokes one through chat:revokeGrant', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'courses:list') return [course]
      if (channel === 'chat:grants') {
        return {
          grants: [
            {
              id: 'grant-1',
              rule: 'materials.read',
              createdAt: '2026-08-20T10:00:00.000Z'
            },
            {
              id: 'grant-2',
              rule: 'board.createTask',
              createdAt: '2026-08-21T10:00:00.000Z'
            }
          ]
        }
      }
      if (channel === 'chat:revokeGrant') return { ok: true }
      throw new Error(`Unexpected IPC channel: ${channel}`)
    })
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    await loadAgentToolGrants()
    const html = renderToStaticMarkup(<AgentAccessPanel />)

    expect(html).toContain('AI 도구 허용 규칙')
    expect(html).toContain('과목 전체에 적용되는 영구 규칙입니다.')
    expect(html).toContain('materials.read')
    expect(html).toContain('board.createTask')
    expect(html.match(/>취소<\/button>/g)).toHaveLength(2)

    const revokeButton = AgentToolGrantRevokeButton({
      grantId: 'grant-2',
      disabled: false,
      label: '취소'
    })
    revokeButton.props.onClick()

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('chat:revokeGrant', { id: 'grant-2' })
    })
  })

  test('groups live grants by host and renders a human-readable audit timeline', async () => {
    setIpcAdapter({
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'browserAgent:grants') {
          return {
            grants: [
              {
                id: 'site-read',
                courseId: 'course-1',
                origin: 'https://shine.snu.ac.kr',
                capability: 'read',
                createdAt: '2026-08-20T00:00:00.000Z',
                expiresAt: '2099-09-19T00:00:00.000Z',
                revokedAt: null,
                lastUsedAt: '2026-08-21T06:12:00.000Z'
              },
              {
                id: 'site-interact',
                courseId: 'course-1',
                origin: 'https://shine.snu.ac.kr',
                capability: 'interact',
                createdAt: '2026-08-20T00:00:00.000Z',
                expiresAt: '2099-09-19T00:00:00.000Z',
                revokedAt: null,
                lastUsedAt: null
              },
              {
                id: 'portal-read',
                courseId: 'course-1',
                origin: 'https://my.snu.ac.kr',
                capability: 'read',
                createdAt: '2026-08-20T00:00:00.000Z',
                expiresAt: '2099-09-19T00:00:00.000Z',
                revokedAt: null,
                lastUsedAt: null
              }
            ]
          }
        }
        if (channel === 'browserAgent:auditTail') {
          return {
            entries: [
              {
                id: 'read-entry',
                courseId: 'course-1',
                action: 'read',
                url: 'https://my.snu.ac.kr/courses/1',
                detail: '본문 4027자',
                createdAt: '2026-08-21T06:12:00.000Z'
              },
              {
                id: 'tabs-entry',
                courseId: 'course-1',
                action: 'snapshot',
                url: '',
                detail: '탭 1개를 확인했어요',
                createdAt: '2026-08-21T06:10:00.000Z'
              },
              {
                id: 'click-entry',
                courseId: 'course-1',
                action: 'navigate',
                url: 'https://shine.snu.ac.kr/course/view',
                detail: 'click input ""',
                createdAt: '2026-08-20T04:00:00.000Z'
              }
            ]
          }
        }
        throw new Error(`Unexpected IPC channel: ${channel}`)
      }),
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)

    await loadAgentBrowserAccess()
    const html = renderToStaticMarkup(<AgentAccessPanel />)

    expect(html.match(/class="settings-agent-host"/g)).toHaveLength(2)
    expect(html).toContain('<strong>shine.snu.ac.kr</strong>')
    expect(html).toContain('>읽기</span>')
    expect(html).toContain('>조작</span>')
    expect(html).toContain('my.snu.ac.kr 본문을 읽었습니다 (4,027자)')
    expect(html).toContain('탭 1개를 확인했습니다')
    expect(html).toContain('shine.snu.ac.kr에서 input을 눌렀습니다')
    expect(html).toContain('class="settings-agent-timeline__path">/courses/1</span>')
    expect(html.match(/class="settings-agent-timeline__day"/g)).toHaveLength(2)
  })
})
