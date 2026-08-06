import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { AgentEvent } from '../../../src/shared/types/agent-events'
import { createCodexStreamMapper } from '../../../src/main/features/agent/codex/streamMapper'

const FIXTURE = join(
  process.cwd(),
  'tests/main/agent/fixtures/codex-turn.jsonl'
)

function fixtureEvents(): AgentEvent[] {
  const mapper = createCodexStreamMapper()
  return readFileSync(FIXTURE, 'utf8')
    .trim()
    .split('\n')
    .flatMap((line) => mapper.map(JSON.parse(line) as unknown))
}

describe('Codex exec JSONL stream mapper', () => {
  test('maps the observed thread and terminal usage events', () => {
    const events = fixtureEvents()
    expect(events[0]).toEqual({
      type: 'session-started',
      sessionId: '019f2b90-0c34-77a1-ad02-b38355965b93',
      model: 'codex',
      provider: 'codex'
    })
    expect(events.at(-1)).toEqual({
      type: 'turn-complete',
      stopReason: 'success',
      usage: { inputTokens: 5, outputTokens: 4, cacheReadTokens: 2 }
    })
  })

  test('maps reasoning, command execution and file change items', () => {
    const events = fixtureEvents()
    expect(events).toContainEqual({
      type: 'thinking-delta',
      blockId: 'item_0',
      text: 'I should answer briefly.'
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool-start',
        toolCallId: 'item_1',
        toolName: 'command_execution',
        input: { command: "printf 'hi\\n'" }
      })
    )
    expect(events).toContainEqual({
      type: 'tool-end',
      toolCallId: 'item_1',
      ok: true,
      result: { summary: 'hi' }
    })
    // file_change can arrive completed without an item.started frame.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool-start',
        toolCallId: 'item_2',
        toolName: 'file_change'
      })
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool-end',
        toolCallId: 'item_2',
        ok: true
      })
    )
  })

  test('turns cumulative message updates into deltas and one final', () => {
    const events = fixtureEvents().filter(
      (event) =>
        (event.type === 'text-delta' || event.type === 'text-final') &&
        event.blockId === 'item_3'
    )
    expect(events).toEqual([
      { type: 'text-delta', blockId: 'item_3', text: '안녕' },
      { type: 'text-delta', blockId: 'item_3', text: '하세요!' },
      { type: 'text-final', blockId: 'item_3', text: '안녕하세요!' }
    ])
  })

  test('deduplicates thread.started across resume processes', () => {
    const mapper = createCodexStreamMapper()
    const raw = {
      type: 'thread.started',
      thread_id: '019f2b90-0c34-77a1-ad02-b38355965b93'
    }
    expect(mapper.map(raw)).toHaveLength(1)
    expect(mapper.map(raw)).toEqual([])
  })

  test('synthesizes interrupted completion if a killed turn has no terminal line', () => {
    const mapper = createCodexStreamMapper()
    mapper.map({ type: 'turn.started' })
    expect(mapper.finishProcess(true)).toEqual([
      { type: 'turn-complete', stopReason: 'interrupted' }
    ])
    expect(mapper.finishProcess(true)).toEqual([])
  })

  test('keeps item errors non-fatal but treats top-level stream errors as fatal', () => {
    const mapper = createCodexStreamMapper()
    expect(
      mapper.map({
        type: 'item.completed',
        item: { id: 'warning-1', type: 'error', message: 'stream lagged' }
      })
    ).toEqual([
      {
        type: 'error',
        code: 'unknown',
        message: 'stream lagged',
        fatal: false
      }
    ])
    expect(mapper.map({ type: 'error', message: 'connection failed' })).toEqual([
      {
        type: 'error',
        code: 'unknown',
        message: 'connection failed',
        fatal: true
      }
    ])
  })
})
