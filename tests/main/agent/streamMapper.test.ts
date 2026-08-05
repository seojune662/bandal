/**
 * streamMapper against real CLI captures (claude 2.1.222) recorded during the
 * M4-H spikes — see src/main/features/agent/SPIKE-NOTES.md and ./fixtures.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { createStreamMapper } from '../../../src/main/features/agent/claude/streamMapper'
import type { AgentEvent } from '../../../src/shared/types/agent-events'

function loadFixture(name: string): unknown[] {
  const raw = readFileSync(
    new URL(`./fixtures/${name}`, import.meta.url),
    'utf8'
  )
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown)
}

function mapAll(lines: unknown[]): AgentEvent[] {
  const mapper = createStreamMapper()
  return lines.flatMap((line) => mapper.map(line))
}

function ofType<T extends AgentEvent['type']>(
  events: AgentEvent[],
  type: T
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((event) => event.type === type) as Extract<
    AgentEvent,
    { type: T }
  >[]
}

describe('streamMapper: full turn with Write tool (turn-write-tool.jsonl)', () => {
  const events = mapAll(loadFixture('turn-write-tool.jsonl'))

  test('emits session-started exactly once with session id and model', () => {
    const started = ofType(events, 'session-started')
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      sessionId: '6f77e478-6057-4fd1-9bcb-154a7d309a74',
      model: 'claude-haiku-4-5-20251001',
      provider: 'claude-code'
    })
  })

  test('streams thinking deltas', () => {
    const thinking = ofType(events, 'thinking-delta')
    expect(thinking.length).toBeGreaterThan(3)
    expect(thinking.map((event) => event.text).join('')).toContain(
      'hello.txt'
    )
  })

  test('text-final replaces the accumulated deltas for the same blockId', () => {
    const deltas = ofType(events, 'text-delta')
    const finals = ofType(events, 'text-final')
    expect(deltas.length).toBeGreaterThan(0)
    expect(finals).toHaveLength(1)
    const final = finals[0]!
    expect(final.text).toBe('I created hello.txt with the content "hi bandal".')
    // dedupe rule: same blockId as the streamed deltas
    const deltaIds = new Set(deltas.map((event) => event.blockId))
    expect(deltaIds.has(final.blockId)).toBe(true)
    expect(deltas.map((e) => e.text).join('')).toBe(final.text)
  })

  test('tool-start is upserted: bare on stream start, refreshed with input', () => {
    const starts = ofType(events, 'tool-start')
    expect(starts).toHaveLength(2)
    expect(starts[0]).toMatchObject({ toolName: 'Write', label: 'Write' })
    expect(starts[0]!.input).toBeUndefined()
    expect(starts[1]!.toolCallId).toBe(starts[0]!.toolCallId)
    expect(starts[1]!.label).toBe('Write hello.txt')
    expect(starts[1]!.input).toMatchObject({ content: 'hi bandal' })
  })

  test('tool-input-delta events carry the streamed partial JSON', () => {
    const inputDeltas = ofType(events, 'tool-input-delta')
    expect(inputDeltas.length).toBeGreaterThan(0)
    expect(inputDeltas.map((event) => event.partialInput).join('')).toContain(
      'hi bandal'
    )
  })

  test('tool-end reports success with a renderable summary', () => {
    const ends = ofType(events, 'tool-end')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ ok: true })
    expect(ends[0]!.result?.summary).toContain('File created successfully')
  })

  test('turn-complete carries success, usage, cost and duration', () => {
    const complete = ofType(events, 'turn-complete')
    expect(complete).toHaveLength(1)
    expect(complete[0]).toMatchObject({ stopReason: 'success' })
    expect(complete[0]!.usage?.inputTokens).toBeGreaterThan(0)
    expect(complete[0]!.costUsd).toBeGreaterThan(0)
    expect(complete[0]!.durationMs).toBeGreaterThan(0)
  })

  test('ignores CLI noise (status, thinking_tokens, allowed rate limits)', () => {
    expect(ofType(events, 'limit')).toHaveLength(0)
    expect(ofType(events, 'error')).toHaveLength(0)
  })
})

describe('streamMapper: can_use_tool permission flow', () => {
  test('allow capture emits a permission-request with suggestions', () => {
    const events = mapAll(loadFixture('permission-allow.jsonl'))
    const requests = ofType(events, 'permission-request')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ toolName: 'Write' })
    expect(requests[0]!.requestId).toMatch(/[0-9a-f-]{36}/)
    expect(requests[0]!.input).toMatchObject({ content: 'permission spike' })
    expect(requests[0]!.suggestions?.length).toBeGreaterThan(0)
    expect(requests[0]!.suggestions?.[0]).toMatchObject({ behavior: 'allow' })
    // the granted tool then runs
    expect(ofType(events, 'tool-end')[0]).toMatchObject({ ok: true })
  })

  test('deny capture maps the failed tool_result to tool-end ok=false', () => {
    const events = mapAll(loadFixture('permission-deny.jsonl'))
    expect(ofType(events, 'permission-request')).toHaveLength(1)
    const ends = ofType(events, 'tool-end')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ ok: false })
    expect(ends[0]!.result?.summary).toContain('denied')
    // the model continues and the turn still completes
    expect(ofType(events, 'turn-complete')[0]).toMatchObject({
      stopReason: 'success'
    })
  })
})

describe('streamMapper: interrupt (interrupt-midturn.jsonl)', () => {
  test('aborted result maps to interrupted only when we initiated it', () => {
    const lines = loadFixture('interrupt-midturn.jsonl')
    const mapper = createStreamMapper()
    const events: AgentEvent[] = []
    let resultsSeen = 0
    for (const line of lines) {
      const record = line as { type?: string }
      // The capture interrupts the SECOND turn: mark just before its result.
      if (record.type === 'result') {
        resultsSeen += 1
        if (resultsSeen === 2) {
          mapper.markInterrupted()
        }
      }
      events.push(...mapper.map(line))
    }
    const complete = ofType(events, 'turn-complete')
    expect(complete).toHaveLength(2)
    expect(complete[0]).toMatchObject({ stopReason: 'success' })
    expect(complete[1]).toMatchObject({ stopReason: 'interrupted' })
    // init repeats each turn but session-started stays deduped
    expect(ofType(events, 'session-started')).toHaveLength(1)
  })

  test('an aborted result without our interrupt maps to error', () => {
    const lines = loadFixture('interrupt-midturn.jsonl')
    const events = mapAll(lines) // never calls markInterrupted
    const complete = ofType(events, 'turn-complete')
    expect(complete[1]).toMatchObject({ stopReason: 'error' })
  })
})

describe('streamMapper: resume (resume-turn.jsonl)', () => {
  test('a resumed session reports the SAME session id and streams normally', () => {
    const events = mapAll(loadFixture('resume-turn.jsonl'))
    const started = ofType(events, 'session-started')
    expect(started).toHaveLength(1)
    expect(started[0]!.sessionId).toBe('bfb38c37-6655-48d4-ae1c-3d6489b4e793')
    expect(ofType(events, 'text-final')[0]!.text).toContain('Moonbear')
    expect(ofType(events, 'turn-complete')[0]).toMatchObject({
      stopReason: 'success'
    })
  })
})

describe('streamMapper: robustness', () => {
  test('ignores garbage and unknown event types', () => {
    const mapper = createStreamMapper()
    expect(mapper.map(null)).toEqual([])
    expect(mapper.map(42)).toEqual([])
    expect(mapper.map({ type: 'wat' })).toEqual([])
    expect(mapper.map({ type: 'stream_event' })).toEqual([])
    expect(mapper.map({ type: 'system', subtype: 'status' })).toEqual([])
  })

  test('assistant text without prior streaming still yields text-final', () => {
    const mapper = createStreamMapper()
    const events = mapper.map({
      type: 'assistant',
      message: { id: 'msg_x', content: [{ type: 'text', text: 'hello' }] }
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'text-final', text: 'hello' })
  })
})
