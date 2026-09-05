import type { AgentProvider } from '../../../shared/types/agent-events'
import type { AgentModelOption } from '../../../shared/types/chat'
import { createBinaryLocator } from './binaryLocator'
import { FALLBACK_MODELS, probeModels, type CliModel } from './claude/modelProbe'
import { createCodexBinaryLocator } from './codex/binaryLocator'
import {
  CODEX_FALLBACK_MODELS,
  probeCodexModels
} from './codex/modelCatalog'
import { augmentedPathEnv } from './platform'

const locator = createBinaryLocator()
const codexLocator = createCodexBinaryLocator()
const GEMINI_MODELS: readonly CliModel[] = [
  { value: 'auto', displayName: 'Gemini 자동 선택' },
  { value: 'pro', displayName: 'Gemini Pro' },
  { value: 'flash', displayName: 'Gemini Flash' },
  { value: 'flash-lite', displayName: 'Gemini Flash Lite' }
]
const modelCache = new Map<
  AgentProvider,
  Promise<{ models: AgentModelOption[] }>
>()

function toOptions(models: readonly CliModel[]): AgentModelOption[] {
  return models.map((model) => ({
    id: model.value,
    displayName: model.displayName,
    isDefault: model.value === 'default' || model.value === 'auto'
  }))
}

const fallbackResult = (
  provider: AgentProvider
): { models: AgentModelOption[] } => ({
  models: toOptions(
    provider === 'codex'
      ? CODEX_FALLBACK_MODELS
      : provider === 'gemini'
        ? GEMINI_MODELS
        : FALLBACK_MODELS
  )
})

async function discoverModels(
  provider: AgentProvider
): Promise<{ models: AgentModelOption[] }> {
  if (provider === 'gemini') {
    return { models: toOptions(GEMINI_MODELS) }
  }
  if (provider === 'codex') {
    const binary = await codexLocator.locate()
    const loginPath = await codexLocator.loginShellPath()
    return {
      models: toOptions(await probeCodexModels({
        binaryPath: binary.path,
        env: augmentedPathEnv(binary.path, loginPath)
      }))
    }
  }
  try {
    const binary = await locator.locate()
    const models = await probeModels({ binaryPath: binary.path })
    return { models: toOptions(models) }
  } catch {
    return fallbackResult(provider)
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
  const pending = discoverModels(provider).catch(() => fallbackResult(provider))
  modelCache.set(provider, pending)
  return pending
}
