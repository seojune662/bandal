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
})
