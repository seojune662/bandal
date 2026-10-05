import { describe, expect, test, vi } from 'vitest'
import type { SessionManager } from '../../../src/main/features/agent/SessionManager'
import type { AgentAvailability } from '../../../src/shared/types/agent-events'
import { sendLearningWithSession, validateConnectedLearningAi } from '../../../src/main/features/learning/learningAgent'
import { LearningExecutionError, learningFailure } from '../../../src/main/features/learning/learningFailures'

const ai = { provider: 'codex' as const, model: 'gpt-5.5', effort: 'high' }
function fakeManager(availability: AgentAvailability) {
  return { open: vi.fn(async () => ({ availability })), setModel: vi.fn(), send: vi.fn(async () => ({ turnSeq: 1 })) } as unknown as SessionManager
}
describe('learning AI preflight', () => {
  test('creation preflight checks the selected connection before requesting a model catalog', async () => {
    const validate = vi.fn(async value => value)
    const availability = vi.fn(async () => ({ installed: false, loggedIn: false, code: 'not-installed' as const, reason: 'CLI is missing' }))
    const error = await validateConnectedLearningAi(ai, availability, validate).catch(error => error)
    expect(availability).toHaveBeenCalledWith('codex')
    expect(learningFailure(error)).toMatchObject({ category: 'connection', code: 'not-installed', message: 'CLI is missing' })
    expect(validate).not.toHaveBeenCalled()
  })
  test('sets the explicit model and effort before sending the hidden study turn', async () => {
    const manager = fakeManager({ installed: true, loggedIn: true })
    await sendLearningWithSession(manager, 'original-course', 'study-1', 'prompt', ai, async value => value)
    expect(manager.open).toHaveBeenCalledWith('original-course', 'study-1', 'study')
    expect(manager.setModel).toHaveBeenCalledWith('original-course', 'study-1', 'gpt-5.5', 'high')
    expect(vi.mocked(manager.setModel).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(manager.send).mock.invocationCallOrder[0]!)
  })
  test('does not spawn a turn when the selected connection is logged out', async () => {
    const manager = fakeManager({ installed: true, loggedIn: false, code: 'not-logged-in', reason: 'Codex 로그인 필요' })
    const error = await sendLearningWithSession(manager, 'course', 'study', 'prompt', ai, async value => value).catch(error => error)
    expect(learningFailure(error)).toMatchObject({ code: 'not-logged-in', category: 'connection', message: 'Codex 로그인 필요' })
    expect(manager.setModel).not.toHaveBeenCalled(); expect(manager.send).not.toHaveBeenCalled()
  })
  test('validates model selection before opening any connection', async () => {
    const manager = fakeManager({ installed: true, loggedIn: true })
    await expect(sendLearningWithSession(manager, 'course', 'study', 'prompt', ai, async () => { throw new Error('select another model') })).rejects.toThrow('select another model')
    expect(manager.open).not.toHaveBeenCalled()
  })
  test('does not replace an existing connection diagnostic with model selection failure', async () => {
    const manager = fakeManager({ installed: true, loggedIn: true })
    const failure = { code: 'not-logged-in', category: 'connection' as const, message: 'Sign in required', actionable: 'Sign in' }
    const error = await sendLearningWithSession(manager, 'course', 'study', 'prompt', ai, async () => { throw new LearningExecutionError(failure) }).catch(error => error)
    expect(learningFailure(error)).toEqual(failure)
    expect(manager.send).not.toHaveBeenCalled()
  })
  test.each([
    [JSON.stringify({ error: { message: 'The chosen model is not supported for this account.', code: 'model_not_supported', type: 'invalid_request_error' } }), 'model_not_supported'],
    ['HTTP400: ' + JSON.stringify({ error: { message: 'The chosen model is not supported for this account.', type: 'invalid_request_error' } }), 'invalid_request_error'],
    [JSON.stringify({ type: 'error', status: 400, error: { message: 'The chosen model is not supported for this account.', code: null, type: 'invalid_request_error' } }), 'invalid_request_error']
  ])('preserves the original provider JSON code/type for unsupported models', (message, code) => {
    expect(learningFailure({ code: 'unknown', message })).toMatchObject({ category: 'model', code, message: 'The chosen model is not supported for this account.' })
  })
  test('keeps a known adapter code while extracting a quoted inline JSON message safely', () => {
    const message = 'HTTP400: ' + JSON.stringify({ error: { message: 'The model "{selected}" is not supported for this account.', code: 'model_not_supported' } }) + ' [request failed]'
    expect(learningFailure({ code: 'process-crashed', message })).toMatchObject({ category: 'model', code: 'process-crashed', message: 'The model "{selected}" is not supported for this account.' })
    expect(learningFailure({ code: 'unknown', message: 'HTTP400: {malformed' })).toMatchObject({ code: 'unknown', message: 'HTTP400: {malformed' })
  })
  test.each([
    [{ code: 'unknown', message: JSON.stringify({ error: { message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account." } }) }, 'model', 'model-unavailable'],
    [{ code: 'usage-limit', message: 'Usage limit reached' }, 'quota', 'usage-limit'],
    [{ code: 'unknown', message: 'Network connection failed: ECONNRESET' }, 'network', 'unknown'],
    [{ code: 'process-crashed', message: 'The chosen model is not supported for this account.' }, 'model', 'process-crashed']
  ])('keeps the useful provider reason and classifies it (%j)', (error, category, code) => {
    expect(learningFailure(error)).toMatchObject({ category, code, actionable: expect.any(String) })
    if (category === 'model') expect(learningFailure(error).message).toContain('account')
  })
})
