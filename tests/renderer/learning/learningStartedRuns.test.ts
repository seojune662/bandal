// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import type { LearningRun } from '../../../src/shared/types/learning'
import { rememberStartedLearningRun, takeStartedLearningRuns, LEARNING_RUN_STARTED_EVENT, startLearningRun } from '../../../src/renderer/src/features/learning/learningStartedRuns'
import { visibleLearningRuns } from '../../../src/renderer/src/features/learning/learningRunPresentation'
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke }))
const binding = { courseId: 'course', rootRelPath: 'study' }

test('keeps an immediate first-run failure actionable even when it precedes the initial snapshot', async () => {
  const failed = { id: 'fresh-run', status: 'failed' } as LearningRun
  invoke.mockResolvedValueOnce({ binding, runId: failed.id })
  const listener = vi.fn()
  window.addEventListener(LEARNING_RUN_STARTED_EVENT, listener)
  await startLearningRun({ binding, kind: 'find-articles' })
  const historical = new Set([failed.id])
  for (const id of takeStartedLearningRuns(binding, [failed])) historical.delete(id)
  expect(visibleLearningRuns([failed], historical)).toEqual([failed])
  expect(listener).toHaveBeenCalledOnce()
  // The user has now seen it; reopening does not resurrect a historical banner.
  expect(takeStartedLearningRuns(binding, [failed])).toEqual([])
  expect(visibleLearningRuns([failed], new Set([failed.id]))).toEqual([])
  window.removeEventListener(LEARNING_RUN_STARTED_EVENT, listener)
})
test('retains freshness until the correct project snapshot includes its run', () => {
  rememberStartedLearningRun({ binding, runId: 'next-run' })
  const run = { id: 'next-run' } as LearningRun
  expect(takeStartedLearningRuns(binding, [])).toEqual([])
  expect(takeStartedLearningRuns({ ...binding, courseId: 'another' }, [run])).toEqual([])
  expect(takeStartedLearningRuns(binding, [run])).toEqual(['next-run'])
})
