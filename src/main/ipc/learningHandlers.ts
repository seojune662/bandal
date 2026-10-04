import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { LearningIpcContract, LearningGenerationSource } from '../../shared/ipc/learningContract'
import type { LearningBinding, LearningSourceRef, StartLearningRunInput } from '../../shared/types/learning'
import type { WorkflowPack, WorkflowPackV2, WorkflowPackScope } from '../../shared/types/workflowPack'
import type { Course } from '../../shared/types/course'
import { ValidationError } from '../db/errors'
import { requireId, requireNonEmptyString, resolveInside } from '../db/validate'
import { learningString, learningNumber, normalizeLearningArticle } from '../features/learning/validation'
import type { LearningRepo } from '../features/learning/learningRepo'
import type { createLearningRuntime } from '../features/learning/learningRuntime'
import type { createArticleExtractor } from '../features/learning/articleExtractor'
import { matchArticleWords } from '../features/learning/articleExtractor'
import type { createLearningCache } from '../features/learning/learningCache'

type Handler = <K extends keyof LearningIpcContract>(channel: K, fn: (input: LearningIpcContract[K]['req']) => LearningIpcContract[K]['res'] | Promise<LearningIpcContract[K]['res']>) => void
interface LearningHandlerDeps {
  repo: LearningRepo
  runtime: ReturnType<typeof createLearningRuntime>
  extractor: ReturnType<typeof createArticleExtractor>
  cache: ReturnType<typeof createLearningCache>
  courses: { create(input: { name: string; color: string }): Course; list(input?: { includeArchived?: boolean }): Course[]; getById(id: string): Course }
  resolvePack(id: string): WorkflowPack | null
  approvePack(id: string, courseId: string): Promise<void>
  changedCourse(): void
  assertSourceTab(courseId: string, tabId: string, url: string): void
  resolveSource(binding: LearningBinding, ref: LearningSourceRef): Promise<{ relPath: string | null; missing: boolean }>
  validateDraft?(binding: LearningBinding, draft: unknown): Promise<import('../../shared/types/learning').LearningDraft>
}

