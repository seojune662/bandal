import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PendingGroupMessage } from '../../../src/shared/types/group'
import type { GroupEvent } from '../../../src/shared/types/group-events'
import {
  BACKOFF_CAP_MS,
  backoffMs,
  createOutboxUploader,
  nextOutboxState,
  type SendOutcome
} from '../../../src/main/features/group/OutboxUploader'
import type { GroupRepo } from '../../../src/main/features/group/groupRepo'

function pending(overrides: Partial<PendingGroupMessage> = {}): PendingGroupMessage {
  return {
    localId: 'L1',
    groupId: 'g1',
    body: '보낼 메시지',
    replyTo: null,
    createdAt: '2026-08-06T00:00:00.000Z',
    state: 'pending',
    attempts: 0,
    lastError: null,
    ...overrides
  }
}

/** Only the outbox slice of GroupRepo is exercised here. */
function createFakeRepo(queue: PendingGroupMessage[]): {
  repo: GroupRepo
  calls: string[]
} {
  const calls: string[] = []
  const repo = {
    claimable: () => queue.filter((row) => row.state === 'pending'),
    markSending: (localId: string) => {
      calls.push(`sending:${localId}`)
      const row = queue.find((entry) => entry.localId === localId)
      if (row !== undefined) row.state = 'sending'
    },
    markSent: (localId: string) => {
      calls.push(`sent:${localId}`)
      const index = queue.findIndex((entry) => entry.localId === localId)
      if (index >= 0) queue.splice(index, 1)
    },
    markRetry: (localId: string, error: string) => {
      calls.push(`retry:${localId}`)
      const row = queue.find((entry) => entry.localId === localId)
      if (row === undefined) return null
      row.state = 'pending'
      row.attempts += 1
      row.lastError = error
      return row
    },
    markFailed: (localId: string, error: string) => {
      calls.push(`failed:${localId}`)
      const row = queue.find((entry) => entry.localId === localId)
      if (row !== undefined) {
        row.state = 'failed'
        row.lastError = error
      }
    }
  } as unknown as GroupRepo
  return { repo, calls }
}

interface Harness {
  drain: () => Promise<void>
  queue: PendingGroupMessage[]
  events: { groupId: string; event: GroupEvent }[]
  calls: string[]
  dispose: () => void
}

function harness(
  queue: PendingGroupMessage[],
  send: (message: PendingGroupMessage) => Promise<SendOutcome>,
  options: { canSend?: boolean; maxAttempts?: number } = {}
): Harness {
  const { repo, calls } = createFakeRepo(queue)
  const events: { groupId: string; event: GroupEvent }[] = []
  const uploader = createOutboxUploader({
    repo,
    send,
    emit: (groupId, event) => events.push({ groupId, event }),
    canSend: () => options.canSend ?? true,
    now: () => 1_000_000,
    // Never actually arm a timer in tests — a pending timer keeps vitest alive.
    schedule: () => ({ unref: () => undefined }) as unknown as NodeJS.Timeout,
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts })
  })
  return {
    drain: () => uploader.drain(),
    queue,
    events,
    calls,
    dispose: () => uploader.dispose()
  }
}

describe('backoffMs', () => {
  test('doubles per attempt starting at 1s', () => {
    expect(backoffMs(0)).toBe(1_000)
    expect(backoffMs(1)).toBe(2_000)
    expect(backoffMs(2)).toBe(4_000)
    expect(backoffMs(3)).toBe(8_000)
  })

  test('caps at 60s so a long outage does not become an hour-long wait', () => {
    expect(backoffMs(20)).toBe(BACKOFF_CAP_MS)
  })

  test('treats a negative attempt count as zero', () => {
    expect(backoffMs(-3)).toBe(1_000)
  })
})

describe('nextOutboxState', () => {
  test('a successful insert is done', () => {
    expect(nextOutboxState({ kind: 'sent', messageId: 'm', seq: 1 }, 0)).toBe('sent')
  })

  test('a PK conflict is SUCCESS, not an error', () => {
    // Client-generated uuids make the insert idempotent; a duplicate means the
    // row is already stored and only our ack went missing (§4.4).
    expect(nextOutboxState({ kind: 'duplicate' }, 3)).toBe('sent')
  })

  test('a rejection fails immediately — retrying cannot help', () => {
    expect(nextOutboxState({ kind: 'rejected', error: 'rls' }, 0)).toBe('failed')
  })

  test('a transient error retries while attempts remain', () => {
    expect(nextOutboxState({ kind: 'retry', error: 'network' }, 0, 6)).toBe('retry')
    expect(nextOutboxState({ kind: 'retry', error: 'network' }, 4, 6)).toBe('retry')
  })

  test('a transient error becomes failed on the last attempt', () => {
    expect(nextOutboxState({ kind: 'retry', error: 'network' }, 5, 6)).toBe('failed')
  })

  test('a rate limit is transient and bounded the same way', () => {
    const outcome: SendOutcome = {
      kind: 'rate-limited',
      error: 'rate_limited',
      retryAfter: 5
    }
    expect(nextOutboxState(outcome, 0, 6)).toBe('retry')
    expect(nextOutboxState(outcome, 5, 6)).toBe('failed')
  })
})

