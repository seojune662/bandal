import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createChatRepo } from '../../../src/main/features/agent/chatRepo'
import {
  buildStudyPrompt,
  createSessionManager,
  type SessionManager
} from '../../../src/main/features/agent/SessionManager'
import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  PermissionResponse
} from '../../../src/shared/types/agent-events'

interface FakeSession extends AgentSession {
  emit(event: AgentEvent): void
  sentMessages: string[]
  permissionResponses: { requestId: string; response: PermissionResponse }[]
  cancelled: boolean
  disposed: boolean
}

function createFakeSession(): FakeSession {
  const subscribers = new Set<(event: AgentEvent) => void>()
  const session: FakeSession = {
    sessionId: Promise.resolve('cli-session-1'),
    sentMessages: [],
    permissionResponses: [],
    cancelled: false,
    disposed: false,
    events: {
      // eslint-disable-next-line @typescript-eslint/require-await
      async *[Symbol.asyncIterator]() {
        // not used by the SessionManager (it subscribes via on())
      }
    },
    on: (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    sendMessage: (content) => session.sentMessages.push(content),
    respondPermission: (requestId, response) =>
      session.permissionResponses.push({ requestId, response }),
    cancel: () => {
      session.cancelled = true
    },
    dispose: () => {
      session.disposed = true
    },
    emit: (event) => {
      for (const cb of subscribers) {
        cb(event)
      }
    }
  }
  return session
}

function createFakeAdapter(): {
  adapter: AgentAdapter
  sessions: FakeSession[]
  startOptions: Parameters<AgentAdapter['startSession']>[0][]
} {
  const sessions: FakeSession[] = []
  const startOptions: Parameters<AgentAdapter['startSession']>[0][] = []
  return {
    sessions,
    startOptions,
    adapter: {
      provider: 'claude-code',
      capabilities: {
        interactivePermissions: true,
        streamingInput: false,
        partialText: true,
        cancel: true
      },
      checkAvailability: async () => ({
        installed: true,
        version: '2.1.222',
        loggedIn: true
      }),
      startSession: async (opts) => {
        startOptions.push(opts)
        const session = createFakeSession()
        sessions.push(session)
        return session
      }
    }
  }
}

describe('SessionManager', () => {
  let ctx: TestDb
  let courseId: string
  /** Renderer-minted conversation id — becomes agent_sessions.id on first send. */
  let conversationId: string
  let fake: ReturnType<typeof createFakeAdapter>
  let emitted: { courseId: string; sessionId: string; event: AgentEvent }[]
  let manager: SessionManager
  let repo: ReturnType<typeof createChatRepo>

  beforeEach(() => {
    ctx = createTestDb()
    const coursesRepo = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => ctx.dir
    })
    const course = coursesRepo.create({ name: 'Linear Algebra', color: '#fff' })
    courseId = course.id
    conversationId = randomUUID()
    fake = createFakeAdapter()
    emitted = []
    repo = createChatRepo(ctx.db)
    manager = createSessionManager({
      adapter: fake.adapter,
      repo,
      getCourse: () => ({ folder: course.folderPath, name: course.name }),
      emit: (id, sessionId, event) => emitted.push({ courseId: id, sessionId, event })
    })
  })

  afterEach(() => {
    manager.disposeAll()
    ctx.cleanup()
  })

  test('open() returns availability and empty history without spawning', async () => {
    const result = await manager.open(courseId, conversationId)
    expect(result.history).toEqual([])
    expect(result.availability).toMatchObject({ installed: true, loggedIn: true })
    expect(result.sessionInfo?.status).toBe('idle')
    expect(fake.sessions).toHaveLength(0)
  })

  test('open() alone leaves zero agent_sessions rows (lazy creation)', async () => {
    await manager.open(courseId, conversationId)
    const count = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM agent_sessions')
      .get() as { n: number }
    expect(count.n).toBe(0)
  })

  test('passes the requested surface to the tool server and lazy row', async () => {
    manager.disposeAll()
    const startToolServer = vi.fn(async () => ({
      mcpConfigPath: '/tmp/mcp.json',
      extraAllowedTools: ['mcp__bandal__desktop_screenshot'],
      extraEnv: { BANDAL_MCP_DOCS_TOKEN: 'secret' },
      codexOverrides: ['-c', 'mcp_servers.docs.url="https://mcp.test"'],
      geminiMcpServers: {
        docs: {
          httpUrl: 'https://mcp.test',
          trust: true as const,
          timeout: 60_000
        }
      },
      mcpHint: '등록된 외부 도구 서버: docs — 문서 검색',
      url: 'http://127.0.0.1:1234/mcp',
      token: 'bandal-token',
      close: async () => undefined
    }))
    manager = createSessionManager({
      adapter: fake.adapter,
      repo,
      getCourse: () => ({ folder: ctx.dir, name: 'Linear Algebra' }),
      emit: (id, sessionId, event) =>
        emitted.push({ courseId: id, sessionId, event }),
      startToolServer
    })

    await manager.open(courseId, conversationId, 'desktop')
    await manager.send(courseId, conversationId, '이 화면 설명해줘')

    expect(startToolServer).toHaveBeenCalledWith(
      courseId,
      conversationId,
      expect.any(Function),
      'desktop'
    )
    expect(repo.getSession(conversationId)?.surface).toBe('desktop')
    expect(fake.startOptions[0]).toMatchObject({
      extraAllowedTools: ['mcp__bandal__desktop_screenshot'],
      mcpExtraEnv: { BANDAL_MCP_DOCS_TOKEN: 'secret' },
      mcpExtraArgs: ['-c', 'mcp_servers.docs.url="https://mcp.test"'],
      geminiMcpServers: {
        docs: {
          httpUrl: 'https://mcp.test',
          trust: true,
          timeout: 60_000
        }
      },
      systemPromptAppend: expect.stringContaining(
        '등록된 외부 도구 서버: docs — 문서 검색'
      )
    })
  })

  test('a persisted row surface wins when open requests another surface', async () => {
    const persisted = repo.createSession(
      randomUUID(),
      courseId,
      'claude-code',
      'desktop'
    )
    manager.disposeAll()
    const surfaces: string[] = []
    manager = createSessionManager({
      adapter: fake.adapter,
      repo,
      getCourse: () => ({ folder: ctx.dir, name: 'Linear Algebra' }),
      emit: () => undefined,
      startToolServer: async (_courseId, _sessionId, _getTurnSeq, surface) => {
        surfaces.push(surface)
        return {
          mcpConfigPath: '/tmp/mcp.json',
          extraAllowedTools: [],
          extraEnv: {},
          codexOverrides: [],
          mcpHint: '',
          url: 'http://127.0.0.1:1234/mcp',
          token: 'token',
          close: async () => undefined
        }
      }
    })

    const opened = await manager.open(courseId, persisted.id, 'app')
    await manager.send(courseId, persisted.id, 'resume')

    expect(opened.sessionInfo?.surface).toBe('desktop')
    expect(surfaces).toEqual(['desktop'])
  })

  test('send() lazily spawns, persists the user message and forwards it', async () => {
    const { turnSeq } = await manager.send(courseId, conversationId, 'hello agent')
    expect(turnSeq).toBe(1)
    expect(fake.sessions).toHaveLength(1)
    expect(fake.sessions[0]!.sentMessages).toEqual(['hello agent'])
    expect(fake.startOptions[0]!.systemPromptAppend).toContain('Linear Algebra')

    const history = repo.historyTail(conversationId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ role: 'user', turnSeq: 1 })
    expect(history[0]!.blocks[0]!.payload).toEqual({ text: 'hello agent' })
  })

  test('first send creates the row under the caller-supplied id and titles it', async () => {
    await manager.send(courseId, conversationId, '선형대수\n중간고사 요약해줘')
    const row = ctx.db
      .prepare('SELECT id, course_id, title FROM agent_sessions')
      .get() as { id: string; course_id: string; title: string }
    expect(row).toEqual({
      id: conversationId,
      course_id: courseId,
      title: '선형대수 중간고사 요약해줘'
    })
    // a later send never renames the conversation
    await manager.send(courseId, conversationId, 'another question')
    const title = (
      ctx.db.prepare('SELECT title FROM agent_sessions WHERE id = ?').get(conversationId) as {
        title: string
      }
    ).title
    expect(title).toBe('선형대수 중간고사 요약해줘')
  })

  test('two conversations in one course stream and persist independently', async () => {
    const other = randomUUID()
    await manager.send(courseId, conversationId, 'first conversation')
    await manager.send(courseId, other, 'second conversation')
    expect(fake.sessions).toHaveLength(2)

    fake.sessions[0]!.emit({ type: 'text-delta', blockId: 'b1', text: 'a' })
    fake.sessions[1]!.emit({ type: 'text-delta', blockId: 'b1', text: 'b' })
    expect(emitted.map(({ sessionId }) => sessionId)).toEqual([
      conversationId,
      other
    ])

    expect(repo.historyTail(conversationId)).toHaveLength(1)
    expect(repo.historyTail(other)).toHaveLength(1)
    expect(repo.nextTurnSeq(other)).toBe(2)
  })

  test('session-started persists the resume record', async () => {
    await manager.send(courseId, conversationId, 'hi')
    fake.sessions[0]!.emit({
      type: 'session-started',
      sessionId: 'cli-abc',
      model: 'claude-haiku',
      provider: 'claude-code'
    })
    const row = ctx.db
      .prepare('SELECT cli_session_id, model FROM agent_sessions WHERE course_id = ?')
      .get(courseId) as { cli_session_id: string; model: string }
    expect(row).toEqual({ cli_session_id: 'cli-abc', model: 'claude-haiku' })
  })

  test('a second spawn resumes with the persisted CLI session id', async () => {
    await manager.send(courseId, conversationId, 'hi')
    fake.sessions[0]!.emit({
      type: 'session-started',
      sessionId: 'cli-abc',
      model: 'claude-haiku',
      provider: 'claude-code'
    })
    manager.close(courseId, conversationId)
    await manager.send(courseId, conversationId, 'again')
    expect(fake.startOptions[1]!.resumeCliSessionId).toBe('cli-abc')
  })

  test('the very first send is never primed with a transcript', async () => {
    await manager.send(courseId, conversationId, 'hello')
    expect(fake.sessions[0]!.sentMessages).toEqual(['hello'])
  })

  test('a fresh spawn without a CLI session id primes the wire text, persisted text stays raw', async () => {
    await manager.send(courseId, conversationId, 'first question')
    fake.sessions[0]!.emit({ type: 'text-final', blockId: 'b1', text: 'first answer' })
    fake.sessions[0]!.emit({ type: 'turn-complete', stopReason: 'success' })
    // No session-started ever arrived (e.g. the provider was just switched and
    // the resume record was cleared), then the process went away.
    manager.close(courseId, conversationId)

    await manager.send(courseId, conversationId, 'second question')

    const wire = fake.sessions[1]!.sentMessages[0]!
    expect(wire.startsWith('<이전_대화 messages="2" truncated="false">')).toBe(true)
    expect(wire).toContain('학생: first question')
    expect(wire).toContain('AI: first answer')
    expect(wire.endsWith('\n\nsecond question')).toBe(true)
    expect(fake.startOptions[1]!.resumeCliSessionId).toBeUndefined()

    const history = repo.historyTail(conversationId)
    const lastUser = history.filter((m) => m.role === 'user').at(-1)!
    expect(lastUser.blocks[0]!.payload).toEqual({ text: 'second question' })
    const title = (
      ctx.db.prepare('SELECT title FROM agent_sessions WHERE id = ?').get(conversationId) as {
        title: string
      }
    ).title
    expect(title).toBe('first question')
  })

  test('after session-started a respawn resumes and is not primed', async () => {
    await manager.send(courseId, conversationId, 'hi')
    fake.sessions[0]!.emit({
      type: 'session-started',
      sessionId: 'cli-abc',
      model: 'claude-haiku',
      provider: 'claude-code'
    })
    manager.close(courseId, conversationId)

    await manager.send(courseId, conversationId, 'again')

    expect(fake.sessions[1]!.sentMessages).toEqual(['again'])
  })

  test('a warm process is never primed even before session-started', async () => {
    await manager.send(courseId, conversationId, 'one')
    fake.sessions[0]!.emit({ type: 'turn-complete', stopReason: 'success' })

    await manager.send(courseId, conversationId, 'two')

    expect(fake.sessions).toHaveLength(1)
    expect(fake.sessions[0]!.sentMessages).toEqual(['one', 'two'])
  })

  test('setModel never primes', async () => {
    manager.setModel(courseId, conversationId, 'claude-opus')
    await manager.send(courseId, conversationId, 'first')
    expect(fake.sessions[0]!.sentMessages).toEqual(['first'])
    fake.sessions[0]!.emit({
      type: 'session-started',
      sessionId: 'cli-abc',
      model: 'claude-opus',
      provider: 'claude-code'
    })
    fake.sessions[0]!.emit({ type: 'turn-complete', stopReason: 'success' })

    manager.setModel(courseId, conversationId, 'claude-haiku')
    await manager.send(courseId, conversationId, 'second')

    expect(fake.sessions[1]!.sentMessages).toEqual(['second'])
    expect(fake.startOptions[1]!.resumeCliSessionId).toBe('cli-abc')
  })

  test('turn-complete commits the assistant turn atomically', async () => {
    await manager.send(courseId, conversationId, 'question')
    const session = fake.sessions[0]!
    session.emit({ type: 'text-delta', blockId: 'b1', text: 'par' })
    session.emit({ type: 'text-delta', blockId: 'b1', text: 'tial' })
    session.emit({
      type: 'tool-start',
      toolCallId: 't1',
      toolName: 'Read',
      label: 'Read notes.md',
      input: { file_path: 'notes.md' }
    })
    session.emit({
      type: 'tool-end',
      toolCallId: 't1',
      ok: true,
      result: { summary: 'Read 10 lines' }
    })
    session.emit({ type: 'text-final', blockId: 'b1', text: 'full answer' })

    // nothing committed until the turn completes
    expect(repo.historyTail(conversationId)).toHaveLength(1)

    session.emit({ type: 'turn-complete', stopReason: 'success' })
    const history = repo.historyTail(conversationId)
    expect(history).toHaveLength(2)
    const assistant = history[1]!
    expect(assistant.role).toBe('assistant')
    expect(assistant.turnSeq).toBe(1)
    expect(assistant.blocks.map((block) => block.kind)).toEqual(['text', 'tool'])
    expect(assistant.blocks[0]!.payload).toEqual({ text: 'full answer' })
    expect(assistant.blocks[1]!.payload).toMatchObject({
      toolName: 'Read',
      ok: true,
      result: { summary: 'Read 10 lines' }
    })
  })

  test('turn-complete forwards provider, model and usage to the ledger hook', async () => {
    manager.disposeAll()
    const onUsage = vi.fn()
    manager = createSessionManager({
      adapter: fake.adapter,
      repo,
      getCourse: () => ({ folder: ctx.dir, name: 'Linear Algebra' }),
      emit: () => undefined,
      onUsage
    })
    await manager.send(courseId, conversationId, 'measure this turn')
    const session = fake.sessions[0]!
    session.emit({
      type: 'session-started',
      sessionId: 'cli-usage',
      model: 'claude-opus',
      provider: 'claude-code'
    })
    session.emit({
      type: 'turn-complete',
      stopReason: 'success',
      usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 2 },
      durationMs: 250
    })

    expect(onUsage).toHaveBeenCalledWith({
      courseId,
      sessionId: conversationId,
      provider: 'claude-code',
      model: 'claude-opus',
      usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 2 },
      durationMs: 250
    })
  })

  test('interrupted turns persist partial blocks marked interrupted', async () => {
    await manager.send(courseId, conversationId, 'long task')
    const session = fake.sessions[0]!
    session.emit({ type: 'text-delta', blockId: 'b1', text: 'partial out' })
    manager.cancel(courseId, conversationId)
    expect(session.cancelled).toBe(true)
    session.emit({ type: 'turn-complete', stopReason: 'interrupted' })

    const assistant = repo.historyTail(conversationId)[1]!
    expect(assistant.blocks[0]!.payload).toEqual({
      text: 'partial out',
      interrupted: true
    })
  })

  test('permission-request with a stored grant is auto-allowed silently', async () => {
    repo.addGrant(courseId, 'Write')
    await manager.send(courseId, conversationId, 'write something')
    const session = fake.sessions[0]!
    session.emit({
      type: 'permission-request',
      requestId: 'req-1',
      toolName: 'Write',
      input: { file_path: 'x.txt' }
    })
    expect(session.permissionResponses).toEqual([
      { requestId: 'req-1', response: { behavior: 'allow' } }
    ])
    expect(
      emitted.filter(({ event }) => event.type === 'permission-request')
    ).toHaveLength(0)
  })

  test('respondPermission with remember=true persists a grant', async () => {
    await manager.send(courseId, conversationId, 'write')
    const session = fake.sessions[0]!
    session.emit({
      type: 'permission-request',
      requestId: 'req-2',
      toolName: 'Write',
      input: {}
    })
    expect(
      emitted.some(({ event }) => event.type === 'permission-request')
    ).toBe(true)
    manager.respondPermission(courseId, conversationId, 'req-2', {
      behavior: 'allow',
      remember: true
    })
    expect(repo.listGrants(courseId)).toEqual(['Write'])
    expect(session.permissionResponses[0]!.response.behavior).toBe('allow')
  })

  test('fatal errors mark the session errored and drop the process', async () => {
    await manager.send(courseId, conversationId, 'hi')
    const session = fake.sessions[0]!
    session.emit({
      type: 'error',
      code: 'process-crashed',
      message: 'boom',
      fatal: true
    })
    expect(session.disposed).toBe(true)
    const row = ctx.db
      .prepare('SELECT status FROM agent_sessions WHERE course_id = ?')
      .get(courseId) as { status: string }
    expect(row.status).toBe('error')
    // a fresh send spawns a new process
    await manager.send(courseId, conversationId, 'retry')
    expect(fake.sessions).toHaveLength(2)
  })

  test('spawn failure emits a fatal error event and rejects', async () => {
    const failing = createSessionManager({
      adapter: {
        ...fake.adapter,
        startSession: async () => {
          throw new Error('no binary')
        }
      },
      repo,
      getCourse: () => ({ folder: ctx.dir, name: 'X' }),
      emit: (id, sessionId, event) => emitted.push({ courseId: id, sessionId, event })
    })
    await expect(failing.send(courseId, conversationId, 'hi')).rejects.toThrow(
      'no binary'
    )
    const errors = emitted.filter(({ event }) => event.type === 'error')
    expect(errors).toHaveLength(1)
  })

  test('close() disposes the CLI process', async () => {
    await manager.send(courseId, conversationId, 'hi')
    expect(manager.has(conversationId)).toBe(true)
    manager.close(courseId, conversationId)
    expect(fake.sessions[0]!.disposed).toBe(true)
    expect(manager.has(conversationId)).toBe(false)
  })

  test('all events are forwarded to the emitter (batcher feed)', async () => {
    await manager.send(courseId, conversationId, 'hi')
    const session = fake.sessions[0]!
    session.emit({ type: 'text-delta', blockId: 'b1', text: 'x' })
    session.emit({ type: 'turn-complete', stopReason: 'success' })
    expect(emitted.map(({ event }) => event.type)).toEqual([
      'text-delta',
      'turn-complete'
    ])
    expect(emitted.every(({ sessionId }) => sessionId === conversationId)).toBe(
      true
    )
  })
})