export function registerLearningHandlers(handle: Handler, deps: LearningHandlerDeps): void {
  function nativePack(id: string, kind?: StartLearningRunInput['kind']): WorkflowPackV2 {
    const pack = deps.resolvePack(id)
    if (!pack || pack.schemaVersion !== 2) throw new ValidationError('이 학습 팩은 전용 학습 화면에서 사용할 수 없습니다.')
    const kinds: readonly StartLearningRunInput['kind'][] = pack.experience === 'article-vocabulary'
      ? ['find-articles', 'explain-word'] : pack.experience === 'quiz' ? ['create-quiz'] : ['create-cards']
    if (kind !== undefined && !kinds.includes(kind)) throw new ValidationError('이 팩은 요청한 학습 작업을 지원하지 않습니다.')
    return pack
  }
  async function authorizePack(id: string, courseId: string, kind: StartLearningRunInput['kind']): Promise<WorkflowPackV2> {
    const pack = nativePack(id, kind)
    await deps.approvePack(pack.id, courseId)
    // Approval can display a dialog; recheck an enabled pack before dispatch.
    return nativePack(pack.id, kind)
  }
  async function defaultBinding(courseId: string): Promise<LearningBinding> {
    const projects = await deps.repo.discover(courseId)
    const project = projects.find(item => item.binding.rootRelPath === '') ?? projects.find(item => item.binding.rootRelPath === 'AI 학습자료')
    if (project) return project.binding
    const binding = { courseId, rootRelPath: 'AI 학습자료' }
    await deps.repo.create({ binding, name: 'AI 학습자료', topic: '과목 자료' })
    return binding
  }
  handle('learning:list', async input => {
    const courses = input.courseId ? [deps.courses.getById(input.courseId)] : deps.courses.list()
    const projects = []
    for (const course of courses) {
      if (course.missing) continue
      const found = await deps.repo.discover(course.id)
      deps.cache.replaceCourse(course.id, found)
      projects.push(...found)
    }
    return { projects }
  })
  handle('learning:create', async input => {
    if (!['standalone', 'in-course'].includes(input.placement)) throw new ValidationError('학습 공간 위치를 선택하세요.')
    const name = requireNonEmptyString(input.name, 'name')
    learningString(name, 'name', 1_000)
    learningString(input.topic, 'topic', 10_000)
    if (input.level !== undefined && !['beginner', 'intermediate', 'advanced'].includes(input.level)) throw new ValidationError('학습 수준을 선택하세요.')
    if (input.readingMinutes !== undefined) learningNumber(input.readingMinutes, 'readingMinutes', 1, 30)
    let binding: LearningBinding
    if (input.placement === 'standalone') {
      const course = deps.courses.create({ name, color: 'blue' })
      binding = { courseId: course.id, rootRelPath: '' }
      deps.changedCourse()
    } else {
      const courseId = requireId(input.courseId, 'courseId')
      deps.courses.getById(courseId)
      const rootRelPath = input.rootRelPath ?? name.replace(/[/\\:*?"<>|]/g, '').trim()
      if (!rootRelPath) throw new ValidationError('학습 폴더 이름을 입력하세요.')
      resolveInside('/learning', rootRelPath)
      binding = { courseId, rootRelPath }
    }
    return deps.repo.create({ binding, name, topic: input.topic, ...(input.level ? { level: input.level } : {}), ...(input.readingMinutes === undefined ? {} : { readingMinutes: input.readingMinutes }) })
  })
  handle('learning:get', async input => {
    const snapshot = await deps.runtime.recover(input.binding)
    deps.cache.index(snapshot)
    return snapshot
  })
  handle('learning:getArticle', input => deps.repo.readArticle(input.binding, input.id))
  handle('learning:getArtifact', input => deps.repo.readArtifact(input.binding, input.id))
  handle('learning:resolveSource', input => deps.resolveSource(input.binding, input.sourceRef))
  handle('learning:addArticle', async input => {
    if (input.tabId) deps.assertSourceTab(input.binding.courseId, input.tabId, input.url)
    const article = input.tabId ? await deps.extractor.extractSourceTab(input.tabId) : await deps.extractor.extractUrl(input.url)
    const state = await deps.repo.read(input.binding)
    article.matchedWordIds = [...new Set(matchArticleWords(article, state.words.map(word => ({ id: word.id, surface: word.surface, forms: [word.lemma,
      ...state.occurrences.filter(occurrence => occurrence.wordId === word.id).map(occurrence => occurrence.surface)] }))).map(match => match.wordId))]
    const normalized = normalizeLearningArticle(article, article.id ?? randomUUID(), new Date().toISOString())
    const snapshot = await deps.repo.addArticle({ binding: input.binding, article: { ...article, ...normalized } })
    // Resolve the exact repository deduplication identity, including a mirrored
    // article already retained under another source URL.
    const added = snapshot.articles.find(item => item.canonicalUrl === normalized.canonicalUrl || item.contentHash === normalized.contentHash)
    if (!added) throw new Error('저장한 기사 식별자를 찾지 못했습니다.')
    return { ...snapshot, addedArticleId: added.id }
  })
  handle('learning:saveWord', input => deps.repo.saveWord(input))
  handle('learning:updateWord', input => deps.repo.updateWord(input))
  handle('learning:updateOccurrence', input => deps.repo.updateOccurrence(input))
  handle('learning:saveProgress', input => deps.repo.saveProgress(input))
  handle('learning:completeArticle', input => deps.repo.completeArticle(input))
  handle('learning:saveQuizAnswer', input => deps.repo.saveQuizAnswer(input))
  handle('learning:finishQuiz', input => deps.repo.finishQuiz(input))
  handle('learning:reviewCard', input => deps.repo.reviewCard(input))
  handle('learning:run', async input => {
    if (input.packId !== undefined) await authorizePack(input.packId, input.binding.courseId, input.kind)
    return deps.runtime.start(input)
  })
  handle('learning:runCancel', input => deps.runtime.cancel(input.binding, input.runId))
  handle('learning:runRetry', async input => {
    const project = await deps.repo.read(input.binding)
    const run = project.runs.find(item => item.id === input.runId)
    if (!run) throw new ValidationError('다시 실행할 학습 작업을 찾지 못했습니다.')
    if (run.packId !== undefined) await authorizePack(run.packId, input.binding.courseId, run.kind)
    return deps.runtime.retry(input.binding, input.runId)
  })
  handle('learning:importPreview', input => deps.runtime.start({ binding: input.binding, kind: 'import-material', source: { kind: 'material', relPath: input.relPath } }))
  handle('learning:importSave', async input => {
    if (!input.runId) throw new ValidationError('가져오기 미리보기를 먼저 실행하세요.')
    const project = await deps.repo.read(input.binding)
    const run = project.runs.find(item => item.id === input.runId)
    if (run?.status === 'complete') return project
    if (run?.status !== 'awaiting-confirmation' || !run.draft) throw new ValidationError('저장할 가져오기 미리보기가 없습니다.')
    const draft = deps.validateDraft ? await deps.validateDraft(input.binding, input.draft) : run.draft
    return deps.repo.importDraft({ binding: input.binding, draft, runId: run.id })
  })
  handle('study:generate', async input => {
    const pack = nativePack(input.packId)
    const source: LearningGenerationSource = input.source ?? { kind: 'course' }
    const kind: StartLearningRunInput['kind'] = pack.experience === 'article-vocabulary' ? 'find-articles' : pack.experience === 'quiz' ? 'create-quiz' : 'create-cards'
    // Saved articles/vocabulary are project materials. Live browser-tab sources
    // are added through the validated article import endpoint, not this DTO.
    const scope: WorkflowPackScope = source.selection?.trim() ? 'selection' : source.kind === 'course' ? 'course' : 'material'
    if (!pack.worksOn.includes(scope)) throw new ValidationError('이 팩은 선택한 자료 범위에서 사용할 수 없습니다.')
    if (source.kind === 'material' && !source.relPath?.trim()) throw new ValidationError('대상 자료를 선택하세요.')
    if (source.relPath && (posix.isAbsolute(source.relPath) || source.relPath.split('/').includes('..'))) throw new ValidationError('올바른 자료 경로가 필요합니다.')
    const authorized = await authorizePack(pack.id, input.courseId, kind)
    if (!authorized.worksOn.includes(scope)) throw new ValidationError('이 팩은 선택한 자료 범위에서 사용할 수 없습니다.')
    const binding = input.rootRelPath === undefined ? await defaultBinding(input.courseId) : { courseId: input.courseId, rootRelPath: input.rootRelPath }
    return deps.runtime.start({ binding, kind, packId: pack.id, source, ...(source.articleIds ? { articleIds: source.articleIds } : {}), ...(source.wordIds ? { wordIds: source.wordIds } : {}) })
  })
}
