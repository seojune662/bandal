// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { LearningArtifact, LearningProjectSnapshot } from '../../../src/shared/types/learning'
import { LearningQuiz } from '../../../src/renderer/src/features/learning/LearningReview'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke }))
vi.mock('../../../src/renderer/src/features/chat/MarkdownView', () => ({ MarkdownView: ({ text }: { text: string }) => <span>{text}</span> }))
vi.mock('../../../src/renderer/src/features/learning/LearningSources', () => ({ LearningSources: () => null }))
vi.mock('../../../src/renderer/src/features/learning/learningNavigation', () => ({ learningError: (error: Error) => error.message, notifyLearningChanged: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const artifact = { id: 'quiz', kind: 'quiz', title: 'Quiz', questions: ['q1', 'q2'].map(id => ({ id, type: 'choice', prompt: id, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answer: 'b', explanation: '', sourceRefs: [] })) } as Extract<LearningArtifact, { kind: 'quiz' }>
const initial = { binding: { courseId: 'course', rootRelPath: 'study' }, quizAttempts: [{ id: 'attempt', artifactId: artifact.id, completedAt: null, answers: ['q1', 'q2'].map(questionId => ({ questionId, answer: 'a', correct: false })) }] } as LearningProjectSnapshot
let root: Root, host: HTMLDivElement
beforeEach(() => { invoke.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
function Harness() { const [project, setProject] = useState(initial); return <LearningQuiz artifact={artifact} project={project} onUpdate={setProject} onArticle={() => {}} /> }
function button(text: string): HTMLButtonElement { return Array.from(host.querySelectorAll('button')).find(button => button.textContent === text)! }

test('a successful second answer cannot hide an earlier failed save or grade its stale value', async () => {
  let saved = structuredClone(initial)
  let unavailable = true
  invoke.mockImplementation(async (channel: string, input: { questionId: string; answer: string }) => {
    if (channel === 'learning:saveQuizAnswer') {
      if (input.questionId === 'q1' && unavailable) throw new Error('disk full')
      saved = { ...saved, quizAttempts: saved.quizAttempts.map(attempt => ({ ...attempt, answers: attempt.answers.map(answer => answer.questionId === input.questionId ? { ...answer, answer: input.answer } : answer) })) }
      return saved
    }
    return saved
  })
  await act(async () => root.render(<Harness />))
  const choices = host.querySelectorAll<HTMLInputElement>('input[value=b]')
  await act(async () => choices[0]!.click())
  await act(async () => choices[1]!.click())
  expect(host.querySelector('[role=alert]')?.textContent).toContain('disk full')
  expect(choices[0]!.checked).toBe(true)
  await act(async () => button('채점하고 정답 보기').click())
  expect(invoke.mock.calls.some(([channel]) => channel === 'learning:finishQuiz')).toBe(false)
  unavailable = false
  await act(async () => button('답 다시 저장').click())
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(saved.quizAttempts[0]!.answers.map(answer => answer.answer)).toEqual(['b', 'b'])
  await act(async () => button('채점하고 정답 보기').click())
  expect(invoke).toHaveBeenLastCalledWith('learning:finishQuiz', { binding: initial.binding, artifactId: artifact.id, attemptId: 'attempt' })
})
