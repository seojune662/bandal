import { describe, expect, test } from 'vitest'
import {
  IPC_CHANNELS,
  type IpcRequest,
  type IpcResponse
} from '../../../src/shared/ipc/contract'
import type { WorkflowPackSummary } from '../../../src/shared/types/workflowPack'
import { BUILTIN_PACKS } from '../../../src/shared/workflowPacks/builtins'

describe('workflow pack IPC contract', () => {
  test('lists all four pack channels in the runtime witness', () => {
    expect(IPC_CHANNELS).toEqual(
      expect.arrayContaining([
        'packs:list',
        'packs:importText',
        'packs:remove',
        'packs:setEnabled'
      ])
    )
  })

  test('keeps request and response shapes tied to WorkflowPack', () => {
    const listRequest: IpcRequest<'packs:list'> = {}
    const listResponse: IpcResponse<'packs:list'> = {
      packs: [
        {
          pack: BUILTIN_PACKS[0]!,
          source: 'builtin',
          enabled: true,
          approvedAt: null
        } satisfies WorkflowPackSummary
      ]
    }
    const importRequest: IpcRequest<'packs:importText'> = { json: '{}' }
    const removeRequest: IpcRequest<'packs:remove'> = { id: 'custom:one' }
    const enabledRequest: IpcRequest<'packs:setEnabled'> = {
      id: 'custom:one',
      enabled: false
    }

    expect(listRequest).toEqual({})
    expect(listResponse.packs[0]?.pack.id).toBe('summary')
    expect(importRequest.json).toBe('{}')
    expect(removeRequest.id).toBe('custom:one')
    expect(enabledRequest.enabled).toBe(false)
  })

  test('allows installed packs and follow-up runs through the study channels', () => {
    const request: IpcRequest<'study:run'> = {
      courseId: 'course-1',
      tool: 'custom:vocab-chain',
      relPath: '영어 학습/기사/다음 기사.md',
      followUpOf: 'custom:vocab-chain'
    }
    const response: IpcResponse<'study:tools'> = {
      tools: [
        {
          id: 'custom:vocab-chain',
          label: '나의 단어 사슬',
          description: '기사에서 어려운 단어를 모아요.',
          worksOnCourse: false,
          source: 'user',
          enabled: true,
          usesWeb: true,
          outputs: { dir: '영어 학습', primary: '단어 사슬 리포트' },
          followUp: {
            label: '이 기사로 이어가기',
            recipe: '다음 회차를 진행하라.'
          }
        }
      ]
    }

    expect(request.followUpOf).toBe(request.tool)
    expect(response.tools[0]?.source).toBe('user')
    expect(response.tools[0]?.followUp?.label).toBe('이 기사로 이어가기')
  })
})
