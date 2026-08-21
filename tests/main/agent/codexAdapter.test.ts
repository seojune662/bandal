import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, test, vi } from 'vitest'
import {
  buildCodexArgs,
  createCodexAdapter
} from '../../../src/main/features/agent/codex/CodexAdapter'
import type { BinaryLocator } from '../../../src/main/features/agent/binaryLocator'

describe('buildCodexArgs', () => {
  test('fixes workspace-write and puts the prompt in argv', () => {
    expect(
      buildCodexArgs({ cwd: '/course', prompt: 'say hi' })
    ).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-C',
      '/course',
      '-s',
      'workspace-write',
      'say hi'
    ])
  })

  test('uses the resume subcommand and never widens the sandbox', () => {
    const args = buildCodexArgs({
      cwd: '/course',
      prompt: 'next',
      model: 'gpt-5',
      resumeCliSessionId: 'thread-1'
    })
    expect(args).toContain('workspace-write')
    expect(args).not.toContain('danger-full-access')
    expect(args.slice(-3)).toEqual(['resume', 'thread-1', 'next'])
  })

  test('appends user MCP overrides to the -c sequence before the turn args', () => {
    const args = buildCodexArgs({
      cwd: '/course',
      prompt: 'next',
      model: 'gpt-5',
      resumeCliSessionId: 'thread-1',
      mcpUrl: 'http://127.0.0.1:1234/mcp',
      mcpExtraArgs: [
        '-c',
        'mcp_servers.docs.url="https://mcp.example/docs"'
      ]
    })

    expect(args.slice(7, 13)).toEqual([
      '-c',
      'mcp_servers.bandal.url="http://127.0.0.1:1234/mcp"',
      '-c',
      'mcp_servers.bandal.bearer_token_env_var="BANDAL_MCP_TOKEN"',
      '-c',
      'mcp_servers.docs.url="https://mcp.example/docs"'
    ])
    expect(args.indexOf('mcp_servers.docs.url="https://mcp.example/docs"'))
      .toBeLessThan(args.indexOf('-m'))
  })
})

describe('createCodexAdapter', () => {
  test('closes stdin and spawns one process per turn', async () => {
    const children: Array<EventEmitter & Partial<ChildProcess>> = []
    const spawnImpl = vi.fn((_file, _args, _opts) => {
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
      locate: async () => ({ path: '/bin/codex', version: '0.146.0' }),
      availability: async () => ({ installed: true, loggedIn: true }),
      loginShellPath: async () => '/bin',
      reset: () => undefined
    }
    const adapter = createCodexAdapter({ locator, spawnImpl })
    const session = await adapter.startSession({
      courseId: 'course',
      cwd: '/course',
      mcpExtraArgs: [
        '-c',
        'mcp_servers.docs.url="https://mcp.example/docs"'
      ],
      mcpExtraEnv: { BANDAL_MCP_DOCS_TOKEN: 'user-secret' }
    })

    session.sendMessage('one')
    const firstCall = spawnImpl.mock.calls[0]
    expect(firstCall?.[2]?.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect(firstCall?.[1]).toEqual(
      expect.arrayContaining([
        '-c',
        'mcp_servers.docs.url="https://mcp.example/docs"'
      ])
    )
    expect(firstCall?.[2]?.env).toMatchObject({
      BANDAL_MCP_DOCS_TOKEN: 'user-secret'
    })
    expect(JSON.stringify(firstCall?.[1])).not.toContain('user-secret')
    ;(children[0]?.stdout as PassThrough).write(
      '{"type":"thread.started","thread_id":"thread-1"}\n' +
        '{"type":"turn.started"}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n'
    )
    children[0]?.emit('close', 0, null)
    await expect(session.sessionId).resolves.toBe('thread-1')

    session.sendMessage('two')
    expect(spawnImpl).toHaveBeenCalledTimes(2)
    expect(spawnImpl.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(['resume', 'thread-1', 'two'])
    )
    session.dispose()
  })
})
