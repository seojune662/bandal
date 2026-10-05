import { mkdtemp, mkdir, writeFile, readFile, rename, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLearningRepo, LEARNING_DATA_DIR } from '../../../src/main/features/learning/learningRepo'
import { createLearningGrounding } from '../../../src/main/features/learning/learningGrounding'
import { createLearningCache } from '../../../src/main/features/learning/learningCache'
import { createCoursesRepo } from '../../../src/main/features/courses/coursesRepo'
import { registerLearningHandlers } from '../../../src/main/ipc/learningHandlers'
import { createTestDb, type TestDb } from '../helpers/testDb'
import type { LearningIpcContract } from '../../../src/shared/ipc/learningContract'
import type { LearningAiSettings, LearningSourceRef } from '../../../src/shared/types/learning'
import type { WorkflowPackV2 } from '../../../src/shared/types/workflowPack'
import { splitLearningParagraphs } from '../../../src/main/features/learning/model'

const ai: LearningAiSettings = { provider: 'codex', model: 'chosen-model', effort: null }
const quizPack: WorkflowPackV2 = { schemaVersion: 2, id: 'builtin:quiz', name: 'Quiz', description: '', author: 'Bandal', version: '1', locale: 'ko-KR',
  experience: 'quiz', worksOn: ['course', 'material', 'selection'], recipe: 'quiz', allowedTools: ['learning_submit_result'], usesWeb: false, outputs: { dir: '복습', primary: '퀴즈' } }

