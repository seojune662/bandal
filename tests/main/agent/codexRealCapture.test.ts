/**
 * Regression test against JSONL captured from a REAL `codex exec --json` run
 * (codex-cli 0.146.0), not from the upstream event definitions.
 *
 * Why this exists: the mapper was originally written against
 * codex-rs/exec/src/exec_events.rs because the authoring environment could not
 * spawn a nested Codex process. That reading missed two item types the CLI
 * actually emits all the time — `todo_list` and `web_search` — which the
 * fall-through happened to survive but rendered as the raw string "todo list".
 *
 * The point of this file is that the fixture is *observed*, so a future item
 * type appearing in the wild is caught here rather than in a user's chat.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { AgentEvent } from '../../../src/shared/types/agent-events'
import { createCodexStreamMapper } from '../../../src/main/features/agent/codex/streamMapper'

const FIXTURE = join(
  process.cwd(),
  'tests/main/agent/fixtures/codex-turn-real.jsonl'
)

function rawLines(): unknown[] {
  return readFileSync(FIXTURE, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown)
}

function mapAll(): AgentEvent[] {
  const mapper = createCodexStreamMapper()
  return rawLines().flatMap((raw) => mapper.map(raw))
}

describe('Codex mapper against a real captured run', () => {
  test('the capture actually covers the item types seen in the wild', () => {
    const itemTypes = new Set(
      rawLines()
        .map((raw) => (raw as { item?: { type?: string } }).item?.type)
        .filter((type): type is string => typeof type === 'string')
    )
    // Guards the fixture itself: if someone trims it down, the coverage this
    // test claims to provide would silently evaporate.
    expect(itemTypes).toContain('agent_message')
    expect(itemTypes).toContain('command_execution')
    expect(itemTypes).toContain('file_change')
    expect(itemTypes).toContain('todo_list')
  })

  test('opens with session-started and closes with turn-complete', () => {
    const events = mapAll()
    expect(events[0]).toMatchObject({ type: 'session-started', provider: 'codex' })
    expect(events.at(-1)).toMatchObject({ type: 'turn-complete' })
  })

  test('drops nothing — every item becomes a renderer-visible event', () => {
    const events = mapAll()
    const itemIds = new Set(
      rawLines()
        .map((raw) => (raw as { item?: { id?: string } }).item?.id)
        .filter((id): id is string => typeof id === 'string')
    )
    const covered = new Set(
      events.flatMap((event) =>
        'toolCallId' in event
          ? [event.toolCallId]
          : 'blockId' in event
            ? [event.blockId]
            : []
      )
    )
    for (const id of itemIds) {
      expect(covered).toContain(id)
    }
  })

  test('labels todo_list in Korean rather than leaking the raw type', () => {
    const labels = mapAll()
      .filter((event) => event.type === 'tool-start')
      .map((event) => (event as { label?: string }).label ?? '')
    const todoLabel = labels.find((label) => label.startsWith('할 일 정리'))
    expect(todoLabel).toBeDefined()
    expect(labels).not.toContain('todo list')
  })
})
