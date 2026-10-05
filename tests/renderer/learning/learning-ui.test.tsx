// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LearningArticleSnapshot, LearningArtifact, LearningProjectSnapshot } from '../../../src/shared/types/learning'
import { LearningCards, LearningQuiz } from '../../../src/renderer/src/features/learning/LearningReview'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'
import { useStudyToolsStore } from '../../../src/renderer/src/features/study/studyToolsStore'
import { LearningSources } from '../../../src/renderer/src/features/learning/LearningSources'
import * as materialNavigation from '../../../src/renderer/src/features/workspace/openMaterial'
import { LearningReader } from '../../../src/renderer/src/features/learning/LearningReader'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); setIpcAdapter(null); vi.restoreAllMocks() })
const binding = { courseId: 'course', rootRelPath: '영어' }
function project(): LearningProjectSnapshot {
  return { schemaVersion: 1, projectId: 'project', revision: 1, name: 'English', topic: 'Cities', level: 'intermediate', readingMinutes: 5, createdAt: '2026-10-04', updatedAt: '2026-10-04', articles: [], words: [], occurrences: [], artifacts: [], cards: [], quizAttempts: [], runs: [], history: [], exports: [], binding, recovery: 'none', warnings: [] }
}
function render(node: React.ReactNode): HTMLDivElement { const element = document.createElement('div'); document.body.append(element); root = createRoot(element); act(() => root!.render(node)); return element }

