import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createLoginBrowserBridge, isProviderLoginUrl } from '../../../src/main/features/agent/loginBrowserBridge'

const run = promisify(execFile)
describe('provider login URL validation', () => {
  test.each([
    ['codex', 'https://auth.openai.com/oauth/authorize?state=s', true],
    ['codex', 'https://chatgpt.com/auth/login?state=s', true],
    ['claude-code', 'https://claude.ai/oauth/authorize?state=s', true],
    ['claude-code', 'https://claude.com/cai/oauth/authorize?state=s', true],
    ['claude-code', 'https://console.anthropic.com/oauth/authorize', true],
    ['codex', 'https://auth.openai.com.evil.test/oauth/authorize', false],
    ['codex', 'https://secret@auth.openai.com/oauth/authorize', false],
    ['codex', 'http://auth.openai.com/oauth/authorize', false],
    ['claude-code', 'javascript:alert(1)', false],
    ['claude-code', 'https://claude.ai/oauth/authorize'.padEnd(17000, 'a'), false],
    ['codex', 'https://auth.openai.com:8080/oauth/authorize', false]
  ] as const)('%s %s => %s', (provider, url, result) => expect(isProviderLoginUrl(provider, url)).toBe(result))
})

test.skipIf(process.platform === 'win32')('real browser helper relays URL in memory and removes its files', async () => {
  const urls: string[] = []
  const url = 'https://claude.com/cai/oauth/authorize?state=private-test-value&code_challenge=challenge&redirect_uri=http%3A%2F%2Flocalhost%3A3333%2Fcallback'
  const bridge = await createLoginBrowserBridge(value => urls.push(value))
  const directory = dirname(bridge.browserPath)
  try {
    await run(bridge.browserPath, [url])
    expect(urls).toEqual([url])
    const helper = await readFile(join(directory, 'browser.cjs'), 'utf8')
    const wrapper = await readFile(bridge.browserPath, 'utf8')
    expect(helper + wrapper).not.toContain('private-test-value')
    expect(helper + wrapper).not.toContain('code_challenge')
    await expect(run(bridge.browserPath, ['https://evil.test/oauth/authorize'])).rejects.toThrow()
    expect(urls).toHaveLength(1)
  } finally { await bridge.dispose() }
  await expect(access(directory)).rejects.toThrow()
})

test('Windows wrapper uses the bundled executable without global Node', async () => {
  const bridge = await createLoginBrowserBridge(() => undefined, { platform: 'win32', executable: 'C:\\Program Files\\Bandal\\Bandal.exe' })
  try {
    const wrapper = await readFile(bridge.browserPath, 'utf8')
    expect(wrapper).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(wrapper).toContain('"C:\\Program Files\\Bandal\\Bandal.exe"')
    expect(wrapper).not.toContain('node.exe')
  } finally { await bridge.dispose() }
})
