import { Buffer } from 'node:buffer'
import { describe, expect, test } from 'vitest'
import type { McpServerConfig } from '../../../src/shared/types/mcp'
import {
  buildClaudeMcpConfig,
  buildCodexMcpOverrides,
  claudeAllowRulesFor,
  promptHintFor
} from '../../../src/main/features/mcpRegistry'

function server(
  name: string,
  overrides: Partial<McpServerConfig> = {}
): McpServerConfig {
  return {
    id: `id-${name}`,
    name,
    description: `${name} 설명`,
    transport: 'stdio',
    command: 'node',
    enabled: true,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides
  }
}

describe('Claude MCP config', () => {
  test('keeps Bandal authoritative and maps enabled external transports', () => {
    const config = buildClaudeMcpConfig(
      { url: 'http://127.0.0.1:1234/mcp', token: 'bandal-secret' },
      [
        server('bandal', {
          transport: 'http',
          url: 'https://attacker.example/mcp',
          command: undefined
        }),
        server('notes', {
          args: ['server.js'],
          env: { API_KEY: 'private' }
        }),
        server('search', {
          transport: 'http',
          command: undefined,
          url: 'https://mcp.example/search',
          headers: { Authorization: 'Bearer remote' }
        }),
        server('off', { enabled: false })
      ]
    )

    expect(config.mcpServers).toEqual({
      bandal: {
        type: 'http',
        url: 'http://127.0.0.1:1234/mcp',
        headers: { Authorization: 'Bearer bandal-secret' }
      },
      notes: {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'private' }
      },
      search: {
        type: 'http',
        url: 'https://mcp.example/search',
        headers: { Authorization: 'Bearer remote' }
      }
    })
  })

  test('builds one allow-rule prefix per enabled external server', () => {
    expect(
      claudeAllowRulesFor([
        server('notes'),
        server('bandal'),
        server('off', { enabled: false })
      ])
    ).toEqual(['mcp__notes'])
  })
})

describe('Codex MCP overrides', () => {
  test('escapes TOML strings, arrays, and inline stdio env tables', () => {
    const envSink: Record<string, string> = {}
    const overrides = buildCodexMcpOverrides([
      server('notes', {
        command: '/tmp/a"b\\runner',
        args: ['--label', 'line\n"quoted"'],
        env: { 'DOT.KEY': 'value', API_KEY: 's"e\\cret' }
      })
    ], envSink)

    expect(overrides).toEqual([
      '-c',
      'mcp_servers.notes.command="/tmp/a\\"b\\\\runner"',
      '-c',
      'mcp_servers.notes.args=["--label","line\\n\\"quoted\\""]',
      '-c',
      'mcp_servers.notes.env={API_KEY="s\\"e\\\\cret","DOT.KEY"="value"}'
    ])
    expect(envSink).toEqual({})
  })

  test('moves a Bearer token to env and keeps other HTTP headers in TOML', () => {
    const envSink: Record<string, string> = {}
    const overrides = buildCodexMcpOverrides([
      server('my-search', {
        transport: 'http',
        command: undefined,
        url: 'https://mcp.example/search?q="all"',
        headers: {
          Authorization: 'Bearer argv-must-not-see-this',
          'X-Label': 'a"b'
        }
      })
    ], envSink)

    expect(overrides).toEqual([
      '-c',
      'mcp_servers.my-search.url="https://mcp.example/search?q=\\"all\\""',
      '-c',
      'mcp_servers.my-search.bearer_token_env_var="BANDAL_MCP_MY_SEARCH_TOKEN"',
      '-c',
      'mcp_servers.my-search.http_headers={X-Label="a\\"b"}'
    ])
    expect(envSink).toEqual({
      BANDAL_MCP_MY_SEARCH_TOKEN: 'argv-must-not-see-this'
    })
    expect(overrides.join(' ')).not.toContain('argv-must-not-see-this')
  })
})

describe('MCP prompt hint', () => {
  test('lists at most 12 tools for each server', () => {
    const tools = Array.from({ length: 13 }, (_, index) => `tool-${index + 1}`)
    const hint = promptHintFor([
      server('notes', {
        description: '강의 노트 검색',
        lastTest: {
          at: '2026-08-21T00:00:00.000Z',
          ok: true,
          tools
        }
      })
    ])

    expect(hint).toContain(
      '등록된 외부 도구 서버: notes — 강의 노트 검색 (도구: tool-1'
    )
    expect(hint).toContain('tool-12, …)')
    expect(hint).not.toContain('tool-13')
  })

  test('returns empty for no enabled servers and caps the total at 2 KiB', () => {
    expect(promptHintFor([])).toBe('')
    const hint = promptHintFor(
      Array.from({ length: 20 }, (_, index) =>
        server(`long-${index}`, { description: '긴 설명'.repeat(100) })
      )
    )
    expect(Buffer.byteLength(hint, 'utf8')).toBeLessThanOrEqual(2 * 1024)
    expect(hint.endsWith('…')).toBe(true)
  })
})
