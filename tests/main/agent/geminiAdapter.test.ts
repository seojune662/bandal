import { expect, test } from 'vitest'
import { buildGeminiArgs } from '../../../src/main/features/agent/gemini/GeminiAdapter'
test('uses ACP instead of discarding image inputs in headless prompts', () => {
  expect(buildGeminiArgs({ model: 'gemini-3-pro' })).toEqual(['--acp', '-m', 'gemini-3-pro'])
  expect(buildGeminiArgs({})).toEqual(['--acp'])
})

test('isolates concurrent session settings and removes only the disposed session files', async () => {
  const { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { createGeminiAdapter } = await import('../../../src/main/features/agent/gemini/GeminiAdapter')
  const directory = mkdtempSync(join(tmpdir(), 'bandal-gemini-isolation-'))
  const adapter = createGeminiAdapter({ userDataPath: directory, apiKey: () => 'private-key', locator: { reset() {}, availability: async () => ({ installed: true, loggedIn: true, version: '0.58.0' }), locate: async () => ({ path: '/mock/gemini', version: '0.58.0' }), loginShellPath: async () => '/usr/bin' } as any })
  try {
    const a = await adapter.startSession({ courseId: 'a', cwd: directory, mcpHttp: { url: 'http://localhost:1001/mcp', token: 'secret-a' } })
    const first = readdirSync(join(directory, 'gemini-sessions'))[0]!
    const b = await adapter.startSession({ courseId: 'b', cwd: directory, mcpHttp: { url: 'http://localhost:1002/mcp', token: 'secret-b' } })
    const dirs = readdirSync(join(directory, 'gemini-sessions'))
    expect(dirs).toHaveLength(2)
    const contents = dirs.map(d => readFileSync(join(directory, 'gemini-sessions', d, 'gemini/settings.json'), 'utf8'))
    expect(contents.some(s => s.includes('1001/mcp'))).toBe(true)
    expect(contents.some(s => s.includes('1002/mcp'))).toBe(true)
    expect(contents.join('')).not.toMatch(/private-key|secret-a|secret-b/)
    a.dispose()
    expect(existsSync(join(directory, 'gemini-sessions', first))).toBe(false)
    expect(readdirSync(join(directory, 'gemini-sessions'))).toHaveLength(1)
    b.dispose()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
