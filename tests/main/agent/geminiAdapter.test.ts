import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  buildGeminiArgs,
  createGeminiAdapter
} from '../../../src/main/features/agent/gemini/GeminiAdapter'
import type { BinaryLocator } from '../../../src/main/features/agent/binaryLocator'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('Gemini adapter', () => {
  let ctx: TestDb

  afterEach(() => ctx?.cleanup())

  test('builds new and resumed headless arguments', () => {
    expect(buildGeminiArgs({
      prompt: 'hi',
      sessionId: 'session-1',
      resume: false,
      model: 'flash'
    })).toEqual([
      '-p', 'hi', '-o', 'stream-json', '--session-id', 'session-1', '-m', 'flash'
    ])
    expect(buildGeminiArgs({
      prompt: 'again',
      sessionId: 'session-1',
      resume: true,
      model: 'auto'
    })).toEqual([
      '-p', 'again', '-o', 'stream-json', '--resume', 'session-1', '-m', 'auto'
    ])
  })

  test('closes stdin, writes private settings and resumes the reported id', async () => {
    ctx = createTestDb()
    const userDataPath = join(ctx.dir, 'user-data')
    mkdirSync(userDataPath)
    const children: Array<EventEmitter & Partial<ChildProcess>> = []
    const spawnImpl = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        pid: undefined,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: null
      }) as EventEmitter & Partial<ChildProcess>
      children.push(child)
      return child as ChildProcess
    })
    const locator: BinaryLocator = {
      locate: async () => ({ path: '/bin/gemini', version: '0.58.0' }),
      availability: async () => ({ installed: true, loggedIn: true }),
      loginShellPath: async () => '/bin',
      reset: () => undefined
    }
    const adapter = createGeminiAdapter({ userDataPath, locator, spawnImpl })
    const session = await adapter.startSession({
      courseId: 'course',
      cwd: '/course',
      model: 'flash',
      systemPromptAppend: 'system context',
      mcpHttp: { url: 'http://127.0.0.1:1234/mcp', token: 'secret' }
    })

    session.sendMessage('one', [{ mediaType: 'image/png', dataBase64: 'AA==' }])
    const first = spawnImpl.mock.calls[0]
    expect(first?.[2]?.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect(first?.[1]).toEqual(expect.arrayContaining([
      '-p',
      expect.stringContaining('[첨부 이미지 1개는 이 제공자에서 지원되지 않음]'),
      '--session-id',
      expect.any(String),
      '-m',
      'flash'
    ]))
    const settingsPath = join(userDataPath, 'gemini', 'settings.json')
    expect(first?.[2]?.env).toMatchObject({
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath,
      BANDAL_MCP_TOKEN: 'secret'
    })
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600)
    expect(readFileSync(settingsPath, 'utf8')).toContain(
      'Bearer ${BANDAL_MCP_TOKEN}'
    )

    ;(children[0]?.stdout as PassThrough).write(
      '{"type":"init","session_id":"actual-session","model":"flash"}\n' +
      '{"type":"result","status":"success","stats":{"input_tokens":1,"output_tokens":1}}\n'
    )
    children[0]?.emit('close', 0, null)
    await expect(session.sessionId).resolves.toBe('actual-session')

    session.sendMessage('two')
    expect(spawnImpl.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      '--resume', 'actual-session'
    ]))
    session.dispose()
  })
})