describe('chatRepo conversations', () => {
  let ctx: TestDb
  let courseId: string
  let repo: ReturnType<typeof createChatRepo>

  beforeEach(() => {
    ctx = createTestDb()
    const coursesRepo = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => ctx.dir
    })
    courseId = coursesRepo.create({ name: 'OS', color: '#000' }).id
    repo = createChatRepo(ctx.db)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('listConversations excludes zero-message and deleted conversations', () => {
    const used = repo.createSession(randomUUID(), courseId, 'claude-code')
    repo.appendMessage(courseId, used.id, 'user', 1, [
      { kind: 'text', payload: { text: 'hi' } }
    ])
    repo.setTitleIfEmpty(used.id, 'hi')
    // opened but never used → zero rows of messages
    repo.createSession(randomUUID(), courseId, 'claude-code')
    // used, then deleted
    const gone = repo.createSession(randomUUID(), courseId, 'codex')
    repo.appendMessage(courseId, gone.id, 'user', 1, [
      { kind: 'text', payload: { text: 'bye' } }
    ])
    repo.softDeleteSession(gone.id)

    const conversations = repo.listConversations(courseId)
    expect(conversations).toHaveLength(1)
    expect(conversations[0]).toMatchObject({
      id: used.id,
      courseId,
      provider: 'claude-code',
      title: 'hi',
      messageCount: 1
    })
  })

  test('filters conversations by surface and defaults to app', () => {
    const app = repo.createSession(randomUUID(), courseId, 'claude-code')
    const desktop = repo.createSession(
      randomUUID(),
      courseId,
      'codex',
      'desktop'
    )
    for (const info of [app, desktop]) {
      repo.appendMessage(courseId, info.id, 'user', 1, [
        { kind: 'text', payload: { text: info.surface } }
      ])
    }

    expect(repo.listConversations(courseId).map(({ id }) => id)).toEqual([
      app.id
    ])
    expect(repo.listConversations(courseId, 'desktop')).toEqual([
      expect.objectContaining({ id: desktop.id, surface: 'desktop' })
    ])
    expect(repo.getSession(desktop.id)?.surface).toBe('desktop')
  })

  test('setTitleIfEmpty never overwrites an existing title', () => {
    const info = repo.createSession(randomUUID(), courseId, 'claude-code')
    repo.setTitleIfEmpty(info.id, 'first message')
    repo.setTitleIfEmpty(info.id, 'second message')
    expect(repo.getSession(info.id)?.title).toBe('first message')
  })
})

