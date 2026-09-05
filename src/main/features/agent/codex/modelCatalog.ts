import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliModel } from '../claude/modelProbe'
import { probeExec } from '../platform'

const PROBE_TIMEOUT_MS = 10_000

export const CODEX_FALLBACK_MODELS: readonly CliModel[] = [
  { value: 'default', displayName: 'Codex 기본 모델' }
]

function defaultOption(configuredModel: string | null): CliModel {
  return {
    value: 'default',
    displayName: configuredModel === null
      ? 'Codex 기본 모델'
      : `기본 (${configuredModel})`
  }
}

export function parseCodexModelCatalog(
  json: string,
  configuredModel: string | null = null
): CliModel[] {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return [...CODEX_FALLBACK_MODELS]
  }
  if (typeof value !== 'object' || value === null) {
    return [...CODEX_FALLBACK_MODELS]
  }
  const entries = (value as Record<string, unknown>)['models']
  if (!Array.isArray(entries)) return [...CODEX_FALLBACK_MODELS]

  const models: CliModel[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const model = entry as Record<string, unknown>
    if (
      model['visibility'] !== 'list' ||
      typeof model['slug'] !== 'string' ||
      typeof model['display_name'] !== 'string'
    ) {
      continue
    }
    models.push({
      value: model['slug'],
      displayName: model['display_name']
    })
  }
  return models.length === 0
    ? [...CODEX_FALLBACK_MODELS]
    : [defaultOption(configuredModel), ...models]
}

function configuredModel(configPath: string): string | null {
  try {
    const config = readFileSync(configPath, 'utf8')
    return /^\s*model\s*=\s*["']([^"']+)["']/mu.exec(config)?.[1] ?? null
  } catch {
    return null
  }
}

interface CodexModelProbeOptions {
  binaryPath: string
  configPath?: string
  env?: NodeJS.ProcessEnv
  exec?: typeof probeExec
}

export async function probeCodexModels(
  options: CodexModelProbeOptions
): Promise<CliModel[]> {
  try {
    const { stdout } = await (options.exec ?? probeExec)(
      options.binaryPath,
      ['debug', 'models'],
      {
        timeoutMs: PROBE_TIMEOUT_MS,
        ...(options.env === undefined ? {} : { env: options.env })
      }
    )
    return parseCodexModelCatalog(
      stdout,
      configuredModel(options.configPath ?? join(homedir(), '.codex', 'config.toml'))
    )
  } catch {
    return [...CODEX_FALLBACK_MODELS]
  }
}
