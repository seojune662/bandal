import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createAgentConfirmer,
  type AgentConfirmer
} from '../../../src/main/features/agentTools/confirm'
import type { AgentConfirmRequest } from '../../../src/shared/types/agentTools'

const INPUT: Omit<AgentConfirmRequest, 'requestId'> = {
  courseId: 'course-1',
  tool: 'delete_note',
  summary: '노트를 삭제합니다.',
  details: ['notes/week-1.md']
}

function setup(timeoutMs?: number): {
  confirmer: AgentConfirmer
  requests: AgentConfirmRequest[]
} {
  const requests: AgentConfirmRequest[] = []
  const deps = {
    emit: (request: AgentConfirmRequest) => requests.push(request),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  }
  return { confirmer: createAgentConfirmer(deps), requests }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createAgentConfirmer', () => {
  test('resolves true for an approved request', async () => {
    const { confirmer, requests } = setup()
    const result = confirmer.confirm(INPUT)

    confirmer.resolve({ requestId: requests[0]!.requestId, approved: true })

    await expect(result).resolves.toBe('once')
  })

  test('resolves false for a denied request', async () => {
    const { confirmer, requests } = setup()
    const result = confirmer.confirm(INPUT)

    confirmer.resolve({ requestId: requests[0]!.requestId, approved: false })

    await expect(result).resolves.toBe(false)
  })

  test('denies after the default two-minute timeout', async () => {
    vi.useFakeTimers()
    const { confirmer } = setup()
    let settled = false
    const result = confirmer.confirm(INPUT).then((approved) => {
      settled = true
      return approved
    })

    await vi.advanceTimersByTimeAsync(119_999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe(false)
  })

  test('quietly ignores an unknown request id', async () => {
    const { confirmer, requests } = setup()
    const result = confirmer.confirm(INPUT)

    confirmer.resolve({ requestId: 'unknown', approved: false })
    confirmer.resolve({ requestId: requests[0]!.requestId, approved: true })

    await expect(result).resolves.toBe('once')
  })

  test('ignores duplicate responses after the first one', async () => {
    const { confirmer, requests } = setup()
    const result = confirmer.confirm(INPUT)
    const requestId = requests[0]!.requestId

    confirmer.resolve({ requestId, approved: true })
    confirmer.resolve({ requestId, approved: false })

    await expect(result).resolves.toBe('once')
  })

  test('disposeAll denies every pending request', async () => {
    const { confirmer } = setup()
    const first = confirmer.confirm(INPUT)
    const second = confirmer.confirm({ ...INPUT, tool: 'delete_material' })

    confirmer.disposeAll()

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
  })
})
