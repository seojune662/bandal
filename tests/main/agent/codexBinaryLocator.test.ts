import { describe, expect, test } from 'vitest'
import { createCodexBinaryLocator } from '../../../src/main/features/agent/codex/binaryLocator'

describe('Codex binary locator', () => {
  test('finds codex through the login-shell PATH and parses its version', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const locator = createCodexBinaryLocator({
      platform: 'darwin',
      env: {},
      exec: async (file, args) => {
        calls.push({ file, args })
        if (file === '/bin/zsh') {
          return { stdout: '/custom/bin', stderr: '' }
        }
        if (file === '/custom/bin/codex') {
          return { stdout: 'codex-cli 0.146.0', stderr: '' }
        }
        throw new Error('not found')
      }
    })
    await expect(locator.locate()).resolves.toEqual({
      path: '/custom/bin/codex',
      version: '0.146.0'
    })
    expect(calls).toContainEqual({
      file: '/bin/zsh',
      args: ['-lic', 'echo -n "$PATH"']
    })
  })

  test('recognizes the stderr login status used by Codex 0.146.0', async () => {
    const locator = createCodexBinaryLocator({
      platform: 'darwin',
      configuredPath: () => '/custom/codex',
      exec: async (file, args) => {
        if (file === '/custom/codex' && args[0] === '--version') {
          return { stdout: 'codex-cli 0.146.0', stderr: '' }
        }
        if (file === '/custom/codex' && args.join(' ') === 'login status') {
          return { stdout: '', stderr: 'Logged in using ChatGPT\n' }
        }
        throw new Error('not found')
      }
    })
    await expect(locator.availability()).resolves.toEqual({
      installed: true,
      version: '0.146.0',
      loggedIn: true,
      subscriptionType: 'ChatGPT'
    })
  })

  test('reports installed but logged out when status cannot be read', async () => {
    const locator = createCodexBinaryLocator({
      platform: 'darwin',
      configuredPath: () => '/custom/codex',
      exec: async (file, args) => {
        if (file === '/custom/codex' && args[0] === '--version') {
          return { stdout: 'codex-cli 0.146.0', stderr: '' }
        }
        throw new Error('not logged in')
      }
    })
    await expect(locator.availability()).resolves.toEqual({
      installed: true,
      version: '0.146.0',
      loggedIn: false
    })
  })
})