describe('buildStudyPrompt', () => {
  test('adds desktop guidance only for desktop conversations', () => {
    const app = buildStudyPrompt('OS')
    const desktop = buildStudyPrompt('OS', { surface: 'desktop' })

    expect(app).not.toContain('desktop_screenshot')
    expect(desktop).toContain('먼저 `desktop_screenshot`을 부른 뒤 답하세요')
    expect(desktop).toContain('한 턴에 6장까지예요')
    expect(desktop).toContain('아직 클릭이나 입력은 못 해요')
    expect(Buffer.byteLength(desktop.slice(app.length), 'utf8'))
      .toBeLessThanOrEqual(1_200)
  })

  test('appends a non-empty MCP hint after a blank line', () => {
    const hint = '등록된 외부 도구 서버: docs — 문서 검색'
    const prompt = buildStudyPrompt('OS', {
      surface: 'desktop',
      mcpHint: `  ${hint}  `
    })

    expect(prompt).toMatch(new RegExp(`\\n\\n${hint}$`, 'u'))
  })
})

describe('chatRepo.markDanglingInterrupted', () => {
  let ctx: TestDb

  beforeEach(() => {
    ctx = createTestDb()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('closes crashed running turns with an interrupted placeholder', () => {
    const coursesRepo = createCoursesRepo({
      db: ctx.db,
      getDataRoot: () => ctx.dir
    })
    const course = coursesRepo.create({ name: 'OS', color: '#000' })
    const repo = createChatRepo(ctx.db)
    const info = repo.createSession(randomUUID(), course.id, 'claude-code')
    repo.appendMessage(course.id, info.id, 'user', 1, [
      { kind: 'text', payload: { text: 'died mid-answer' } }
    ])
    repo.setStatus(info.id, 'running')

    repo.markDanglingInterrupted()

    const history = repo.historyTail(info.id)
    expect(history).toHaveLength(2)
    expect(history[1]).toMatchObject({ role: 'assistant', turnSeq: 1 })
    expect(history[1]!.blocks[0]!.payload).toEqual({ text: '', interrupted: true })
    const status = (
      ctx.db.prepare('SELECT status FROM agent_sessions WHERE id = ?').get(info.id) as {
        status: string
      }
    ).status
    expect(status).toBe('idle')
  })
})
