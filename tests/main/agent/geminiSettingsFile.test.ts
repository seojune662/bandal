import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  GEMINI_READ_ONLY_TOOLS,
  writeGeminiSettings
} from '../../../src/main/features/agent/gemini/settingsFile'
import { createTestDb, type TestDb } from '../helpers/testDb'

describe('Gemini managed settings', () => {
  let ctx: TestDb

  afterEach(() => ctx?.cleanup())

  test('writes trusted MCP servers without putting the Bandal token on disk', () => {
    ctx = createTestDb()
    const userDataPath = join(ctx.dir, 'user-data')
    mkdirSync(userDataPath)
    const path = writeGeminiSettings({
      userDataPath,
      mcpHttp: { url: 'http://127.0.0.1:1234/mcp', token: 'raw-secret' },
      externalServers: {
        docs: {
          httpUrl: 'https://mcp.example/docs',
          trust: true,
          timeout: 60_000
        }
      }
    })
    const raw = readFileSync(path, 'utf8')
    const settings = JSON.parse(raw) as {
      security: { folderTrust: { enabled: boolean } }
      tools: { core: string[] }
      mcpServers: Record<string, { headers?: Record<string, string>; trust: boolean }>
    }

    expect(path).toBe(join(userDataPath, 'gemini', 'settings.json'))
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(settings.security.folderTrust.enabled).toBe(false)
    expect(settings.tools.core).toEqual([...GEMINI_READ_ONLY_TOOLS])
    expect(settings.mcpServers['bandal']).toMatchObject({
      headers: { Authorization: 'Bearer ${BANDAL_MCP_TOKEN}' },
      trust: true
    })
    expect(settings.mcpServers['docs']?.trust).toBe(true)
    expect(raw).not.toContain('raw-secret')
  })
})
