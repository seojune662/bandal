import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createGeminiBinaryLocator } from '../../../src/main/features/agent/gemini/binaryLocator'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('Gemini binary locator', () => {
  let ctx: TestDb

  afterEach(() => ctx?.cleanup())

  test('parses a plain version and reads the active OAuth account', async () => {
    ctx = createTestDb()
    const binary = join(ctx.dir, 'gemini')
    const geminiDir = join(ctx.dir, '.gemini')
    writeFileSync(binary, '')
    mkdirSync(geminiDir)
    writeFileSync(join(geminiDir, 'oauth_creds.json'), '{}')
    writeFileSync(
      join(geminiDir, 'google_accounts.json'),
      JSON.stringify({ active: 'student@example.com', old: [] })
    )
    const locator = createGeminiBinaryLocator({
      configuredPath: () => binary,
      env: { GEMINI_CLI_HOME: ctx.dir },
      platform: 'darwin',
      exec: async (file) => file === '/bin/zsh'
        ? { stdout: '/usr/bin', stderr: '' }
        : { stdout: '0.58.0\n', stderr: '' }
    })

    await expect(locator.locate()).resolves.toEqual({
      path: binary,
      version: '0.58.0'
    })
    await expect(locator.availability()).resolves.toMatchObject({
      installed: true,
      loggedIn: true,
      accountEmail: 'student@example.com'
    })
  })
})
