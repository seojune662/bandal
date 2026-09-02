import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createChatRepo,
  type ChatRepo
} from '../../../src/main/features/agent/chatRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE_ID = 'course-1'

function insertCourse(ctx: TestDb): void {
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO courses
       (id, name, slug, color, folder_path, archived, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(COURSE_ID, 'Course', COURSE_ID, '#000', '/tmp/course-1', now, now)
}

describe('chatRepo permission grants', () => {
  let ctx: TestDb
  let repo: ChatRepo

  beforeEach(() => {
    ctx = createTestDb()
    insertCourse(ctx)
    repo = createChatRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('lists grant details and soft-removes a grant from active listings', () => {
    repo.addGrant(COURSE_ID, 'Write')
    const [grant] = repo.listGrantDetails(COURSE_ID)

    expect(grant).toMatchObject({ rule: 'Write' })
    expect(grant?.id).toEqual(expect.any(String))
    expect(grant?.createdAt).toEqual(expect.any(String))

    repo.removeGrant(grant!.id)

    expect(repo.listGrants(COURSE_ID)).toEqual([])
    expect(repo.listGrantDetails(COURSE_ID)).toEqual([])
    expect(
      ctx.db
        .prepare('SELECT deleted_at FROM permission_grants WHERE id = ?')
        .get(grant!.id)
    ).toEqual({ deleted_at: expect.any(String) })
  })
})

describe('chatRepo provider switch', () => {
  let ctx: TestDb
  let repo: ChatRepo

  beforeEach(() => {
    ctx = createTestDb()
    insertCourse(ctx)
    repo = createChatRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  function seedConversation(): string {
    const info = repo.createSession('conv-1', COURSE_ID, 'claude-code', 'desktop')
    repo.appendMessage(COURSE_ID, info.id, 'user', 1, [
      { kind: 'text', payload: { text: '첫 질문' } }
    ])
    repo.appendMessage(COURSE_ID, info.id, 'assistant', 1, [
      { kind: 'text', payload: { text: '첫 답' } }
    ])
    repo.setTitleIfEmpty(info.id, '첫 질문')
    repo.recordSessionStart(info.id, {
      cliSessionId: 'cli-1',
      model: 'claude-haiku',
      transcriptPath: '/tmp/t.jsonl',
      launchConfigJson: '{"a":1}'
    })
    return info.id
  }

  test('switchProvider clears the CLI resume record but keeps title, surface and messages', () => {
    const id = seedConversation()

    const info = repo.switchProvider(id, 'codex')

    expect(info).toMatchObject({
      id,
      provider: 'codex',
      cliSessionId: null,
      model: null,
      status: 'idle',
      surface: 'desktop',
      title: '첫 질문'
    })
    const row = ctx.db
      .prepare(
        'SELECT provider, cli_session_id, model, transcript_path, launch_config_json FROM agent_sessions WHERE id = ?'
      )
      .get(id)
    expect(row).toEqual({
      provider: 'codex',
      cli_session_id: null,
      model: null,
      transcript_path: null,
      launch_config_json: null
    })
    expect(repo.historyTail(id)).toHaveLength(2)
  })

  test('switchProvider ignores deleted conversations', () => {
    const id = seedConversation()
    repo.softDeleteSession(id)

    expect(repo.switchProvider(id, 'codex')).toBeNull()
    expect(
      ctx.db.prepare('SELECT provider FROM agent_sessions WHERE id = ?').get(id)
    ).toEqual({ provider: 'claude-code' })
  })

  test('appendNotice lands at the next turn and hydrates as a notice block', () => {
    const id = seedConversation()

    const notice = repo.appendNotice(COURSE_ID, id, {
      kind: 'provider-switch',
      from: 'claude-code',
      to: 'codex',
      carried: { messages: 2, chars: 14, truncated: false }
    })

    expect(notice).toMatchObject({ role: 'assistant', turnSeq: 2 })
    const tail = repo.historyTail(id)
    expect(tail).toHaveLength(3)
    expect(tail[2]!.blocks).toHaveLength(1)
    expect(tail[2]!.blocks[0]).toMatchObject({
      kind: 'notice',
      payload: { kind: 'provider-switch', from: 'claude-code', to: 'codex' }
    })
    expect(repo.nextTurnSeq(id)).toBe(3)
  })

  test('markDanglingInterrupted leaves notice turns alone', () => {
    const id = seedConversation()
    repo.appendNotice(COURSE_ID, id, {
      kind: 'provider-switch',
      from: 'claude-code',
      to: 'codex',
      carried: { messages: 2, chars: 14, truncated: false }
    })
    repo.setStatus(id, 'running')

    repo.markDanglingInterrupted()

    const tail = repo.historyTail(id)
    expect(tail).toHaveLength(3)
    expect(tail.filter((m) => m.blocks.some((b) => b.kind === 'notice'))).toHaveLength(1)
    expect(
      tail.some((m) =>
        m.blocks.some(
          (b) => (b.payload as { interrupted?: boolean } | null)?.interrupted === true
        )
      )
    ).toBe(false)
  })
})