describe('native quiz and flashcards', () => {
  test('saves a choice by option ID, then reveals explanation only after finishing', async () => {
    const quiz: Extract<LearningArtifact, { kind: 'quiz' }> = { id: 'quiz', schemaVersion: 1, revision: 1, kind: 'quiz', title: 'Quiz', createdAt: 'now', sourceRefs: [], articleIds: [], wordIds: [], questions: [{ id: 'q1', type: 'choice', prompt: 'Choose a word', options: [{ id: 'second', text: 'Choice shown first' }, { id: 'first', text: 'Choice shown second' }], answer: 'first', explanation: 'SECRET_EXPLANATION', sourceRefs: [] }] }
    let state = project()
    const invoke = vi.fn(async (channel: string, input: Record<string, string>) => {
      if (channel === 'learning:saveQuizAnswer') state = { ...state, revision: state.revision + 1, quizAttempts: [{ id: input.attemptId!, artifactId: 'quiz', answers: [{ questionId: 'q1', answer: input.answer!, correct: input.answer === 'first', answeredAt: 'now' }], startedAt: 'now', completedAt: null, score: 0, total: 1, selfCheckedCount: 0, selfPassedCount: 0, resultRelPath: null }] }
      if (channel === 'learning:finishQuiz') state = { ...state, revision: state.revision + 1, quizAttempts: state.quizAttempts.map(attempt => ({ ...attempt, completedAt: 'now', score: 1 })) }
      return state
    })
    setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
    function Host(): JSX.Element { const [value, setValue] = useState(state); return <LearningQuiz artifact={quiz} project={value} onUpdate={setValue} onArticle={() => {}} /> }
    const element = render(<Host />)
    expect(element.textContent).not.toContain('SECRET_EXPLANATION')
    await act(async () => { element.querySelector<HTMLInputElement>('input[value="first"]')!.click() })
    expect(invoke).toHaveBeenCalledWith('learning:saveQuizAnswer', expect.objectContaining({ binding, questionId: 'q1', answer: 'first' }))
    expect(element.textContent).not.toContain('SECRET_EXPLANATION')
    const finish = Array.from(element.querySelectorAll('button')).find(button => button.textContent === '채점하고 정답 보기')!
    await act(async () => { finish.click() })
    expect(element.textContent).toContain('SECRET_EXPLANATION')
    expect(element.textContent).toContain('자동 채점 1 / 1')
  })

  test('flips a due card, saves its rating once, and finishes the queue', async () => {
    const artifact: Extract<LearningArtifact, { kind: 'cards' }> = { id: 'deck', schemaVersion: 1, revision: 1, kind: 'cards', title: 'Cards', createdAt: 'now', sourceRefs: [], articleIds: [], wordIds: [], cards: [{ id: 'c1', front: 'FRONT', back: 'SECRET_BACK', sourceRefs: [] }] }
    // Regeneration can move the persisted schedule to a newer deck. The old
    // deck still resolves its immutable definition IDs to that same schedule.
    const initial = project(); initial.cards = [{ ...artifact.cards[0]!, artifactId: 'newer-deck', status: 'new', dueAt: '2026-01-01', intervalDays: 0, repetitions: 0, lapses: 0, lastReviewedAt: null }]
    const invoke = vi.fn(async () => ({ ...initial, revision: 2, cards: initial.cards.map(card => ({ ...card, dueAt: '2027-01-01', lastReviewedAt: '2026-10-04', status: 'review' as const })) }))
    setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
    function Host(): JSX.Element { const [value, setValue] = useState(initial); return <LearningCards artifact={artifact} project={value} onUpdate={setValue} onArticle={() => {}} /> }
    const element = render(<Host />)
    expect(element.textContent).toContain('FRONT'); expect(element.textContent).not.toContain('SECRET_BACK')
    act(() => element.querySelector<HTMLButtonElement>('.learning-flashcard')!.click())
    expect(element.textContent).toContain('SECRET_BACK')
    await act(async () => { Array.from(element.querySelectorAll('button')).find(button => button.textContent?.startsWith('기억함'))!.click() })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('learning:reviewCard', expect.objectContaining({ binding, cardId: 'c1', rating: 'good' }))
    expect(element.textContent).toContain('오늘의 복습을 마쳤어요.')
  })

  test('native generation uses async study:generate while legacy recipes still use study:run', async () => {
    const invoke = vi.fn(async (channel: string) => channel === 'study:generate' ? { runId: 'run', binding } : { relPath: 'AI 학습자료/기존.md' })
    setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
    await useStudyToolsStore.getState().generate({ courseId: 'course', tool: 'quiz', relPath: 'chapter.pdf', selection: 'chosen paragraph' })
    expect(invoke).toHaveBeenCalledWith('study:generate', { courseId: 'course', packId: 'quiz', source: { kind: 'material', relPath: 'chapter.pdf', selection: 'chosen paragraph' } })
    await useStudyToolsStore.getState().run({ courseId: 'course', tool: 'custom:legacy', relPath: 'chapter.pdf' })
    expect(invoke).toHaveBeenCalledWith('study:run', { courseId: 'course', tool: 'custom:legacy', relPath: 'chapter.pdf' })
  })

  test('resolves material citations against their copied-folder binding and keeps unavailable sources closed', async () => {
    const source = { kind: 'material' as const, relPath: 'articles/source.md', pathScope: 'project' as const, quote: 'Retained evidence.' }
    const invoke = vi.fn(async () => ({ relPath: '영어 복사본/articles/source.md', missing: false }))
    const open = vi.spyOn(materialNavigation, 'openMaterialInCourse').mockImplementation(() => {})
    setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
    const copiedBinding = { ...binding, rootRelPath: '영어 복사본' }
    const element = render(<LearningSources binding={copiedBinding} sources={[source, { ...source, availability: 'changed' }]} onArticle={() => {}} />)
    const buttons = element.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons[1]!.disabled).toBe(true)
    await act(async () => { buttons[0]!.click() })
    expect(invoke).toHaveBeenCalledWith('learning:resolveSource', { binding: copiedBinding, sourceRef: source })
    expect(open).toHaveBeenCalledWith('course', 'note', '영어 복사본/articles/source.md')
    expect(open).toHaveBeenCalledTimes(1)
  })

  test('adds a recurring lemma form to the same vocabulary and keeps a saved word when optional explanation cannot start', async () => {
    const article = { id: 'article', title: 'City', sourceUrl: 'https://example.test/city', siteName: 'Example', estimatedMinutes: 1, wordCount: 3, paragraphs: [{ id: 'p1', text: 'A city grows.', sentences: [{ id: 's1', text: 'A city grows.', start: 0, end: 13 }] }] } as LearningArticleSnapshot
    const initial = project(); initial.words = [{ id: 'word', surface: 'cities', lemma: 'city', meaning: '도시', pronunciation: '', partOfSpeech: 'noun', status: 'new', createdAt: 'now', updatedAt: 'now' }]
    const invoke = vi.fn(async (channel: string, input: Record<string, unknown>) => {
      if (channel === 'learning:run') throw new Error('provider unavailable')
      return { ...initial, revision: 2, occurrences: [{ id: 'occurrence', wordId: 'word', surface: input.surface, sentence: input.sentence, sourceRef: input.sourceRef, meaning: '', createdAt: 'now' }] }
    })
    setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
    function Host(): JSX.Element { const [value, setValue] = useState(initial); return <LearningReader article={article} project={value} onUpdate={setValue} onComplete={() => {}} onArticle={() => {}} /> }
    const element = render(<Host />)
    act(() => element.querySelector<HTMLElement>('[aria-label="“city” 단어 선택"]')!.click())
    await act(async () => { Array.from(element.querySelectorAll('button')).find(button => button.textContent === '이 문맥도 단어장에 담기')!.click() })
    expect(invoke).toHaveBeenCalledWith('learning:saveWord', expect.objectContaining({ surface: 'city', lemma: 'city', partOfSpeech: 'noun', sourceRef: expect.objectContaining({ quote: 'city', start: 2, end: 6 }) }))
    expect(element.querySelector('.learning-word-mini-list')?.textContent).toContain('cities')
    expect(element.textContent).toContain('단어장에 저장됐어요')
    expect(element.querySelector('[role="alert"]')).toBeNull()
  })

  test('a preserved review reader explains saved expressions without its quiz recipe while English retains its custom recipe', async () => {
    const article = { id: 'article', title: 'City', sourceUrl: 'https://example.test/city', siteName: 'Example', estimatedMinutes: 1, wordCount: 3, paragraphs: [{ id: 'p1', text: 'A city grows.', sentences: [{ id: 's1', text: 'A city grows.', start: 0, end: 13 }] }] } as LearningArticleSnapshot
    const initial = project(); initial.purpose = 'course-review'; initial.packId = 'quiz'
    initial.words = [{ id: 'word', surface: 'city', lemma: 'city', meaning: '도시', pronunciation: '', partOfSpeech: 'noun', status: 'new', createdAt: 'now', updatedAt: 'now' }]
    initial.occurrences = [{ id: 'occurrence', wordId: 'word', surface: 'city', sentence: 'A city grows.', sourceRef: { kind: 'article', articleId: 'article', paragraphId: 'p1', sentenceId: 's1', quote: 'city', start: 2, end: 6 }, meaning: '', createdAt: 'now' }]
    const invoke = vi.fn(async (channel: string) => channel === 'learning:run' ? { runId: 'run', binding } : initial)
    setIpcAdapter({ invoke, on: () => () => {} } as unknown as IpcAdapter)
    const props = { article, onUpdate: vi.fn(), onComplete: vi.fn(), onArticle: vi.fn() }
    const element = render(<LearningReader {...props} project={initial} />)
    act(() => element.querySelector<HTMLElement>('[aria-label="“city” 단어 선택"]')!.click())
    await act(async () => { [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '이 문맥도 단어장에 담기')!.click() })
    const expected = { binding, kind: 'explain-word', articleIds: ['article'], wordIds: ['word'] }
    expect(invoke).toHaveBeenCalledWith('learning:run', expected)
    await act(async () => { [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '이 글의 문맥 설명')!.click() })
    expect(invoke).toHaveBeenLastCalledWith('learning:run', expected)
    expect(element.querySelector('[role="alert"]')).toBeNull()

    act(() => root!.render(<LearningReader {...props} project={{ ...initial, purpose: 'english-reading', packId: 'custom:reading' }} />))
    await act(async () => { [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '이 글의 문맥 설명')!.click() })
    expect(invoke).toHaveBeenLastCalledWith('learning:run', { ...expected, packId: 'custom:reading' })
  })
})
