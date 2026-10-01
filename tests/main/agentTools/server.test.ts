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
import type { McpServerConfig } from '../../../src/shared/types/mcp'
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
    const userMcpServers: McpServerConfig[] = [
      {
        id: 'docs-id',
        name: 'docs',
        description: '문서 검색',
        transport: 'http',
        url: 'https://mcp.example/docs',
        headers: { Authorization: 'Bearer user-secret' },
        enabled: true,
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z'
      }
    ]
    try {
      handle = await startAgentToolsServer({
        sessionId: 'session-1',
        userDataPath,
        userMcpServers,
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
      mcpServers: Record<string, unknown> & {
        bandal: { url: string; headers: { Authorization: string } }
      }
    }
    expect(config.mcpServers.bandal.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(config.mcpServers.bandal.headers.Authorization).toMatch(/^Bearer \S+$/)
    expect(config.mcpServers.docs).toMatchObject({
      type: 'http',
      url: 'https://mcp.example/docs',
      headers: { Authorization: 'Bearer user-secret' }
    })
    expect(handle.extraAllowedTools).toContain('mcp__bandal__add_shapes')
    expect(handle.extraAllowedTools).toContain('mcp__docs')
    expect(handle.extraEnv).toEqual({
      BANDAL_MCP_DOCS_TOKEN: 'user-secret'
    })
    expect(handle.codexOverrides).toEqual(
      expect.arrayContaining([
        '-c',
        'mcp_servers.docs.url="https://mcp.example/docs"',
        'mcp_servers.docs.bearer_token_env_var="BANDAL_MCP_DOCS_TOKEN"'
      ])
    )
    expect(handle.mcpHint).toContain(
      '등록된 외부 도구 서버: docs — 문서 검색'
    )
    expect(JSON.stringify(handle.codexOverrides)).not.toContain('user-secret')
    expect(handle.geminiMcpServers).toEqual({
      docs: {
        httpUrl: 'https://mcp.example/docs',
        headers: { Authorization: 'Bearer user-secret' },
        trust: true,
        timeout: 300_000
      }
    })

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
    const listing = await listed.text()
    expect(listing).toContain('list_courses')
    expect(listing).toContain('"readOnlyHint":false')
    const call = async (name: string): Promise<string> => {
      const response = await fetch(config.mcpServers.bandal.url, {
        method: 'POST', headers: { ...headers, 'mcp-session-id': mcpSessionId as string },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_course', arguments: { name } } })
      })
      expect(response.status).toBe(200)
      return response.text()
    }
    expect(await call('One execution')).toContain('One execution')
    expect(await call('Must not execute a replay')).toContain('One execution')
    expect(coursesRepo.list({ includeArchived: true }).map(course => course.name)).toEqual(['MCP', 'One execution'])

    await handle.close()
    expect(existsSync(handle.mcpConfigPath)).toBe(false)
  })
})