describe('drain', () => {
  let queue: PendingGroupMessage[]

  beforeEach(() => {
    queue = [pending()]
  })

  test('sends a queued row and clears it', async () => {
    const test1 = harness(queue, () =>
      Promise.resolve({ kind: 'sent', messageId: 'm9', seq: 9 } as SendOutcome)
    )
    await test1.drain()
    expect(test1.calls).toEqual(['sending:L1', 'sent:L1'])
    expect(queue).toHaveLength(0)
    const settled = test1.events[0]?.event
    expect(settled?.type).toBe('local-echo-settled')
    if (settled?.type === 'local-echo-settled') {
      expect(settled.messageId).toBe('m9')
      expect(settled.seq).toBe(9)
    }
    test1.dispose()
  })

  test('a duplicate settles the echo instead of erroring', async () => {
    const test1 = harness(queue, () =>
      Promise.resolve({ kind: 'duplicate' } as SendOutcome)
    )
    await test1.drain()
    expect(queue).toHaveLength(0)
    expect(test1.events[0]?.event.type).toBe('local-echo-settled')
    test1.dispose()
  })

  test('a transient failure re-queues with an incremented attempt count', async () => {
    const test1 = harness(queue, () =>
      Promise.resolve({ kind: 'retry', error: 'network' } as SendOutcome)
    )
    await test1.drain()
    expect(test1.calls).toEqual(['sending:L1', 'retry:L1'])
    expect(queue[0]?.attempts).toBe(1)
    expect(queue[0]?.state).toBe('pending')
    // No user-visible failure yet — it is still going to be delivered.
    expect(test1.events).toHaveLength(0)
    test1.dispose()
  })

  test('a rejection fails the row immediately and surfaces it', async () => {
    const test1 = harness(queue, () =>
      Promise.resolve({ kind: 'rejected', error: 'not_a_member' } as SendOutcome)
    )
    await test1.drain()
    expect(queue[0]?.state).toBe('failed')
    const event = test1.events[0]?.event
    expect(event?.type).toBe('local-echo-failed')
    if (event?.type === 'local-echo-failed') {
      expect(event.reason).toBe('rejected')
    }
    test1.dispose()
  })

  test('the last attempt turns a transient error into a visible failure', async () => {
    queue = [pending({ attempts: 5 })]
    const test1 = harness(
      queue,
      () => Promise.resolve({ kind: 'retry', error: 'network' } as SendOutcome),
      { maxAttempts: 6 }
    )
    await test1.drain()
    expect(queue[0]?.state).toBe('failed')
    const event = test1.events[0]?.event
    if (event?.type === 'local-echo-failed') {
      expect(event.reason).toBe('network')
    }
    test1.dispose()
  })

  test('a terminal rate limit reports retryAfter for the countdown', async () => {
    queue = [pending({ attempts: 5 })]
    const test1 = harness(
      queue,
      () =>
        Promise.resolve({
          kind: 'rate-limited',
          error: 'rate_limited',
          retryAfter: 42
        } as SendOutcome),
      { maxAttempts: 6 }
    )
    await test1.drain()
    const event = test1.events[0]?.event
    expect(event?.type).toBe('local-echo-failed')
    if (event?.type === 'local-echo-failed') {
      expect(event.reason).toBe('rate-limit')
      expect(event.retryAfter).toBe(42)
    }
    test1.dispose()
  })

  test('it stops after the first transient failure instead of hammering', async () => {
    queue = [pending({ localId: 'L1' }), pending({ localId: 'L2' })]
    const send = vi.fn(() =>
      Promise.resolve({ kind: 'retry', error: 'network' } as SendOutcome)
    )
    const test1 = harness(queue, send)
    await test1.drain()
    expect(send).toHaveBeenCalledTimes(1)
    test1.dispose()
  })

  test('it does nothing while signed out / offline', async () => {
    const send = vi.fn(() =>
      Promise.resolve({ kind: 'sent', messageId: 'm', seq: 1 } as SendOutcome)
    )
    const test1 = harness(queue, send, { canSend: false })
    await test1.drain()
    expect(send).not.toHaveBeenCalled()
    expect(queue).toHaveLength(1)
    test1.dispose()
  })

  test('a thrown send is caught and the row is re-queued, never stranded', async () => {
    // A row stuck in 'sending' forever is invisible data loss.
    const test1 = harness(queue, () => Promise.reject(new Error('boom')))
    await test1.drain()
    expect(test1.calls).toEqual(['sending:L1', 'retry:L1'])
    expect(queue[0]?.state).toBe('pending')
    test1.dispose()
  })

  test('concurrent drains coalesce into one pass', async () => {
    const send = vi.fn(() =>
      Promise.resolve({ kind: 'sent', messageId: 'm', seq: 1 } as SendOutcome)
    )
    const test1 = harness(queue, send)
    await Promise.all([test1.drain(), test1.drain(), test1.drain()])
    expect(send).toHaveBeenCalledTimes(1)
    test1.dispose()
  })
})
