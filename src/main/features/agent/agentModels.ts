import type { AgentProvider } from '../../../shared/types/agent-events'
import type { AgentModelOption } from '../../../shared/types/chat'
import { createBinaryLocator } from './binaryLocator'
import { FALLBACK_MODELS, probeModels, type CliModel } from './claude/modelProbe'

const locator = createBinaryLocator()
const CODEX_MODELS: readonly CliModel[] = [
  { value: 'default', displayName: 'Codex 기본 모델' }
]
const modelCache = new Map<
  AgentProvider,
  Promise<{ models: AgentModelOption[] }>
>()

function toOptions(models: readonly CliModel[]): AgentModelOption[] {
  return models.map((model) => ({
    id: model.value,
    displayName: model.displayName,
    isDefault: model.value === 'default'
  }))
}

const fallbackResult = (): { models: AgentModelOption[] } => ({
  models: toOptions(FALLBACK_MODELS)
})

async function discoverModels(
  provider: AgentProvider
): Promise<{ models: AgentModelOption[] }> {
  if (provider !== 'claude-code') {
    // Codex chooses the account's current default model when -m is omitted.
    // The exec JSONL protocol does not expose a model catalog.
    return { models: toOptions(CODEX_MODELS) }
  }
  try {
    const binary = await locator.locate()
    const models = await probeModels({ binaryPath: binary.path })
    return { models: toOptions(models) }
  } catch {
    return fallbackResult()
  }
}

/** Process-lifetime cached model discovery. This function never rejects. */
export function getAgentModels(
  provider: AgentProvider
): Promise<{ models: AgentModelOption[] }> {
  const cached = modelCache.get(provider)
  if (cached !== undefined) {
    return cached
  }
  const pending = discoverModels(provider).catch(() => fallbackResult())
  modelCache.set(provider, pending)
  return pending
}
