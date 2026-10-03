import { describe, expect, test, vi } from 'vitest'
import { registerLearningHandlers } from '../../../src/main/ipc/learningHandlers'
import type { LearningIpcContract } from '../../../src/shared/ipc/learningContract'
import type { LearningRun } from '../../../src/shared/types/learning'
import type { WorkflowPack, WorkflowPackV2 } from '../../../src/shared/types/workflowPack'

const binding = { courseId: 'course-1', rootRelPath: '학습' }
const pack = (overrides: Partial<WorkflowPackV2> = {}): WorkflowPackV2 => ({
  schemaVersion: 2, id: 'custom:quiz', name: 'Imported quiz', description: '', author: 'test', version: '1.0.0', locale: 'ko-KR',
  experience: 'quiz', worksOn: ['course', 'material', 'selection'], recipe: 'custom recipe', allowedTools: ['learning_submit_result'], usesWeb: false,
  outputs: { dir: '복습', primary: '퀴즈' }, ...overrides
})
function harness(initialPack: WorkflowPack | null = pack()) {
  type Deps = Parameters<typeof registerLearningHandlers>[1]
  const handlers = new Map<keyof LearningIpcContract, (input: unknown) => unknown>()
  let activePack = initialPack
  const runs: LearningRun[] = []
  const start = vi.fn(async () => ({ binding, runId: 'started' }))
  const retry = vi.fn(async () => ({ binding, runId: 'retried' }))
  const approve = vi.fn(async () => undefined)
  const deps = {
    repo: { read: vi.fn(async () => ({ runs })) },
    runtime: { start, retry },
    resolvePack: vi.fn(() => activePack), approvePack: approve
  } as unknown as Deps
  registerLearningHandlers((channel, handler) => handlers.set(channel, handler as (input: unknown) => unknown), deps)
  const invoke = <K extends keyof LearningIpcContract>(channel: K, input: LearningIpcContract[K]['req']) =>
    Promise.resolve().then(() => handlers.get(channel)!(input))
  const addFailedRun = () => {
    runs.push({ id: 'failed-run', kind: 'create-quiz', packId: 'custom:quiz', provider: 'codex', status: 'failed', articleIds: [], wordIds: [], message: '', error: 'failed', draft: null,
      createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' })
  }
  return { invoke, start, retry, approve, addFailedRun, disable: () => { activePack = null } }
}

describe('native learning pack authorization', () => {
  test.each(['disabled', 'legacy', 'mismatched'] as const)('direct run cannot bypass %s pack restrictions', async condition => {
    const selected: WorkflowPack | null = condition === 'disabled' ? null
      : condition === 'legacy' ? { ...pack(), schemaVersion: 1 }
        : pack({ experience: 'flashcards' })
    const h = harness(selected)
    await expect(h.invoke('learning:run', { binding, kind: 'create-quiz', packId: 'custom:quiz' })).rejects.toThrow('팩')
    expect(h.start).not.toHaveBeenCalled(); expect(h.approve).not.toHaveBeenCalled()
  })
  test('direct run and retry cannot execute a custom recipe when approval is declined', async () => {
    const h = harness(); h.addFailedRun()
    h.approve.mockRejectedValue(new Error('사용자 승인이 거절됐어요.'))
    await expect(h.invoke('learning:run', { binding, kind: 'create-quiz', packId: 'custom:quiz' })).rejects.toThrow('승인')
    await expect(h.invoke('learning:runRetry', { binding, runId: 'failed-run' })).rejects.toThrow('승인')
    expect(h.start).not.toHaveBeenCalled(); expect(h.retry).not.toHaveBeenCalled()
    expect(h.approve).toHaveBeenCalledWith('custom:quiz', binding.courseId)
  })
  test('approval cannot authorize a pack disabled while the confirmation dialog was open', async () => {
    const h = harness()
    h.approve.mockImplementation(async () => { h.disable() })
    await expect(h.invoke('learning:run', { binding, kind: 'create-quiz', packId: 'custom:quiz' })).rejects.toThrow('사용할')
    expect(h.start).not.toHaveBeenCalled()
  })
  test('retry revalidates the persisted pack experience instead of trusting the earlier run', async () => {
    const h = harness(pack({ experience: 'flashcards' })); h.addFailedRun()
    await expect(h.invoke('learning:runRetry', { binding, runId: 'failed-run' })).rejects.toThrow('지원하지')
    expect(h.retry).not.toHaveBeenCalled(); expect(h.approve).not.toHaveBeenCalled()
  })
  test('generation cannot use material-only, selection-only or live-browser-only recipes on other sources', async () => {
    const materialOnly = harness(pack({ worksOn: ['material'] }))
    await expect(materialOnly.invoke('study:generate', { courseId: binding.courseId, rootRelPath: binding.rootRelPath, packId: 'custom:quiz' })).rejects.toThrow('범위')
    await expect(materialOnly.invoke('study:generate', { courseId: binding.courseId, rootRelPath: binding.rootRelPath, packId: 'custom:quiz', source: { kind: 'material', relPath: 'note.md', selection: 'chosen text' } })).rejects.toThrow('범위')
    const selectionOnly = harness(pack({ worksOn: ['selection'] }))
    await expect(selectionOnly.invoke('study:generate', { courseId: binding.courseId, rootRelPath: binding.rootRelPath, packId: 'custom:quiz', source: { kind: 'article', articleIds: ['article-1'] } })).rejects.toThrow('범위')
    const browserOnly = harness(pack({ worksOn: ['browser-tab'] }))
    await expect(browserOnly.invoke('study:generate', { courseId: binding.courseId, rootRelPath: binding.rootRelPath, packId: 'custom:quiz', source: { kind: 'article', articleIds: ['article-1'] } })).rejects.toThrow('범위')
    for (const h of [materialOnly, selectionOnly, browserOnly]) {
      expect(h.start).not.toHaveBeenCalled(); expect(h.approve).not.toHaveBeenCalled()
    }
  })
})
