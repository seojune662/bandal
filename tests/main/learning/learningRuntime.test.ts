import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { LearningArticleInput, LearningBinding, LearningDraft, LearningRun, LearningSourceRef } from '../../../src/shared/types/learning'
import { createLearningRepo, type LearningRepo } from '../../../src/main/features/learning/learningRepo'
import { createLearningRuntime, type LearningRuntimeDeps } from '../../../src/main/features/learning/learningRuntime'
import { splitLearningParagraphs } from '../../../src/main/features/learning/model'

describe('host-managed learning run lifecycle', () => {
  let dir: string
  let repo: LearningRepo
  let runtime: ReturnType<typeof createLearningRuntime>
  let deps: LearningRuntimeDeps
  const binding: LearningBinding = { courseId: 'course-1', rootRelPath: '' }
  const source: LearningSourceRef = { kind: 'article', articleId: 'article-1', paragraphId: 'p1', sentenceId: 'p1-s1', quote: 'climate' }
  const candidate = (): LearningArticleInput => ({ sourceUrl: 'https://example.com/next', title: 'Next article',
    wordCount: 10, estimatedMinutes: 1, paragraphs: splitLearningParagraphs('The climate is changing and communities learn to adapt.') })
  const quizDraft = (): LearningDraft => ({ version: 1, artifacts: [{ kind: 'quiz', id: 'untrusted-id', title: 'Climate quiz', articleIds: ['article-1'], questions: [
    { id: 'q1', type: 'choice', prompt: 'What is changing?', answer: 'a', options: [{ id: 'a', text: 'Climate' }, { id: 'b', text: 'Moon' }], explanation: 'The opening sentence.', sourceRefs: [source] }
  ] }] })
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bandal-learning-runtime-')); const course = join(dir, 'course'); mkdirSync(course)
    repo = createLearningRepo({ getCourseFolder: () => course })
    await repo.create({ binding, name: 'Learning', topic: 'Climate', readingMinutes: 1 })
    await repo.addArticle({ binding, article: { id: 'article-1', sourceUrl: 'https://example.com/start', title: 'First article', paragraphs: splitLearningParagraphs('The climate is changing quickly.') } })
    await repo.saveWord({ binding, surface: 'climate', sentence: 'The climate is changing quickly.', sourceRef: source })
    await repo.saveWord({ binding, surface: 'changing', sentence: 'The climate is changing quickly.', sourceRef: { ...source, quote: 'changing' } })
    deps = { repo, extractUrl: vi.fn(async () => candidate()), matchWords: vi.fn((article, words) => words.filter(word => article.paragraphs.some(paragraph => paragraph.text.includes(word.surface))).map(word => ({ wordId: word.id }))),
      validateDraft: (draft) => repo.validateDraft(binding, draft), send: vi.fn(async () => undefined), cancel: vi.fn(),
      close: vi.fn(), sourceText: vi.fn(async () => ''), provider: () => 'codex' }
    runtime = createLearningRuntime(deps)
  })
  afterEach(async () => {
    runtime.dispose()
    // Wait for terminal persistence before removing the backing project folder.
    await vi.waitFor(async () => expect((await repo.read(binding)).runs.every(run => ['complete', 'failed', 'cancelled', 'interrupted', 'awaiting-confirmation'].includes(run.status))).toBe(true))
    rmSync(dir, { recursive: true, force: true })
  })
  async function waitSend(count = 1): Promise<string> {
    await vi.waitFor(() => expect(deps.send).toHaveBeenCalledTimes(count))
    return vi.mocked(deps.send).mock.calls[count - 1]![1]
  }
  async function words(): Promise<string[]> { return (await repo.read(binding)).words.map(word => word.id) }
  async function run(id: string): Promise<LearningRun> { return (await repo.read(binding)).runs.find(item => item.id === id)! }

  test('validates provider, kind and selected IDs before opening an AI session', async () => {
    await expect(runtime.start({ binding, kind: 'create-quiz', provider: 'wrong' })).rejects.toThrow('제공자')
    await expect(runtime.start({ binding, kind: 'unknown' as 'create-quiz' })).rejects.toThrow('작업')
    await expect(runtime.start({ binding, kind: 'create-quiz', articleIds: ['missing'] })).rejects.toThrow('찾지')
    expect(deps.send).not.toHaveBeenCalled(); expect((await repo.read(binding)).runs).toHaveLength(0)
  })
  test('prioritizes the actual failed expressions, including self-checks, without boosting other quiz words', async () => {
    const expressions = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'struggle', 'insight']
    const sentence = `${expressions.join(' ')}.`
    await repo.addArticle({ binding, article: { id: 'many-words', title: 'Expressions', sourceUrl: 'https://example.com/expressions', paragraphs: splitLearningParagraphs(sentence) } })
    for (const surface of expressions) await repo.saveWord({ binding, surface, sentence, sourceRef: { kind: 'article', articleId: 'many-words', quote: surface } })
    const state = await repo.read(binding)
    const wrongWord = state.words.find(word => word.surface === 'struggle')!.id
    const selfWord = state.words.find(word => word.surface === 'insight')!.id
    const seeded = await repo.putArtifact({ binding, artifact: { id: 'expressions-quiz', kind: 'quiz', title: 'Expressions quiz', wordIds: state.words.map(word => word.id), questions: state.words.map((word, index) => ({
      id: `word-q${index}`, type: word.id === selfWord ? 'short-answer' : 'cloze', prompt: `Explain ${word.surface}`, answer: word.id === selfWord ? '' : word.surface,
      ...(word.id === selfWord ? { modelAnswer: 'An understanding.' } : {}), explanation: '', wordId: word.id,
      sourceRefs: [state.occurrences.find(occurrence => occurrence.wordId === word.id)!.sourceRef]
    })) } })
    for (const attemptId of ['first-expression-attempt', 'second-expression-attempt']) {
      for (const [index, word] of seeded.words.entries()) await repo.saveQuizAnswer({ binding, artifactId: 'expressions-quiz', attemptId, questionId: `word-q${index}`,
        answer: word.id === wrongWord ? 'wrong expression' : word.surface,
        ...(word.id === selfWord ? { selfCheck: attemptId === 'second-expression-attempt' } : {}) })
      await repo.finishQuiz({ binding, artifactId: 'expressions-quiz', attemptId })
    }
    const artifactRead = vi.spyOn(repo, 'readArtifact')
    const started = await runtime.start({ binding, kind: 'find-articles' })
    await waitSend()
    const selected = (await run(started.runId)).wordIds
    expect(selected.slice(0, 2)).toEqual([wrongWord, selfWord])
    expect(selected.slice(2)).toEqual(state.words.slice(0, 3).map(word => word.id))
    expect(selected).toHaveLength(5)
    expect(artifactRead).toHaveBeenCalledTimes(1)
  })
  test('missing old quiz artifacts do not block finding the next article', async () => {
    await repo.putArtifact({ binding, artifact: { ...quizDraft().artifacts![0]!, id: 'old-quiz' } })
    await repo.saveQuizAnswer({ binding, artifactId: 'old-quiz', attemptId: 'old-attempt', questionId: 'q1', answer: 'b' })
    await repo.finishQuiz({ binding, artifactId: 'old-quiz', attemptId: 'old-attempt' })
    vi.spyOn(repo, 'readArtifact').mockRejectedValue(new Error('old snapshot is missing'))
    const started = await runtime.start({ binding, kind: 'find-articles' })
    await waitSend()
    expect((await run(started.runId)).status).toBe('running')
  })
  test('coalesces exact duplicate requests while queueing distinct words and next articles durably', async () => {
    const [firstWord, secondWord] = await words()
    const first = await runtime.start({ binding, kind: 'explain-word', wordIds: [firstWord!] })
    const session = await waitSend()
    const duplicate = await runtime.start({ binding, kind: 'explain-word', wordIds: [firstWord!] })
    const second = await runtime.start({ binding, kind: 'explain-word', wordIds: [secondWord!] })
    const next = await runtime.start({ binding, kind: 'find-articles' })
    expect(duplicate.runId).toBe(first.runId)
    expect(second.runId).not.toBe(first.runId)
    expect((await run(second.runId)).status).toBe('queued'); expect((await run(next.runId)).status).toBe('queued')
    expect(deps.send).toHaveBeenCalledTimes(1)
    await runtime.settle(session, 'error')
    const secondSession = await waitSend(2)
    await runtime.settle(secondSession, 'error')
    await waitSend(3)
    expect((await run(next.runId)).status).toBe('running')
  })
  test('imports a validated artifact only when the turn settles and commits completion once', async () => {
    const started = await runtime.start({ binding, kind: 'create-quiz', articleIds: ['article-1'] })
    const session = await waitSend()
    await runtime.submitResult(session, quizDraft())
    expect((await repo.read(binding)).artifacts).toHaveLength(0)
    const writes: string[] = []
    const updateRun = repo.updateRun.bind(repo)
    vi.spyOn(repo, 'updateRun').mockImplementation(async input => { writes.push(input.run.status); return updateRun(input) })
    await runtime.settle(session, 'success')
    const state = await repo.read(binding)
    expect(state.artifacts).toHaveLength(1)
    expect(state.artifacts[0]!.id).not.toBe('untrusted-id')
    expect((await run(started.runId)).status).toBe('complete')
    expect(writes).toEqual(['validating'])
    expect(deps.close).toHaveBeenCalledTimes(1)
    expect(runtime.restrictionFor(session)?.size).toBe(0)
  })
  test('cancellation wins a synchronous adapter settlement callback and rejects late results', async () => {
    const started = await runtime.start({ binding, kind: 'create-quiz' })
    const session = await waitSend()
    vi.mocked(deps.cancel).mockImplementation(() => { void runtime.settle(session, 'interrupted') })
    await runtime.cancel(binding, started.runId)
    expect((await run(started.runId)).status).toBe('cancelled')
    await expect(runtime.submitResult(session, quizDraft())).rejects.toThrow('종료')
    expect((await repo.read(binding)).artifacts).toHaveLength(0)
  })
  test('canceling a queued request does not cancel the active provider session', async () => {
    const first = await runtime.start({ binding, kind: 'find-articles' }); await waitSend()
    const second = await runtime.start({ binding, kind: 'create-quiz' })
    await runtime.cancel(binding, second.runId)
    expect((await run(second.runId)).status).toBe('cancelled')
    expect((await run(first.runId)).status).toBe('running')
    expect(deps.cancel).not.toHaveBeenCalled()
  })
  test('keeps conversion as a pending preview and lets the user discard it', async () => {
    const started = await runtime.start({ binding, kind: 'import-material', source: { kind: 'material', relPath: 'old.md' } })
    const session = await waitSend()
    await runtime.submitResult(session, quizDraft()); await runtime.settle(session, 'success')
    expect((await run(started.runId)).status).toBe('awaiting-confirmation')
    expect((await repo.read(binding)).artifacts).toHaveLength(0)
    await runtime.cancel(binding, started.runId)
    expect(await run(started.runId)).toMatchObject({ status: 'cancelled', draft: null })
  })
  test('holds imported vocabulary as a preview and rejects existing-word edits', async () => {
    const started = await runtime.start({ binding, kind: 'import-material', source: { kind: 'material', relPath: 'old.md' } })
    const session = await waitSend()
    const wordId = (await words())[0]!
    await expect(runtime.submitResult(session, { version: 1, wordUpdates: [{ wordId, meaning: '덮어쓰기' }] })).rejects.toThrow('새 단어')
    await runtime.submitResult(session, { version: 1, words: [{ surface: 'quickly', sentence: 'The climate is changing quickly.', sourceRef: { ...source, quote: 'quickly' }, meaning: '빠르게' }] })
    await runtime.settle(session, 'success')
    const preview = await run(started.runId)
    expect(preview.status).toBe('awaiting-confirmation')
    expect((await repo.read(binding)).words).toHaveLength(2)
    await repo.importDraft({ binding, runId: preview.id, draft: preview.draft! })
    expect((await repo.read(binding)).words).toHaveLength(3)
  })
  test('ordinary artifact generation cannot add imported vocabulary', async () => {
    await runtime.start({ binding, kind: 'create-quiz' })
    const session = await waitSend()
    await expect(runtime.submitResult(session, { ...quizDraft(), words: [{ surface: 'quickly', sentence: 'x', sourceRef: { ...source, quote: 'quickly' } }] })).rejects.toThrow('요청한 종류')
    expect((await repo.read(binding)).words).toHaveLength(2)
  })
  test('only imports app-verified article snapshots and records every known literal word match', async () => {
    const ids = await words()
    const started = await runtime.start({ binding, kind: 'find-articles', wordIds: [ids[0]!] })
    const session = await waitSend()
    await expect(runtime.submitResult(session, { version: 1, articles: [{ id: 'invented' }] })).rejects.toThrow('확인하지')
    const verified = await runtime.verifyArticle(session, 'https://example.com/next')
    await runtime.submitResult(session, { version: 1, articles: [{ id: verified.id, paragraphs: [{ text: 'invented replacement' }] }] })
    await runtime.settle(session, 'success')
    const state = await repo.read(binding)
    expect((await run(started.runId)).status).toBe('complete')
    expect(state.articles[1]!.matchedWordIds.sort()).toEqual(ids.sort())
    expect((await repo.readArticle(binding, state.articles[1]!.id)).paragraphs[0]!.text).toBe(candidate().paragraphs[0]!.text)
  })
  test('custom pack tool restrictions intersect with host policy and retain lifecycle submit', async () => {
    deps.tools = () => ['read_material', 'delete_course', 'arbitrary_tool']
    runtime = createLearningRuntime(deps)
    await runtime.start({ binding, kind: 'create-quiz', packId: 'custom.pack' })
    const session = await waitSend()
    expect([...runtime.restrictionFor(session)!].sort()).toEqual(['learning_submit_result', 'read_material'])
  })
  test('restart recovery interrupts orphaned queued/running runs and preserves previews', async () => {
    const timestamp = new Date().toISOString()
    const base: LearningRun = { id: 'orphan', kind: 'create-quiz', provider: 'codex', status: 'queued', wordIds: [], articleIds: [], message: '', error: null, draft: null, createdAt: timestamp, updatedAt: timestamp }
    await repo.updateRun({ binding, run: base })
    await repo.updateRun({ binding, run: { ...base, id: 'preview', status: 'awaiting-confirmation', draft: quizDraft() } })
    await runtime.recover(binding)
    expect((await run('orphan')).status).toBe('interrupted')
    expect((await run('preview')).status).toBe('awaiting-confirmation')
  })
  test('recovery does not overwrite a settling run while an atomic result commit is pending', async () => {
    const started = await runtime.start({ binding, kind: 'create-quiz' })
    const session = await waitSend(); await runtime.submitResult(session, quizDraft())
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const importer = repo.importDraft.bind(repo)
    const importSpy = vi.spyOn(repo, 'importDraft').mockImplementation(async input => { await gate; return importer(input) })
    const settlement = runtime.settle(session, 'success')
    await vi.waitFor(() => expect(importSpy).toHaveBeenCalledTimes(1))
    const next = await runtime.start({ binding, kind: 'find-articles' })
    await runtime.recover(binding)
    expect((await run(started.runId)).status).toBe('validating')
    expect((await run(next.runId)).status).toBe('queued')
    expect(deps.send).toHaveBeenCalledTimes(1)
    release(); await settlement
    expect((await run(started.runId)).status).toBe('complete')
    await waitSend(2)
  })
})
