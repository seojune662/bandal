/**
 * REAL-CLI smoke test — proves one full turn end-to-end through
 * ClaudeCodeAdapter outside Electron. Skipped unless explicitly requested
 * (it spawns the user's installed Claude Code and spends tokens):
 *
 *   BANDAL_AGENT_SMOKE=1 pnpm vitest run tests/main/agent/smoke.test.ts
 *
 * See src/main/features/agent/smoke.md.
 */

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createBinaryLocator } from '../../../src/main/features/agent/binaryLocator'
import { createClaudeCodeAdapter } from '../../../src/main/features/agent/claude/ClaudeCodeAdapter'
import type { AgentEvent } from '../../../src/shared/types/agent-events'

const enabled = process.env['BANDAL_AGENT_SMOKE'] === '1'

describe.skipIf(!enabled)('ClaudeCodeAdapter real-CLI smoke', () => {
  test(
    'runs one full turn: spawn → tool use → streamed text → turn-complete',
    { timeout: 180_000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'bandal-agent-smoke-'))
      const locator = createBinaryLocator()
      const adapter = createClaudeCodeAdapter({ locator })

      const availability = await adapter.checkAvailability()
      expect(availability).toMatchObject({ installed: true, loggedIn: true })

      const session = await adapter.startSession({
        courseId: 'smoke-course',
        cwd: dir,
        model: 'haiku',
        systemPromptAppend: 'You are a smoke test. Be terse.'
      })

      const events: AgentEvent[] = []
      const done = new Promise<void>((resolve) => {
        session.on((event) => {
          events.push(event)
          if (event.type === 'turn-complete' || (event.type === 'error' && event.fatal)) {
            resolve()
          }
        })
      })
      session.sendMessage(
        'Create a file named smoke.txt containing exactly "bandal smoke ok", then reply with one short sentence.'
      )
      await done
      const cliSessionId = await session.sessionId
      session.dispose()

      // session identity + resume record inputs
      expect(cliSessionId).toMatch(/[0-9a-f-]{36}/)
      expect(session.transcriptPath).toContain(`${cliSessionId}.jsonl`)

      // the tool actually ran in the course folder
      expect(readFileSync(join(dir, 'smoke.txt'), 'utf8')).toBe('bandal smoke ok')

      // event stream sanity
      const types = new Set(events.map((event) => event.type))
      expect(types.has('session-started')).toBe(true)
      expect(types.has('tool-start')).toBe(true)
      expect(types.has('tool-end')).toBe(true)
      expect(types.has('text-final')).toBe(true)
      const complete = events.find((event) => event.type === 'turn-complete')
      expect(complete).toMatchObject({ stopReason: 'success' })

      // transcript flushed on disk (crash-recovery durability)
      if (session.transcriptPath !== null) {
        expect(existsSync(session.transcriptPath)).toBe(true)
      }

      rmSync(dir, { recursive: true, force: true })
    }
  )
})
