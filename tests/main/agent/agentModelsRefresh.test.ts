import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ locate: vi.fn(), reset: vi.fn(), discover: vi.fn() }))
vi.mock('../../../src/main/features/agent/codex/binaryLocator', () => ({ createCodexBinaryLocator: () => ({ locate: mocks.locate, reset: mocks.reset, loginShellPath: async () => '' }) }))
vi.mock('../../../src/main/features/agent/codex/modelCatalog', () => ({ CODEX_FALLBACK_MODELS: [{ value: 'default', displayName: 'Default' }], discoverCodexModels: mocks.discover }))
import { getAgentModels, rejectAgentModel, resolveLearningAi, validateLearningAi } from '../../../src/main/features/agent/agentModels'

describe('refreshable connected model candidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.locate.mockResolvedValue({ path: '/codex' })
    mocks.discover.mockResolvedValue({ models: [{ value: 'default', displayName: 'Default' }], source: 'fallback', status: 'unavailable' })
  })
  test('refresh replaces failed discovery and a real rejection without changing AI configuration', async () => {
    expect((await getAgentModels('codex', true)).status).toBe('unavailable')
    mocks.discover.mockResolvedValue({ models: [{ value: 'gpt-5.5', displayName: 'GPT-5.5', supportedEfforts: ['medium', 'high'], defaultEffort: 'high' }], source: 'live', status: 'ready' })
    expect((await getAgentModels('codex')).status).toBe('unavailable')
    expect((await getAgentModels('codex', true)).status).toBe('ready')
    rejectAgentModel('codex', 'gpt-5.5')
    await expect(validateLearningAi({ provider: 'codex', model: 'gpt-5.5', effort: 'high' })).rejects.toThrow('다시 선택')
    expect((await getAgentModels('codex')).blockedModelIds).toEqual(['gpt-5.5'])
    await getAgentModels('codex', true)
    await expect(validateLearningAi({ provider: 'codex', model: 'gpt-5.5', effort: 'high' })).resolves.toMatchObject({ model: 'gpt-5.5' })
    await expect(resolveLearningAi({ provider: 'codex', model: 'gpt-5.5', effort: null })).resolves.toEqual({ provider: 'codex', model: 'gpt-5.5', effort: 'high' })
    await expect(validateLearningAi({ provider: 'codex', model: 'default', effort: null })).rejects.toThrow('직접 선택')
    await expect(validateLearningAi({ provider: 'codex', model: 'gpt-5.5', effort: 'ultra' })).rejects.toThrow('사고 수준')
    expect(mocks.reset).toHaveBeenCalledTimes(3)
  })
})
