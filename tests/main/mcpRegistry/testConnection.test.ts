import { describe, expect, test } from 'vitest'
import type { McpServerConfig } from '../../../src/shared/types/mcp'
import { testMcpServer } from '../../../src/main/features/mcpRegistry'

describe('MCP connection test', () => {
  test('returns a timed result when a stdio command does not exist', async () => {
    const config: McpServerConfig = {
      id: 'missing-command',
      name: 'missing',
      description: '',
      transport: 'stdio',
      command: `/definitely-not-installed-bandal-mcp-${process.pid}`,
      env: { PRIVATE_TOKEN: 'must-not-appear' },
      enabled: true,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z'
    }

    const result = await testMcpServer(config, { timeoutMs: 250 })

    expect(result.ok).toBe(false)
    expect(result.tools).toEqual([])
    expect(result.error).toEqual(expect.any(String))
    expect(result.error).not.toContain('must-not-appear')
    expect(result.durationMs).toEqual(expect.any(Number))
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})
