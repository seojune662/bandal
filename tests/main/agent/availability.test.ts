import { describe, expect, test, vi } from 'vitest'
import { checkAgentAvailability, createAgentAvailabilityService } from '../../../src/main/features/agent/availability'
import type { BinaryLocator } from '../../../src/main/features/agent/binaryLocator'
import type { AgentAvailability } from '../../../src/shared/types/agent-events'
function locator(availability: BinaryLocator['availability']): BinaryLocator {
  return { availability, reset: vi.fn(), locate: async () => ({ path: '/cli', version: '0.158.0' }), loginShellPath: async () => null }
}
function deferred() { let resolve!: (value: AgentAvailability) => void; const promise = new Promise<AgentAvailability>(done => { resolve = done }); return { promise, resolve } }
describe('agent availability', () => {
  test('adapter/service checks share one in-flight probe and return protocol/login failures', async () => {
    const pending = deferred(), probe = vi.fn(() => pending.promise), cli = locator(probe)
    const service = createAgentAvailabilityService({ locators: { codex: cli, gemini: cli, 'claude-code': cli } })
    const a = service.check('codex'), b = checkAgentAvailability('codex', cli)
    await Promise.resolve(); expect(probe).toHaveBeenCalledTimes(1)
    pending.resolve({ installed: true, loggedIn: true, version: '0.157.9' })
    expect(await a).toMatchObject({ code: 'version-too-old' }); expect(await b).toMatchObject({ code: 'version-too-old' })
    await expect(service.assertReady('codex')).rejects.toMatchObject({ code: 'version-too-old' })
  })
  test('force refresh supersedes an older ready result for every existing waiter', async () => {
    const old = deferred(), newest = deferred(), probe = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(newest.promise), cli = locator(probe)
    const a = checkAgentAvailability('codex', cli), b = checkAgentAvailability('codex', cli)
    await Promise.resolve()
    const refreshed = checkAgentAvailability('codex', cli, { refresh: true })
    await Promise.resolve(); expect(probe).toHaveBeenCalledTimes(2); expect(cli.reset).toHaveBeenCalledOnce()
    old.resolve({ installed: true, loggedIn: true, version: '0.158.0' })
    newest.resolve({ installed: true, loggedIn: false, version: '0.158.0' })
    for (const result of await Promise.all([a, b, refreshed])) expect(result).toMatchObject({ loggedIn: false, code: 'not-logged-in' })
  })
  test('refresh before the previous probe launched avoids executing the invalidated probe', async () => {
    const probe = vi.fn(async () => ({ installed: true, loggedIn: true, version: '0.158.0' })), cli = locator(probe)
    const old = checkAgentAvailability('codex', cli), latest = checkAgentAvailability('codex', cli, { refresh: true })
    await Promise.all([old, latest]); expect(probe).toHaveBeenCalledOnce()
  })
})


test.each(['codex', 'gemini'] as const)('%s fresh process creation detects an external CLI downgrade despite an older cached ready result', async provider => {
  let current = provider === 'codex' ? '0.158.0' : '0.58.0'
  let cached: string | null = current
  const cli: BinaryLocator = {
    reset: vi.fn(() => { cached = null }),
    locate: async () => ({ path: '/mock/cli', version: cached ?? (cached = current) }),
    availability: async () => ({ installed: true, loggedIn: true, version: (await cli.locate()).version }),
    loginShellPath: async () => null
  }
  expect(await checkAgentAvailability(provider, cli)).not.toHaveProperty('code')
  current = provider === 'codex' ? '0.157.0' : '0.57.0'
  const spawnImpl = vi.fn()
  const adapter = provider === 'codex'
    ? (await import('../../../src/main/features/agent/codex/CodexAdapter')).createCodexAdapter({ locator: cli, spawnImpl })
    : (await import('../../../src/main/features/agent/gemini/GeminiAdapter')).createGeminiAdapter({ userDataPath: '/tmp/not-created', locator: cli, spawnImpl, apiKey: () => null })
  await expect(adapter.startSession({ courseId: 'course', cwd: '/tmp', resumeCliSessionId: 'idle-session' })).rejects.toMatchObject({ code: 'version-too-old' })
  expect(cli.reset).toHaveBeenCalledOnce()
  expect(spawnImpl).not.toHaveBeenCalled()
})
