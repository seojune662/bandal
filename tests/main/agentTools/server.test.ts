import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createBoardRepo } from '../../../src/main/features/board/boardRepo'
import { createCanvasRepo } from '../../../src/main/features/canvas/canvasRepo'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { createMaterialsRepo } from '../../../src/main/features/materials/materialsRepo'
import { createNotesRepo } from '../../../src/main/features/notes/notesRepo'
import {
  startAgentToolsServer,
  type AgentToolsServerHandle
} from '../../../src/main/features/agentTools/server'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('agent tools MCP server', () => {
  let ctx: TestDb | undefined
  let handle: AgentToolsServerHandle | undefined

  afterEach(async () => {
    await handle?.close()
    ctx?.cleanup()
    handle = undefined
    ctx = undefined
  })

  test('writes a private loopback config and serves stateful MCP sessions', async () => {
    ctx = createTestDb()
    const dataRoot = join(ctx.dir, 'courses')
    const userDataPath = join(ctx.dir, 'user-data')
    mkdirSync(dataRoot)
    const coursesRepo = createCoursesRepo({ db: ctx.db, getDataRoot: () => dataRoot })
    const course = coursesRepo.create({ name: 'MCP', color: 'blue' })
    const materialsRepo = createMaterialsRepo({
      db: ctx.db,
      getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
      revealItem: () => undefined,
      trashItem: async () => undefined
    })
    const notesRepo = createNotesRepo({
      getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
    })
    try {
      handle = await startAgentToolsServer({
        sessionId: 'session-1',
        userDataPath,
        deps: {
          courseId: course.id,
          getTurnId: () => 'turn-1',
          coursesRepo,
          materialsRepo,
          notesRepo,
          boardRepo: createBoardRepo(ctx.db),
          canvasRepo: createCanvasRepo(ctx.db),
          confirm: async () => false,
          journal: { record: () => undefined }
        }
      })
    } catch (error) {
      // Some managed test sandboxes prohibit even loopback listen(2). The
      // complete handshake still runs in ordinary Node/CI environments.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    expect(handle.mcpConfigPath).toBe(join(userDataPath, 'mcp', 'session-1.json'))
    expect(statSync(handle.mcpConfigPath).mode & 0o777).toBe(0o600)
    const config = JSON.parse(readFileSync(handle.mcpConfigPath, 'utf8')) as {
      mcpServers: {
        bandal: { url: string; headers: { Authorization: string } }
      }
    }
    expect(config.mcpServers.bandal.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(config.mcpServers.bandal.headers.Authorization).toMatch(/^Bearer \S+$/)
    expect(handle.allowedTools).toContain('mcp__bandal__add_shapes')

    const unauthorized = await fetch(config.mcpServers.bandal.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    })
    expect(unauthorized.status).toBe(401)

    const headers = {
      accept: 'application/json, text/event-stream',
      authorization: config.mcpServers.bandal.headers.Authorization,
      'content-type': 'application/json'
    }
    const initialized = await fetch(config.mcpServers.bandal.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'bandal-test', version: '1.0.0' }
        }
      })
    })
    const mcpSessionId = initialized.headers.get('mcp-session-id')
    expect(initialized.status).toBe(200)
    expect(mcpSessionId).toBeTruthy()

    const listed = await fetch(config.mcpServers.bandal.url, {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': mcpSessionId as string },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    })
    expect(listed.status).toBe(200)
    expect(await listed.text()).toContain('list_courses')

    await handle.close()
    expect(existsSync(handle.mcpConfigPath)).toBe(false)
  })
})
