import { existsSync } from 'node:fs'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/testDb'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { createLearningRepo, LEARNING_DATA_DIR } from '../../../src/main/features/learning/learningRepo'
import { createLearningRuntime } from '../../../src/main/features/learning/learningRuntime'
import { createLearningCache } from '../../../src/main/features/learning/learningCache'
import { createLearningGrounding } from '../../../src/main/features/learning/learningGrounding'
import { splitLearningParagraphs } from '../../../src/main/features/learning/model'
import { registerLearningHandlers } from '../../../src/main/ipc/learningHandlers'
import type { LearningIpcContract } from '../../../src/shared/ipc/learningContract'
import type { LearningAiSettings, LearningBinding, LearningRun, LearningSourceRef } from '../../../src/shared/types/learning'
import type { WorkflowPackV2 } from '../../../src/shared/types/workflowPack'

const ai: LearningAiSettings = { provider: 'codex', model: 'selected-model', effort: null }
const pack: WorkflowPackV2 = { schemaVersion: 2, id: 'builtin:quiz', name: 'Quiz', description: '', author: 'Bandal', version: '1', locale: 'ko-KR',
  experience: 'quiz', worksOn: ['course', 'material', 'selection'], recipe: '', allowedTools: ['learning_submit_result'], usesWeb: false, outputs: { dir: '복습', primary: '퀴즈' } }
const article = { id: 'article-1', title: 'Climate', sourceUrl: 'https://example.com/climate', paragraphs: splitLearningParagraphs('The climate is changing quickly.') }
const citation: LearningSourceRef = { kind: 'article', articleId: article.id, paragraphId: 'p1', sentenceId: 'p1-s1', quote: 'climate' }

