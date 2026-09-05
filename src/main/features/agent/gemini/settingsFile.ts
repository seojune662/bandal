import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const GEMINI_SYSTEM_SETTINGS_ENV_VAR =
  'GEMINI_CLI_SYSTEM_SETTINGS_PATH'
export const GEMINI_MCP_TOKEN_ENV_VAR = 'BANDAL_MCP_TOKEN'

export const GEMINI_READ_ONLY_TOOLS = [
  'read_file',
  'read_many_files',
  'glob',
  'grep_search',
  'list_directory',
  'web_fetch',
  'google_web_search'
] as const

export interface GeminiMcpServerSettings {
  command?: string
  args?: string[]
  env?: Record<string, string>
  httpUrl?: string
  headers?: Record<string, string>
  trust: true
  timeout: number
}

interface GeminiSettingsOptions {
  userDataPath: string
  mcpHttp?: { url: string; token: string }
  externalServers?: Record<string, GeminiMcpServerSettings>
}

/** Rewrites Bandal's private, highest-priority Gemini settings before a turn. */
export function writeGeminiSettings(options: GeminiSettingsOptions): string {
  const directory = join(options.userDataPath, 'gemini')
  const settingsPath = join(directory, 'settings.json')
  const mcpServers: Record<string, GeminiMcpServerSettings> = {
    ...(options.externalServers ?? {})
  }
  if (options.mcpHttp !== undefined) {
    mcpServers['bandal'] = {
      httpUrl: options.mcpHttp.url,
      headers: {
        Authorization: `Bearer \${${GEMINI_MCP_TOKEN_ENV_VAR}}`
      },
      trust: true,
      timeout: 60_000
    }
  }
  const settings = {
    security: { folderTrust: { enabled: false } },
    mcpServers,
    tools: { core: [...GEMINI_READ_ONLY_TOOLS] }
  }

  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  writeFileSync(settingsPath, JSON.stringify(settings), {
    encoding: 'utf8',
    mode: 0o600
  })
  chmodSync(settingsPath, 0o600)
  return settingsPath
}
