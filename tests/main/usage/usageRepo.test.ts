import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createUsageRepo } from '../../../src/main/features/usage/usageRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('usage repository', () => {
  let ctx: TestDb
  let repo: ReturnType<typeof createUsageRepo>

  beforeEach(() => {
    ctx = createTestDb()
    repo = createUsageRepo(ctx.db)
  })

  afterEach(() => ctx.cleanup())

  test('records turns and aggregates a time window by provider', () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString()
    const earlier = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
    repo.record({
      id: 'u1',
      sessionId: 's1',
      courseId: 'c1',
      provider: 'claude-code',
      model: 'opus',
      turnAt: earlier,
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 3 },
      durationMs: 100
    })
    repo.record({
      id: 'u2',
      sessionId: 's1',
      courseId: 'c1',
      provider: 'claude-code',
      model: 'opus',
      turnAt: recent,
      usage: { inputTokens: 5, outputTokens: 2, cacheCreationTokens: 8 },
      durationMs: 50
    })
    repo.record({
      id: 'u3',
      sessionId: 's2',
      courseId: 'c2',
      provider: 'gemini',
      model: 'flash',
      turnAt: recent,
      usage: { inputTokens: 7, outputTokens: 3 }
    })
    repo.record({
      id: 'old',
      sessionId: 's3',
      courseId: 'c3',
      provider: 'codex',
      model: 'default',
      turnAt: old,
      usage: { inputTokens: 99, outputTokens: 99 }
    })

    const summary = repo.summary(7)
    expect(summary.since).toBe(earlier)
    expect(summary.totals).toEqual({
      turns: 3,
      sessions: 2,
      inputTokens: 22,
      outputTokens: 9,
      cacheReadTokens: 3,
      agentMs: 150
    })
    expect(summary.byProvider).toEqual([
      expect.objectContaining({
        provider: 'claude-code',
        model: 'opus',
        turns: 2,
        sessions: 1
      }),
      expect.objectContaining({
        provider: 'gemini',
        model: 'flash',
        turns: 1,
        sessions: 1
      })
    ])
    expect(repo.summary(0).totals.turns).toBe(4)
    expect(
      ctx.db.prepare('SELECT cache_write_tokens FROM agent_usage WHERE id = ?')
        .get('u2')
    ).toEqual({ cache_write_tokens: 8 })
  })

  test('keeps ledger rows when an agent session is deleted', () => {
    const now = new Date().toISOString()
    ctx.db.prepare(
      `INSERT INTO courses
         (id, name, slug, color, folder_path, created_at, updated_at)
       VALUES ('deleted-course', 'Old', 'old', '#000', '/tmp/old', ?, ?)`
    ).run(now, now)
    ctx.db.prepare(
      `INSERT INTO agent_sessions
         (id, course_id, provider, status, created_at, updated_at)
       VALUES ('deleted-session', 'deleted-course', 'codex', 'idle', ?, ?)`
    ).run(now, now)
    repo.record({
      id: 'survivor',
      sessionId: 'deleted-session',
      courseId: 'deleted-course',
      provider: 'codex',
      model: null
    })
    ctx.db.prepare('DELETE FROM agent_sessions WHERE id = ?')
      .run('deleted-session')

    expect(
      ctx.db.prepare('SELECT COUNT(*) AS count FROM agent_usage').get()
    ).toEqual({ count: 1 })
  })
})
