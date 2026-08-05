import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createCoursesRepo } from '../../../src/main/features/courses'
import { createChatRepo } from '../../../src/main/features/agent/chatRepo'
import {
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
  let fake: ReturnType<typeof createFakeAdapter>
  let emitted: { courseId: string; event: AgentEvent }[]
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
    fake = createFakeAdapter()
    emitted = []
    repo = createChatRepo(ctx.db)
    manager = createSessionManager({
      adapter: fake.adapter,
      repo,
      getCourse: () => ({ folder: course.folderPath, name: course.name }),
      emit: (id, event) => emitted.push({ courseId: id, event })
    })
  })

  afterEach(() => {
    manager.disposeAll()
    ctx.cleanup()
  })

  test('open() returns availability and empty history without spawning', async () => {
    const result = await manager.open(courseId)
    expect(result.history).toEqual([])
    expect(result.availability).toMatchObject({ installed: true, loggedIn: true })
    expect(result.sessionInfo?.status).toBe('idle')
    expect(fake.sessions).toHaveLength(0)
  })

  test('send() lazily spawns, persists the user message and forwards it', async () => {
    const { turnSeq } = await manager.send(courseId, 'hello agent')
    expect(turnSeq).toBe(1)
    expect(fake.sessions).toHaveLength(1)
    expect(fake.sessions[0]!.sentMessages).toEqual(['hello agent'])
    expect(fake.startOptions[0]!.systemPromptAppend).toContain('Linear Algebra')

    const history = repo.historyTail(courseId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ role: 'user', turnSeq: 1 })
    expect(history[0]!.blocks[0]!.payload).toEqual({ text: 'hello agent' })
  })

  test('session-started persists the resume record', async () => {
    await manager.send(courseId, 'hi')
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
    await manager.send(courseId, 'hi')
    fake.sessions[0]!.emit({
      type: 'session-started',
      sessionId: 'cli-abc',
      model: 'claude-haiku',
      provider: 'claude-code'
    })
    manager.close(courseId)
    await manager.send(courseId, 'again')
    expect(fake.startOptions[1]!.resumeCliSessionId).toBe('cli-abc')
  })

  test('turn-complete commits the assistant turn atomically', async () => {
    await manager.send(courseId, 'question')
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
    expect(repo.historyTail(courseId)).toHaveLength(1)

    session.emit({ type: 'turn-complete', stopReason: 'success' })
    const history = repo.historyTail(courseId)
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

  test('interrupted turns persist partial blocks marked interrupted', async () => {
    await manager.send(courseId, 'long task')
    const session = fake.sessions[0]!
    session.emit({ type: 'text-delta', blockId: 'b1', text: 'partial out' })
    manager.cancel(courseId)
    expect(session.cancelled).toBe(true)
    session.emit({ type: 'turn-complete', stopReason: 'interrupted' })

    const assistant = repo.historyTail(courseId)[1]!
    expect(assistant.blocks[0]!.payload).toEqual({
      text: 'partial out',
      interrupted: true
    })
  })

  test('permission-request with a stored grant is auto-allowed silently', async () => {
    repo.addGrant(courseId, 'Write')
    await manager.send(courseId, 'write something')
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
    await manager.send(courseId, 'write')
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
    manager.respondPermission(courseId, 'req-2', {
      behavior: 'allow',
      remember: true
    })
    expect(repo.listGrants(courseId)).toEqual(['Write'])
    expect(session.permissionResponses[0]!.response.behavior).toBe('allow')
  })

  test('fatal errors mark the session errored and drop the process', async () => {
    await manager.send(courseId, 'hi')
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
    await manager.send(courseId, 'retry')
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
      emit: (id, event) => emitted.push({ courseId: id, event })
    })
    await expect(failing.send(courseId, 'hi')).rejects.toThrow('no binary')
    const errors = emitted.filter(({ event }) => event.type === 'error')
    expect(errors).toHaveLength(1)
  })

  test('close() disposes the CLI process', async () => {
    await manager.send(courseId, 'hi')
    manager.close(courseId)
    expect(fake.sessions[0]!.disposed).toBe(true)
  })

  test('all events are forwarded to the emitter (batcher feed)', async () => {
    await manager.send(courseId, 'hi')
    const session = fake.sessions[0]!
    session.emit({ type: 'text-delta', blockId: 'b1', text: 'x' })
    session.emit({ type: 'turn-complete', stopReason: 'success' })
    expect(emitted.map(({ event }) => event.type)).toEqual([
      'text-delta',
      'turn-complete'
    ])
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
    const info = repo.getOrCreateSession(course.id, 'claude-code')
    repo.appendMessage(course.id, info.id, 'user', 1, [
      { kind: 'text', payload: { text: 'died mid-answer' } }
    ])
    repo.setStatus(info.id, 'running')

    repo.markDanglingInterrupted()

    const history = repo.historyTail(course.id)
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
