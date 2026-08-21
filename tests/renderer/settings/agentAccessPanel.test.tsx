import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Course } from '../../../src/shared/types/course'
import {
  AgentAccessPanel,
  AgentToolGrantRevokeButton,
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
})
