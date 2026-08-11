import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEventBatcher } from '../../../src/main/features/agent/eventBatcher'
import type { ChatEventBatch } from '../../../src/shared/ipc/events'
import type { AgentEvent } from '../../../src/shared/types/agent-events'

const COURSE = 'course-1'
const SESSION = 'conv-1'

function textDelta(blockId: string, text: string): AgentEvent {
  return { type: 'text-delta', blockId, text }
}

describe('eventBatcher', () => {
  let sent: ChatEventBatch[]
  let batcher: ReturnType<typeof createEventBatcher>

  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    batcher = createEventBatcher({ send: (batch) => sent.push(batch) })
  })

  afterEach(() => {
    batcher.dispose()
    vi.useRealTimers()
  })

  test('debounces deltas by 40ms and coalesces same-block text', () => {
    batcher.push(COURSE, SESSION, textDelta('b1', 'Hel'))
    batcher.push(COURSE, SESSION, textDelta('b1', 'lo '))
    batcher.push(COURSE, SESSION, textDelta('b1', 'world'))
    expect(sent).toHaveLength(0)

    vi.advanceTimersByTime(39)
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(1)

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ courseId: COURSE, sessionId: SESSION, seq: 1 })
    expect(sent[0]!.events).toEqual([textDelta('b1', 'Hello world')])
  })

  test('does not merge deltas across different blocks', () => {
    batcher.push(COURSE, SESSION, textDelta('b1', 'a'))
    batcher.push(COURSE, SESSION, textDelta('b2', 'b'))
    vi.advanceTimersByTime(40)
    expect(sent[0]!.events).toHaveLength(2)
  })

  test('coalesces tool-input deltas per toolCallId', () => {
    batcher.push(COURSE, SESSION, {
      type: 'tool-input-delta',
      toolCallId: 't1',
      partialInput: '{"file_'
    })
    batcher.push(COURSE, SESSION, {
      type: 'tool-input-delta',
      toolCallId: 't1',
      partialInput: 'path":"x"}'
    })
    vi.advanceTimersByTime(40)
    expect(sent[0]!.events).toEqual([
      { type: 'tool-input-delta', toolCallId: 't1', partialInput: '{"file_path":"x"}' }
    ])
  })

  test('continuous deltas flush at the 250ms max wait', () => {
    // pushes every 30ms keep resetting the 40ms debounce…
    for (let push = 0; push < 9; push += 1) {
      batcher.push(COURSE, SESSION, textDelta('b1', 'x'))
      vi.advanceTimersByTime(30)
    }
    // …but the max-wait timer armed at the first push fired at 250ms
    expect(sent).toHaveLength(1)
  })

  test('non-delta events flush the pending frame immediately', () => {
    batcher.push(COURSE, SESSION, textDelta('b1', 'partial'))
    batcher.push(COURSE, SESSION, {
      type: 'turn-complete',
      stopReason: 'success'
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.events.map((event) => event.type)).toEqual([
      'text-delta',
      'turn-complete'
    ])
  })

  test('seq increases monotonically per conversation', () => {
    batcher.push(COURSE, SESSION, { type: 'turn-complete', stopReason: 'success' })
    batcher.push(COURSE, SESSION, { type: 'turn-complete', stopReason: 'success' })
    // second conversation in the SAME course keeps its own seq
    batcher.push(COURSE, 'conv-2', { type: 'turn-complete', stopReason: 'success' })
    expect(sent.map((batch) => [batch.sessionId, batch.seq])).toEqual([
      [SESSION, 1],
      [SESSION, 2],
      ['conv-2', 1]
    ])
  })

  test('flush() sends pending deltas without waiting', () => {
    batcher.push(COURSE, SESSION, textDelta('b1', 'now'))
    batcher.flush(SESSION)
    expect(sent).toHaveLength(1)
    // no double send when timers later fire
    vi.advanceTimersByTime(300)
    expect(sent).toHaveLength(1)
  })
})