describe('learning workspace purpose and origin', () => {
  let ctx: TestDb
  beforeEach(() => { ctx = createTestDb() })
  afterEach(() => ctx.cleanup())
  function host() {
    const courses = createCoursesRepo({ db: ctx.db, getDataRoot: () => join(ctx.dir, 'data') })
    const repo = createLearningRepo({ getCourseFolder: id => courses.getFolder(id), listCourseIds: () => courses.list().map(course => course.id) })
    const handlers = new Map<keyof LearningIpcContract, (input: unknown) => unknown>()
    const start = vi.fn(async (input: { binding: { courseId: string; rootRelPath: string } }) => ({ binding: input.binding, runId: 'started' }))
    const validateAi = vi.fn(async (settings: LearningAiSettings) => settings)
    const assertSourceTab = vi.fn()
    registerLearningHandlers((channel, handler) => handlers.set(channel, handler as (input: unknown) => unknown), {
      repo, courses, cache: createLearningCache(ctx.db), runtime: { start } as never,
      resolvePack: () => quizPack, approvePack: async () => undefined, validateAi, changedCourse: vi.fn(), assertSourceTab,
      extractor: { extractSourceTab: async () => ({ title: 'Science', sourceUrl: 'https://example.com/science', paragraphs: splitLearningParagraphs('Scientific evidence helps people understand the world.') }) } as never,
      resolveSource: async () => ({ relPath: null, missing: true })
    })
    const invoke = <K extends keyof LearningIpcContract>(channel: K, input: LearningIpcContract[K]['req']): Promise<LearningIpcContract[K]['res']> => Promise.resolve().then(() => handlers.get(channel)!(input)) as Promise<LearningIpcContract[K]['res']>
    return { courses, repo, invoke, start, validateAi, assertSourceTab }
  }
  test('first generic generations share one independent review without classifying or moving legacy files', async () => {
    const h = host(), original = h.courses.create({ name: '선형대수학', color: 'blue' })
    await writeFile(join(original.folderPath, 'lesson.md'), 'A matrix represents a linear map.')
    const legacyBinding = { courseId: original.id, rootRelPath: 'AI 학습자료' }
    await h.repo.create({ binding: legacyBinding, name: 'AI 학습자료', topic: '과목 자료' })
    const legacyPath = join(original.folderPath, legacyBinding.rootRelPath, LEARNING_DATA_DIR, 'state.json')
    const before = await readFile(legacyPath, 'utf8')
    await expect(h.invoke('study:generate', { courseId: original.id, packId: quizPack.id })).rejects.toThrow('AI')
    expect(h.courses.list()).toHaveLength(1)
    const [first, second] = await Promise.all([
      h.invoke('study:generate', { courseId: original.id, packId: quizPack.id, ai, source: { kind: 'material', relPath: 'lesson.md' } }),
      h.invoke('study:generate', { courseId: original.id, packId: quizPack.id, ai })
    ])
    expect(first.binding).toEqual(second.binding)
    expect(first.binding.courseId).not.toBe(original.id); expect(first.binding.rootRelPath).toBe('')
    expect(h.courses.getById(first.binding.courseId).workspaceKind).toBe('study-space')
    const review = await h.repo.read(first.binding)
    expect(review).toMatchObject({ purpose: 'course-review', linkedCourseId: original.id, readingSetupConfirmed: false, topicIds: [], ai })
    expect(h.start.mock.calls[0]?.[0]).toMatchObject({ source: { sourceCourseId: original.id } })
    expect(await readFile(legacyPath, 'utf8')).toBe(before)
    expect(await readFile(join(original.folderPath, 'lesson.md'), 'utf8')).toBe('A matrix represents a linear map.')
    expect((await h.invoke('learning:list', { courseId: original.id })).projects.map(project => project.purpose).sort()).toEqual(['course-review', 'unclassified'])
    await h.invoke('study:generate', { courseId: original.id, packId: quizPack.id })
    expect(h.courses.list()).toHaveLength(2)
  })
  test('English setup validates explicit choices before creating a folder and never infers legacy container kind', async () => {
    const h = host()
    const request: LearningIpcContract['learning:create']['req'] = { placement: 'standalone', name: 'Science reading', topic: '과학', purpose: 'english-reading', topicIds: ['science'], readingSetupConfirmed: true, ai, level: 'intermediate', readingMinutes: 4 }
    await expect(h.invoke('learning:create', { ...request, topicIds: ['not-a-topic'] })).rejects.toThrow('주제')
    await expect(h.invoke('learning:create', { ...request, level: undefined } as unknown as typeof request)).rejects.toThrow('수준')
    h.validateAi.mockRejectedValueOnce(new Error('Login required'))
    await expect(h.invoke('learning:create', request)).rejects.toThrow('Login required')
    expect(h.courses.list()).toHaveLength(0)
    const created = await h.invoke('learning:create', request)
    expect(created).toMatchObject({ purpose: 'english-reading', topicIds: ['science'], ai })
    const legacy = h.courses.create({ name: 'Existing course', color: 'green' }), binding = { courseId: legacy.id, rootRelPath: '' }
    await h.repo.create({ binding, name: legacy.name, topic: 'old' })
    await h.invoke('learning:updateSettings', { binding, purpose: 'english-reading', topicIds: ['science'], readingSetupConfirmed: true, level: 'beginner', readingMinutes: 3, ai })
    expect(h.courses.getById(legacy.id).workspaceKind).toBe('course')
    await h.invoke('learning:updateSettings', { binding, workspaceKind: 'study-space' })
    expect(h.courses.getById(legacy.id).workspaceKind).toBe('study-space')
    expect(h.courses.getById(legacy.id).folderPath).toBe(legacy.folderPath)
  })
  test('recognizes only the exact legacy review marker without rewriting records, paths or course kind', async () => {
    const h = host(), original = h.courses.create({ name: '선형대수학', color: 'blue' })
    const binding = { courseId: original.id, rootRelPath: 'arbitrary-location' }
    await h.repo.create({ binding, name: 'AI 학습자료', topic: '과목 자료' })
    await h.repo.addArticle({ binding, article: { id: 'existing-article', title: 'Saved article', sourceUrl: 'https://example.com/saved', paragraphs: splitLearningParagraphs('Existing article evidence is preserved.') } })
    const statePath = join(original.folderPath, binding.rootRelPath, LEARNING_DATA_DIR, 'state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    delete state.purpose; delete state.topicIds; delete state.readingSetupConfirmed
    const legacyBytes = `${JSON.stringify(state)}\n`
    await writeFile(statePath, legacyBytes)
    const restored = await h.repo.read(binding)
    expect(restored.purpose).toBe('course-review'); expect(restored.readingSetupConfirmed).toBe(false)
    expect(restored.articles.map(article => article.id)).toEqual(['existing-article'])
    expect(h.courses.getById(original.id).workspaceKind).toBe('course')
    expect(await readFile(statePath, 'utf8')).toBe(legacyBytes)
    state.name = 'My AI 学習資料'
    const uncertainBytes = `${JSON.stringify(state)}\n`
    await writeFile(statePath, uncertainBytes)
    expect((await h.repo.read(binding)).purpose).toBe('unclassified')
    expect(await readFile(statePath, 'utf8')).toBe(uncertainBytes)
  })
  test('imports an origin-owned browser tab into an independent English space without linking private course files', async () => {
    const h = host(), origin = h.courses.create({ name: 'Origin', color: 'blue' })
    const target = await h.invoke('learning:create', { placement: 'standalone', name: 'Reading', topic: '과학', purpose: 'english-reading', topicIds: ['science'], readingSetupConfirmed: true, ai, level: 'intermediate', readingMinutes: 4 })
    const imported = await h.invoke('learning:addArticle', { binding: target.binding, sourceCourseId: origin.id, tabId: 'origin-tab', url: 'https://example.com/science' })
    expect(h.assertSourceTab).toHaveBeenCalledWith(origin.id, 'origin-tab', 'https://example.com/science')
    expect(imported.addedArticleId).toBe(imported.articles[0]?.id)
    expect(imported.linkedCourseId).toBeUndefined()
    await expect(h.invoke('study:generate', { courseId: origin.id, binding: target.binding, packId: quizPack.id, source: { kind: 'material', relPath: 'private.md' } })).rejects.toThrow('연결되지 않은')
  })
})

test('retained citations follow only their original course paths, while independent review files and immutable snapshots remain intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bandal-learning-origin-'))
  try {
    const original = join(directory, 'original'), review = join(directory, 'review')
    await mkdir(original); await mkdir(review)
    const folders = new Map([['origin', original], ['review', review]])
    const getCourseFolder = (id: string) => { const folder = folders.get(id); if (!folder) throw new Error('Missing source course'); return folder }
    const repo = createLearningRepo({ getCourseFolder, listCourseIds: () => [...folders.keys()] })
    const binding = { courseId: 'review', rootRelPath: '' }
    await repo.create({ binding, name: 'Review', topic: 'Matrices', purpose: 'course-review', linkedCourseId: 'origin', topicIds: [], readingSetupConfirmed: false, ai })
    await writeFile(join(original, 'note.md'), 'Matrices represent linear maps.')
    await writeFile(join(review, 'note.md'), 'Vectors belong to a vector space.')
    const originRef: LearningSourceRef = { kind: 'material', pathScope: 'course', sourceCourseId: 'origin', relPath: 'note.md', quote: 'Matrices represent linear maps.' }
    const ownRef: LearningSourceRef = { kind: 'material', pathScope: 'course', relPath: 'note.md', quote: 'Vectors belong to a vector space.' }
    const grounding = createLearningGrounding(getCourseFolder)
    await grounding.validateMaterial(binding, originRef, 'origin'); await grounding.validateMaterial(binding, ownRef)
    await repo.saveWord({ binding, surface: 'Matrices', sentence: originRef.quote, sourceRef: originRef })
    await repo.saveWord({ binding, surface: 'Vectors', sentence: ownRef.quote, sourceRef: ownRef })
    await repo.putArtifact({ binding, artifact: { kind: 'cards', title: 'Evidence', cards: [
      { id: 'matrix', front: 'Matrices', back: 'Linear maps', sourceRefs: [originRef] },
      { id: 'vector', front: 'Vectors', back: 'Vector space', sourceRefs: [ownRef] }
    ] } })
    const before = await repo.read(binding), artifactId = before.artifacts[0]!.id
    const immutablePath = join(review, before.artifacts[0]!.relPath), immutableBytes = await readFile(immutablePath, 'utf8')
    await mkdir(join(original, 'unit')); await rename(join(original, 'note.md'), join(original, 'unit', 'renamed.md'))
    await repo.repoint({ courseId: 'origin', fromRelPath: 'note.md', toRelPath: 'unit/renamed.md', isDirectory: false })
    const after = await repo.read(binding)
    expect(after.occurrences.map(occurrence => occurrence.sourceRef.relPath)).toEqual(['unit/renamed.md', 'note.md'])
    expect(after.occurrences.map(occurrence => occurrence.sourceRef.availability)).toEqual(['available', 'available'])
    const artifact = await repo.readArtifact(binding, artifactId)
    expect(artifact.kind).toBe('cards')
    if (artifact.kind === 'cards') expect(artifact.cards.map(card => card.sourceRefs[0]?.relPath)).toEqual(['unit/renamed.md', 'note.md'])
    expect(await readFile(immutablePath, 'utf8')).toBe(immutableBytes)
    expect(await grounding.resolve(binding, after.occurrences[0]!.sourceRef, 'origin')).toEqual({ relPath: 'unit/renamed.md', sourceCourseId: 'origin', missing: false })
    await expect(grounding.validateMaterial(binding, { ...originRef, sourceCourseId: 'unlinked' }, 'origin')).rejects.toThrow('연결되지 않은')
    folders.delete('origin')
    const missing = await repo.read(binding)
    expect(missing.occurrences[0]?.sourceRef.availability).toBe('missing')
    expect(missing.occurrences[0]?.sentence).toBe(originRef.quote)
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test('course-scoped local aliases remain portable when a moved project is copied and relinked under a new owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bandal-learning-local-alias-'))
  try {
    const original = join(directory, 'original'), copied = join(directory, 'copied')
    await mkdir(original)
    const folders = new Map([['original-owner', original], ['copied-owner', copied]])
    const repo = createLearningRepo({ getCourseFolder: id => folders.get(id)!, listCourseIds: () => ['original-owner'] })
    const binding = { courseId: 'original-owner', rootRelPath: '' }
    await repo.create({ binding, name: 'Portable', topic: 'Kept evidence' })
    await writeFile(join(original, 'note.md'), 'Retained local source evidence.')
    const source: LearningSourceRef = { kind: 'material', pathScope: 'course', relPath: 'note.md', quote: 'Retained local source evidence.' }
    await createLearningGrounding(id => folders.get(id)!).validateMaterial(binding, source)
    const saved = await repo.putArtifact({ binding, artifact: { kind: 'summary', title: 'Kept summary', markdown: 'Retained explanation', sourceRefs: [source] } })
    const artifact = saved.artifacts[0]!
    await rename(join(original, 'note.md'), join(original, 'renamed.md'))
    await repo.repoint({ courseId: binding.courseId, fromRelPath: 'note.md', toRelPath: 'renamed.md', isDirectory: false })
    const originalSnapshot = await readFile(join(original, artifact.relPath), 'utf8')
    await cp(original, copied, { recursive: true })
    const copyBinding = { courseId: 'copied-owner', rootRelPath: '' }
    const restored = await repo.readArtifact(copyBinding, artifact.id)
    expect(restored.sourceRefs[0]).toMatchObject({ relPath: 'renamed.md', availability: 'available', quote: source.quote, contentHash: source.contentHash })
    expect(await readFile(join(copied, artifact.relPath), 'utf8')).toBe(originalSnapshot)
    expect((await repo.read(copyBinding)).projectId).toBe(saved.projectId)
    expect(await readFile(join(copied, 'renamed.md'), 'utf8')).toBe(source.quote)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
