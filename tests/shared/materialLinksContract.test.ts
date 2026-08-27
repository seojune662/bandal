import { describe, expect, test } from 'vitest'
import {
  IPC_CHANNELS,
  type IpcRequest,
  type IpcResponse
} from '../../src/shared/ipc/contract'
import type { TabDescriptor } from '../../src/shared/tabs'
import type {
  AgentActionTarget
} from '../../src/shared/types/agentTools'
import type { MaterialLinkRecord } from '../../src/shared/types/link'

const source: TabDescriptor = {
  kind: 'pdf',
  payload: { courseId: 'course-1', relPath: 'from.pdf' }
}
const target: TabDescriptor = {
  kind: 'note',
  payload: { courseId: 'course-1', relPath: 'to.md' }
}

const record: MaterialLinkRecord = {
  id: 'link-1',
  courseId: 'course-1',
  source,
  target,
  label: '',
  createdAt: '2026-08-27T00:00:00.000Z'
}

describe('material links shared contract', () => {
  test('lists every link IPC channel in the runtime witness', () => {
    expect(IPC_CHANNELS).toEqual(
      expect.arrayContaining(['links:create', 'links:remove', 'links:listFor'])
    )
  })

  test('keeps request and response shapes typed around TabDescriptor records', () => {
    const createRequest: IpcRequest<'links:create'> = {
      courseId: 'course-1',
      source,
      target
    }
    const createResponse: IpcResponse<'links:create'> = record
    const listResponse: IpcResponse<'links:listFor'> = {
      outgoing: [record],
      incoming: []
    }
    const actionTarget: AgentActionTarget = 'link'

    expect(createRequest).toEqual({ courseId: 'course-1', source, target })
    expect(createResponse).toBe(record)
    expect(listResponse.outgoing).toEqual([record])
    expect(actionTarget).toBe('link')
  })
})
