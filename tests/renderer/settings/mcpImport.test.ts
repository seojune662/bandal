import { describe, expect, test } from 'vitest'
import { parseMcpConfigText } from '../../../src/renderer/src/features/settings/mcpImport'

describe('parseMcpConfigText', () => {
  test('parses a Claude Desktop stdio server with args and env', () => {
    const result = parseMcpConfigText(JSON.stringify({
      mcpServers: {
        Notion: {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_TOKEN: 'ntn_test' }
        }
      }
    }))

    expect(result.errors).toEqual([])
    expect(result.servers).toEqual([{
      name: 'notion',
      description: '',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: { NOTION_TOKEN: 'ntn_test' },
      enabled: true
    }])
  })

  test('parses a Cursor HTTP server with headers', () => {
    const result = parseMcpConfigText(JSON.stringify({
      mcpServers: {
        Campus: {
          url: 'https://tools.example.test/mcp',
          headers: { Authorization: 'Bearer test' }
        }
      }
    }))

    expect(result.errors).toEqual([])
    expect(result.servers[0]).toMatchObject({
      name: 'campus',
      transport: 'http',
      url: 'https://tools.example.test/mcp',
      headers: { Authorization: 'Bearer test' }
    })
  })

  test('parses every server in a multi-server configuration', () => {
    const result = parseMcpConfigText(JSON.stringify({
      mcpServers: {
        files: { command: 'npx', args: ['server-filesystem', '/course'] },
        fetch: { command: 'uvx', args: ['mcp-server-fetch'] },
        remote: { url: 'http://localhost:3333/mcp' }
      }
    }))

    expect(result.errors).toEqual([])
    expect(result.servers.map((server) => server.name)).toEqual([
      'files',
      'fetch',
      'remote'
    ])
  })

  test('normalizes names to lowercase hyphens and resolves collisions', () => {
    const result = parseMcpConfigText(JSON.stringify({
      mcpServers: {
        'My Server': { command: 'one' },
        my_server: { command: 'two' },
        '한글 서버': { command: 'three' }
      }
    }))

    expect(result.errors).toEqual([])
    expect(result.servers.map((server) => server.name)).toEqual([
      'my-server',
      'my-server-2',
      'mcp-server-3'
    ])
  })

  test('caps normalized names at the shared 32-character limit', () => {
    const result = parseMcpConfigText(JSON.stringify({
      mcpServers: { ['A'.repeat(50)]: { command: 'node' } }
    }))

    expect(result.errors).toEqual([])
    expect(result.servers[0]?.name).toBe('a'.repeat(32))
  })

  test('reports malformed JSON without throwing', () => {
    const result = parseMcpConfigText('{ "mcpServers": ')

    expect(result.servers).toEqual([])
    expect(result.errors[0]).toMatch(/^Invalid JSON:/)
  })

  test('requires the mcpServers wrapper object', () => {
    const result = parseMcpConfigText('{"server":{"command":"node"}}')

    expect(result.servers).toEqual([])
    expect(result.errors).toEqual([
      'The configuration must contain an mcpServers object.'
    ])
  })

  test('keeps valid servers while reporting malformed server entries', () => {
    const result = parseMcpConfigText(JSON.stringify({
      mcpServers: {
        good: { command: 'node', args: ['server.js'] },
        badArgs: { command: 'node', args: '--serve' },
        badUrl: { url: 'file:///tmp/server.sock' }
      }
    }))

    expect(result.servers.map((server) => server.name)).toEqual(['good'])
    expect(result.errors).toHaveLength(2)
    expect(result.errors.join(' ')).toContain('args must be an array')
    expect(result.errors.join(' ')).toContain('HTTP or HTTPS')
  })

  test('rejects configurations that specify command and url together', () => {
    const result = parseMcpConfigText(JSON.stringify({
      mcpServers: {
        ambiguous: { command: 'node', url: 'https://example.test/mcp' }
      }
    }))

    expect(result.servers).toEqual([])
    expect(result.errors[0]).toContain('either command or url')
  })
})