describe('learning space removal and recovery', () => {
  let ctx: TestDb
  const runtimes: ReturnType<typeof createLearningRuntime>[] = []
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); ctx.cleanup() })
  function host() {
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'data') })
    const cache = createLearningCache(ctx.db)
    let failCommit = false
    const repo = createLearningRepo({ getCourseFolder: id => courses.getFolder(id), getCourseFolderIncludingDeleted: id => courses.getFolderIncludingDeleted(id),
      beforeCommit: () => { if (failCommit) { failCommit = false; throw new Error('Injected storage failure') } },
      listCourseIds: () => courses.list({ includeArchived: true, includeDeleted: true }).map(course => course.id) })
    const send = vi.fn(async () => undefined), cancel = vi.fn(), close = vi.fn(async () => undefined)
    const runtime = createLearningRuntime({ repo, send, cancel, close, extractUrl: async () => article, matchWords: () => [], sourceText: async () => '',
      validateDraft: (draft, state) => repo.validateDraft(state.binding, draft) })
    runtimes.push(runtime)
    const handlers = new Map<keyof LearningIpcContract, (input: unknown) => unknown>()
    const deletedCourse = vi.fn(), changedCourse = vi.fn()
    registerLearningHandlers((channel, handler) => handlers.set(channel, handler as (input: unknown) => unknown), {
      repo, runtime, courses, cache, extractor: {} as never, resolvePack: () => pack, approvePack: async () => undefined, validateAi: async settings => settings,
      deletedCourse, changedCourse, assertSourceTab: () => undefined, resolveSource: async () => ({ missing: true, relPath: null })
    })
    const invoke = <K extends keyof LearningIpcContract>(channel: K, input: LearningIpcContract[K]['req']): Promise<LearningIpcContract[K]['res']> =>
      Promise.resolve().then(() => handlers.get(channel)!(input)) as Promise<LearningIpcContract[K]['res']>
    const english = () => invoke('learning:create', { placement: 'standalone', name: 'Reading', topic: '환경', purpose: 'english-reading', topicIds: ['environment'],
      readingSetupConfirmed: true, ai, level: 'intermediate', readingMinutes: 4 })
    const stop = async (binding: LearningBinding) => runtime.withProjectPaused(binding, async () => undefined)
    return { courses, cache, repo, runtime, invoke, english, send, cancel, close, deletedCourse, changedCourse, stop, failNextCommit: () => { failCommit = true } }
  }

  test('removes a standalone space without trashing data and restores its original course and project identity', async () => {
    const h = host(), space = await h.english(), binding = space.binding
    const course = h.courses.getById(binding.courseId)
    await h.repo.addArticle({ binding, article })
    await h.repo.saveWord({ binding, surface: 'climate', sentence: article.paragraphs[0]!.text, sourceRef: citation })
    const before = await h.repo.putArtifact({ binding, artifact: { kind: 'cards', title: 'Climate', articleIds: [article.id], cards: [{ id: 'card', front: 'climate', back: '기후', sourceRefs: [citation] }] } })
    const card = before.cards[0]!
    const learned = await h.repo.reviewCard({ binding, cardId: card.id, rating: 'good', reviewId: 'review-1' })
    await writeFile(join(course.folderPath, 'personal.md'), 'User-authored text')
    const immutable = before.artifacts[0]!, immutableBytes = await readFile(join(course.folderPath, immutable.relPath), 'utf8')
    await h.invoke('learning:rename', { binding, name: 'My reading' })
    expect(h.courses.getById(course.id)).toMatchObject({ name: 'My reading', folderPath: course.folderPath })
    await h.invoke('learning:delete', { binding })
    expect(h.courses.list()).toEqual([])
    expect((await h.invoke('learning:list', {})).projects).toEqual([])
    expect((await h.invoke('learning:list', { includeDeleted: true })).projects[0]).toMatchObject({ binding, projectId: space.projectId, deletedAt: expect.any(String) })
    await expect(h.repo.read(binding)).rejects.toThrow()
    await expect(h.repo.create({ binding, name: 'Replacement', topic: 'Different' })).rejects.toThrow()
    expect(await readFile(join(course.folderPath, 'personal.md'), 'utf8')).toBe('User-authored text')
    const restored = await h.invoke('learning:restore', { binding })
    expect(restored).toMatchObject({ binding, projectId: space.projectId, name: 'My reading', deletedAt: null })
    expect(restored.cards[0]).toEqual(learned.cards[0]); expect(restored.history).toEqual(learned.history)
    expect(h.courses.getById(course.id).folderPath).toBe(course.folderPath)
    expect(await readFile(join(course.folderPath, immutable.relPath), 'utf8')).toBe(immutableBytes)
    expect(h.deletedCourse).toHaveBeenCalledOnce()
  })

  test.each(['legacy/subfolder', ''])('removes only the learning registration at %j and leaves the real course and files intact', async rootRelPath => {
    const h = host(), course = h.courses.create({ name: 'Linear algebra', color: 'blue' }), binding = { courseId: course.id, rootRelPath }
    await h.repo.create({ binding, name: 'AI 학습자료', topic: '과목 자료' })
    await writeFile(join(course.folderPath, 'lecture.md'), 'Original course material')
    const sibling = { courseId: course.id, rootRelPath: 'other' }
    if (rootRelPath) await h.repo.create({ binding: sibling, name: 'Other', topic: 'Old topic' })
    await h.invoke('learning:rename', { binding, name: 'My legacy review' })
    expect(h.courses.getById(course.id).name).toBe('Linear algebra')
    await h.invoke('learning:delete', { binding })
    expect(h.courses.getById(course.id)).toMatchObject({ workspaceKind: 'course', archived: false })
    expect(await readFile(join(course.folderPath, 'lecture.md'), 'utf8')).toBe('Original course material')
    expect((await h.repo.discover(course.id)).map(space => space.binding)).toEqual(rootRelPath ? [sibling] : [])
    await expect(h.repo.updateSettings({ binding, name: 'Cannot resurrect implicitly' })).rejects.toThrow('삭제')
    const restored = await h.invoke('learning:restore', { binding })
    expect(restored.name).toBe('My legacy review'); expect(restored.deletedAt).toBeNull()
    expect(h.deletedCourse).not.toHaveBeenCalled()
  })

  test('a removed default review requires new creation, and restoring the old one never replaces the newer default', async () => {
    const h = host(), origin = h.courses.create({ name: 'Linear algebra', color: 'blue' })
    const create = () => h.invoke('learning:create', { placement: 'standalone', purpose: 'course-review', name: 'Review', topic: 'Algebra', linkedCourseId: origin.id, ai })
    const old = await create(), path = h.courses.getFolder(old.binding.courseId)
    expect(existsSync(join(path, '복습'))).toBe(true); expect(existsSync(join(path, '학습노트'))).toBe(true)
    for (const name of ['기사', '단어장.md', '예문 모음.md']) expect(existsSync(join(path, name))).toBe(false)
    await h.invoke('learning:delete', { binding: old.binding })
    await expect(h.invoke('study:generate', { courseId: origin.id, packId: pack.id })).rejects.toThrow('AI')
    expect(h.courses.getByIdIncludingDeleted(old.binding.courseId).deletedAt).toBeTruthy()
    const current = await create()
    expect(current.binding.courseId).not.toBe(old.binding.courseId)
    await h.invoke('learning:restore', { binding: old.binding })
    const next = await h.invoke('study:generate', { courseId: origin.id, packId: pack.id })
    expect(next.binding).toEqual(current.binding)
    await h.stop(current.binding)
    expect(h.courses.list()).toHaveLength(3)
  })

  test('deletion waits for provider cleanup, rejects new work and never starts a queued job during the drain', async () => {
    const h = host(), { binding } = await h.english()
    const running = await h.runtime.start({ binding, kind: 'create-quiz' })
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce())
    const queued = await h.runtime.start({ binding, kind: 'create-cards' })
    let release!: () => void
    // Both cleanup calls share a single gate, including the never-dispatched queued session.
    const gate = new Promise<void>(resolve => { release = resolve })
    h.close.mockImplementation(async () => gate)
    let deleted = false
    const deleting = h.invoke('learning:delete', { binding }).then(() => { deleted = true })
    await vi.waitFor(() => expect(h.close).toHaveBeenCalledTimes(2))
    await expect(h.runtime.start({ binding, kind: 'create-summary' })).rejects.toThrow('삭제')
    expect(deleted).toBe(false); expect(h.send).toHaveBeenCalledOnce()
    release(); await deleting
    const retained = await h.repo.readDeleted(binding)
    expect(retained.runs.map(run => [run.id, run.status])).toEqual([[running.runId, 'cancelled'], [queued.runId, 'cancelled']])
    expect(h.cancel).toHaveBeenCalledOnce()
    await h.invoke('learning:restore', { binding }); expect(h.send).toHaveBeenCalledOnce()
  })

  test('restoring cannot steal a retained folder that was registered under a different live course', async () => {
    const h = host(), space = await h.english(), folder = h.courses.getFolder(space.binding.courseId)
    await h.invoke('learning:delete', { binding: space.binding })
    const owner = h.courses.addFromFolder({ folderPath: folder, color: 'green' })
    expect(owner.status).toBe('ok')
    await expect(h.invoke('learning:restore', { binding: space.binding })).rejects.toThrow('다른 공간')
    expect(h.courses.getByIdIncludingDeleted(space.binding.courseId).deletedAt).toBeTruthy()
    expect((await h.repo.readDeleted(space.binding)).deletedAt).toBeTruthy()
    expect(h.courses.list()).toHaveLength(1)
  })

  test('an AI start already loading the project cannot enqueue or send after deletion begins', async () => {
    const h = host(), { binding } = await h.english(), read = h.repo.read.bind(h.repo)
    let release!: () => void, captured = false
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(h.repo, 'read').mockImplementationOnce(async target => {
      const state = await read(target); captured = true; await gate; return state
    })
    const starting = h.runtime.start({ binding, kind: 'create-quiz' })
    const rejected = expect(starting).rejects.toThrow('삭제')
    await vi.waitFor(() => expect(captured).toBe(true))
    const paused = vi.spyOn(h.runtime, 'withProjectPaused')
    const deleting = h.invoke('learning:delete', { binding })
    await vi.waitFor(() => expect(paused).toHaveBeenCalledOnce())
    await expect(h.runtime.start({ binding, kind: 'create-cards' })).rejects.toThrow('삭제')
    release(); await rejected; await deleting
    expect(h.send).not.toHaveBeenCalled(); expect((await h.repo.readDeleted(binding)).runs).toEqual([])
  })

  test('storage failures leave the old registration state intact and an unsuccessful restore rolls its course row back', async () => {
    const h = host(), space = await h.english(), folder = h.courses.getFolder(space.binding.courseId)
    const original = await readFile(join(folder, LEARNING_DATA_DIR, 'state.json'), 'utf8')
    h.failNextCommit()
    await expect(h.invoke('learning:delete', { binding: space.binding })).rejects.toThrow('storage failure')
    expect(h.courses.getById(space.binding.courseId).id).toBe(space.binding.courseId)
    expect(await readFile(join(folder, LEARNING_DATA_DIR, 'state.json'), 'utf8')).toBe(original)
    await h.invoke('learning:delete', { binding: space.binding })
    const removed = await readFile(join(folder, LEARNING_DATA_DIR, 'state.json'), 'utf8')
    h.failNextCommit()
    await expect(h.invoke('learning:restore', { binding: space.binding })).rejects.toThrow('storage failure')
    expect(h.courses.getByIdIncludingDeleted(space.binding.courseId).deletedAt).toBeTruthy()
    expect(await readFile(join(folder, LEARNING_DATA_DIR, 'state.json'), 'utf8')).toBe(removed)
    expect((await h.invoke('learning:restore', { binding: space.binding })).projectId).toBe(space.projectId)
  })

  test('a removed linked review retains original-course path changes without rewriting immutable results or its own files', async () => {
    const h = host(), origin = h.courses.create({ name: 'Linear algebra', color: 'blue' })
    const space = await h.invoke('learning:create', { placement: 'standalone', purpose: 'course-review', name: 'Review', topic: 'Algebra', linkedCourseId: origin.id, ai })
    const folder = h.courses.getFolder(space.binding.courseId)
    await writeFile(join(origin.folderPath, 'lecture.md'), 'Matrices represent linear maps.')
    await writeFile(join(folder, 'lecture.md'), 'Private review note')
    const source: LearningSourceRef = { kind: 'material', pathScope: 'course', sourceCourseId: origin.id, relPath: 'lecture.md', quote: 'Matrices represent linear maps.' }
    await createLearningGrounding(id => h.courses.getFolder(id)).validateMaterial(space.binding, source, origin.id)
    const saved = await h.repo.putArtifact({ binding: space.binding, artifact: { kind: 'cards', title: 'Matrices', cards: [{ id: 'matrix', front: 'Matrix', back: 'Linear map', sourceRefs: [source] }] } })
    const artifact = saved.artifacts[0]!, before = await readFile(join(folder, artifact.relPath), 'utf8')
    await h.runtime.start({ binding: space.binding, kind: 'create-quiz', source: { kind: 'material', relPath: 'lecture.md', sourceCourseId: origin.id } })
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce())
    await h.invoke('learning:delete', { binding: space.binding })
    expect(h.cancel).toHaveBeenCalledWith(origin.id, expect.any(String), ai.provider)
    await rename(join(origin.folderPath, 'lecture.md'), join(origin.folderPath, 'renamed.md'))
    await h.repo.repoint({ courseId: origin.id, fromRelPath: 'lecture.md', toRelPath: 'renamed.md', isDirectory: false })
    await h.invoke('learning:restore', { binding: space.binding })
    const restored = await h.repo.readArtifact(space.binding, artifact.id)
    if (restored.kind !== 'cards') throw new Error('Expected cards')
    expect(restored.cards[0]!.sourceRefs[0]).toMatchObject({ relPath: 'renamed.md', sourceCourseId: origin.id, quote: source.quote, availability: 'available' })
    expect(await readFile(join(folder, artifact.relPath), 'utf8')).toBe(before)
    expect(await readFile(join(folder, 'lecture.md'), 'utf8')).toBe('Private review note')
  })

  test('dismissing a failure preserves diagnostics and retry creates a fresh visible run with the same source', async () => {
    const h = host(), { binding } = await h.english()
    const originalSource = { kind: 'material' as const, relPath: 'retained.pdf', selection: 'Original selected quote', page: 3 }
    const started = await h.runtime.start({ binding, kind: 'create-quiz', source: originalSource })
    await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce())
    await expect(h.invoke('learning:dismissRun', { binding, runId: started.runId })).rejects.toThrow('종료')
    const sessionId = h.send.mock.calls[0]![1]
    await h.runtime.settle(sessionId, 'error', { code: 'unknown', message: 'Provider request failed' })
    const before = (await h.repo.read(binding)).runs[0]!
    const dismissed = await h.invoke('learning:dismissRun', { binding, runId: started.runId })
    expect(dismissed.runs[0]).toMatchObject({ ...before, dismissedAt: expect.any(String) })
    const retried = await h.invoke('learning:runRetry', { binding, runId: started.runId })
    const after = await h.repo.read(binding), retry = after.runs.find(run => run.id === retried.runId)!
    expect(retry.source).toEqual(originalSource); expect(retry.dismissedAt).toBeUndefined()
    expect(after.runs[0]!.dismissedAt).toBe(dismissed.runs[0]!.dismissedAt)
    await h.stop(binding)
  })

  test('publishes exact result IDs including a deduplicated article, rather than the last or input article', async () => {
    const h = host(), { binding } = await h.english()
    await h.repo.addArticle({ binding, article })
    await h.repo.addArticle({ binding, article: { ...article, id: 'unrelated-last', title: 'Unrelated', sourceUrl: 'https://example.com/other', paragraphs: splitLearningParagraphs('A telescope sees stars.') } })
    const run: LearningRun = { id: 'publishing-run', kind: 'create-quiz', provider: ai.provider, model: ai.model, effort: ai.effort, status: 'validating', articleIds: ['unrelated-last'], wordIds: [],
      message: '', error: null, draft: null, createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' }
    await h.repo.updateRun({ binding, run })
    const saved = await h.repo.importDraft({ binding, runId: run.id, draft: { version: 1, articles: [{ ...article, id: 'duplicate-submitted-id' }], artifacts: [
      { kind: 'quiz', title: 'New result', questions: [{ id: 'q1', type: 'cloze', prompt: 'The ___ is changing.', answer: 'climate', explanation: '', sourceRefs: [citation] }] }
    ] } })
    const completed = saved.runs.find(item => item.id === run.id)!
    expect(completed.resultArticleIds).toEqual([article.id])
    expect(completed.resultArtifactIds).toEqual([saved.artifacts[0]!.id]); expect(completed.status).toBe('complete')
    const state = JSON.parse(await readFile(join(h.courses.getFolder(binding.courseId), LEARNING_DATA_DIR, 'state.json'), 'utf8'))
    expect(state.runs[0].resultArtifactIds).toEqual(completed.resultArtifactIds)
  })
})
