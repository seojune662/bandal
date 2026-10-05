import { expect, test } from 'vitest'
import { buildCodexArgs, CODEX_CAPABILITIES } from '../../../src/main/features/agent/codex/CodexAdapter'
test('uses bidirectional App Server and keeps MCP credentials out of argv', () => {
  const args = buildCodexArgs({ mcpUrl: 'http://127.0.0.1:3000/mcp', mcpExtraArgs: ['-c', 'custom=true'] })
  expect(args.slice(0, 3)).toEqual(['app-server', '--listen', 'stdio://'])
  expect(args.join(' ')).toContain('BANDAL_MCP_TOKEN')
  expect(args.join(' ')).toContain('tool_timeout_sec=300')
  expect(CODEX_CAPABILITIES).toMatchObject({ interactivePermissions: true, imageInput: true, resume: true })
})
test('enables native live search only when the isolated session requests it', () => {
  expect(buildCodexArgs({})).toEqual(['app-server', '--listen', 'stdio://'])
  expect(buildCodexArgs({ webSearch: 'live', mcpExtraArgs: ['-c', 'web_search="disabled"'] }).slice(-2)).toEqual(['-c', 'web_search="live"'])
})
