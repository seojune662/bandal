import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { LearningArticleInput, LearningArtifactDraft, LearningBinding, LearningDraft, LearningRun, LearningSourceRef } from '../../../src/shared/types/learning'
import { createLearningRepo, LEARNING_DATA_DIR, type LearningRepo } from '../../../src/main/features/learning/learningRepo'
import { learningHash, splitLearningParagraphs } from '../../../src/main/features/learning/model'

describe('portable learning projects', () => {
  let directory: string
  let course: string
  let clock: string
  let failCommit: boolean
  let repo: LearningRepo
  const binding: LearningBinding = { courseId: 'course-1', rootRelPath: '영어' }
  const source: LearningSourceRef = { kind: 'article', articleId: 'article-1', paragraphId: 'p1', sentenceId: 'p1-s1', quote: 'climate', start: 4, end: 11 }
  const article = (overrides: Partial<LearningArticleInput> = {}): LearningArticleInput => ({
    id: 'article-1', title: 'A changing climate', sourceUrl: 'https://example.com/climate?utm_source=test',
    paragraphs: splitLearningParagraphs('The climate is changing quickly. Scientists study the evidence.\n\nPeople adapt to a warmer world.'),
    ...overrides
  })
  const quiz = (): LearningArtifactDraft => ({
    id: 'quiz-1', kind: 'quiz', title: 'Climate quiz', articleIds: ['article-1'], questions: [
      { id: 'q1', type: 'choice', prompt: 'What is changing?', options: [{ id: 'a', text: 'The climate' }, { id: 'b', text: 'The moon' }], answer: 'a', explanation: 'The opening sentence says so.', sourceRefs: [source] },
      { id: 'q2', type: 'cloze', prompt: 'The ___ is changing quickly.', answer: 'climate', explanation: 'A term about weather over time.', sourceRefs: [source] },
      { id: 'q3', type: 'short-answer', prompt: 'Explain climate.', answer: '', modelAnswer: 'Weather patterns over time.', checkingPoints: ['Mentions long-term patterns'], explanation: '', sourceRefs: [source] }
    ]
  })
  const cards = (id: string): LearningArtifactDraft => ({ id, kind: 'cards', title: 'Climate cards', cards: [
    { id: 'draft-card', front: 'climate', back: '기후', sourceRefs: [source] }
  ] })
  const statePath = (): string => join(course, binding.rootRelPath, LEARNING_DATA_DIR, 'state.json')
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bandal-learning-'))
    course = join(directory, 'course'); mkdirSync(course)
    clock = '2026-10-04T00:00:00.000Z'; failCommit = false
    repo = createLearningRepo({ getCourseFolder: () => course, now: () => clock,
      beforeCommit: () => { if (failCommit) { failCommit = false; throw new Error('injected commit failure') } } })
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))
  async function create(): Promise<void> { await repo.create({ binding, name: '영어 읽기', topic: 'Climate' }) }
  async function seed(): Promise<void> { await create(); await repo.addArticle({ binding, article: article() }) }

  test('creates editable vocabulary documents immediately and preserves existing user text', async () => {
    await create()
    expect(readFileSync(join(course, binding.rootRelPath, '단어장.md'), 'utf8')).toContain('모르는 표현')
    expect(existsSync(join(course, binding.rootRelPath, '예문 모음.md'))).toBe(true)
    await repo.addArticle({ binding, article: article() })
    await repo.saveWord({ binding, surface: 'climate', sentence: 'The climate is changing quickly.', sourceRef: source })
    expect(readFileSync(join(course, binding.rootRelPath, '단어장.md'), 'utf8')).toContain('climate')
    mkdirSync(join(course, 'existing'))
    writeFileSync(join(course, 'existing', '단어장.md'), 'My edited vocabulary')
    await repo.create({ binding: { ...binding, rootRelPath: 'existing' }, name: 'Existing', topic: 'Words' })
    expect(readFileSync(join(course, 'existing', '단어장.md'), 'utf8')).toBe('My edited vocabulary')
  })

  test('creates a subfolder and independently restores a copied project without application DB', async () => {
    await seed()
    const saved = await repo.saveWord({ binding, surface: 'climate', sentence: 'The climate is changing quickly.', sourceRef: source })
    cpSync(join(course, binding.rootRelPath), join(course, '복사본'), { recursive: true })
    const copyBinding = { ...binding, rootRelPath: '복사본' }
    const copyRepo = createLearningRepo({ getCourseFolder: () => course })
    const copy = await copyRepo.read(copyBinding)
    expect(copy.projectId).toBe(saved.projectId)
    expect(copy.words).toEqual(saved.words)
    await copyRepo.updateWord({ binding: copyBinding, wordId: copy.words[0]!.id, status: 'known' })
    expect((await repo.read(binding)).words[0]!.status).toBe('new')
    expect((await repo.discover(binding.courseId)).map((project) => project.binding.rootRelPath).sort()).toEqual(['복사본', '영어'])
    expect(readFileSync(statePath(), 'utf8')).not.toContain(course)
    expect(readFileSync(statePath(), 'utf8')).not.toContain('course-1')
  })
  test('normalizes source URL and content hash; prevents duplicate recommendations without erasing progress', async () => {
    await seed()
    await repo.saveProgress({ binding, articleId: 'article-1', paragraphId: 'p1', scrollFraction: 0.4 })
    const snapshot = await repo.addArticle({ binding, article: article({ id: 'other-id', sourceUrl: 'https://example.com/climate#top' }) })
    expect(snapshot.articles).toHaveLength(1)
    expect(snapshot.articles[0]!.progress.scrollFraction).toBe(0.4)
    const loaded = await repo.readArticle(binding, 'article-1')
    expect(loaded.sourceUrl).toBe('https://example.com/climate')
    expect(loaded.contentHash).toHaveLength(64)
  })
  test('captures exact sentence and shares vocabulary across article encounters without declaring knowledge', async () => {
    await seed()
    await repo.saveWord({ binding, surface: 'climate', lemma: 'climate', sentence: 'untrusted extra text', sourceRef: source })
    await repo.saveWord({ binding, surface: 'climate', sentence: 'untrusted extra text', sourceRef: source })
    await repo.addArticle({ binding, article: article({ id: 'article-2', sourceUrl: 'https://example.com/second', paragraphs: splitLearningParagraphs('A climate expert studies changing weather.') }) })
    const result = await repo.saveWord({ binding, surface: 'climate', sentence: 'A climate expert studies changing weather.', sourceRef: {
      kind: 'article', articleId: 'article-2', paragraphId: 'p1', sentenceId: 'p1-s1', quote: 'climate', start: 2, end: 9
    } })
    expect(result.words).toHaveLength(1); expect(result.occurrences).toHaveLength(2)
    expect(result.occurrences[0]!.sentence).toBe('The climate is changing quickly.')
    expect(result.words[0]!.status).toBe('new')
    expect(result.occurrences[0]!.sourceRef.contentHash).toBe(result.articles[0]!.contentHash)
  })
  test('rejects an article citation with a different content hash before changing vocabulary', async () => {
    await seed()
    await expect(repo.saveWord({ binding, surface: 'climate', sentence: 'x', sourceRef: { ...source, contentHash: 'f'.repeat(64) } })).rejects.toThrow('해시')
    expect((await repo.read(binding)).words).toHaveLength(0)
  })
  test('rejects modified article attribution even when the body hash still matches', async () => {
    await seed()
    const path = join(course, binding.rootRelPath, LEARNING_DATA_DIR, 'articles/article-1.json')
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    saved.sourceUrl = 'https://other.example/forged'
    writeFileSync(path, JSON.stringify(saved, null, 2))
    await expect(repo.readArticle(binding, 'article-1')).rejects.toThrow('출처')
  })
  test('imports an old vocabulary table as common words and occurrences, then uses them in a quiz', async () => {
    await create()
    const row = '| climate | 기후 |'
    const markdown = `# 단어장\n\n| 단어 | 뜻 |\n| --- | --- |\n${row}\n`
    writeFileSync(join(course, 'old-words.md'), markdown)
    const ref: LearningSourceRef = { kind: 'material', pathScope: 'course', relPath: 'old-words.md', quote: row, contentHash: learningHash(markdown) }
    const draft: LearningDraft = { version: 1, words: [{ surface: 'climate', meaning: '기후', sentence: row, sourceRef: ref }] }
    const timestamp = clock
    const run: LearningRun = { id: 'import-old', kind: 'import-material', provider: 'codex', status: 'awaiting-confirmation', articleIds: [], wordIds: [], source: { kind: 'material', relPath: 'old-words.md' }, message: '', error: null, draft, createdAt: timestamp, updatedAt: timestamp }
    await repo.updateRun({ binding, run })
    const saved = await repo.importDraft({ binding, draft, runId: run.id })
    expect(saved.words).toHaveLength(1); expect(saved.occurrences).toHaveLength(1)
    expect(saved.occurrences[0]).toMatchObject({ wordId: saved.words[0]!.id, sentence: row, meaning: '기후' })
    const duplicate = await repo.importDraft({ binding, draft, runId: run.id })
    expect(duplicate.revision).toBe(saved.revision); expect(duplicate.history).toEqual(saved.history)
    const withQuiz = await repo.putArtifact({ binding, artifact: { kind: 'quiz', title: '가져온 단어 복습', wordIds: [saved.words[0]!.id], questions: [{ id: 'import-q1', type: 'cloze', prompt: '기후의 영어 표현은?', answer: 'climate', explanation: '기존 단어장에 있는 표현이에요.', wordId: saved.words[0]!.id, sourceRefs: [ref] }] } })
    await repo.saveQuizAnswer({ binding, artifactId: withQuiz.artifacts[0]!.id, attemptId: 'import-attempt', questionId: 'import-q1', answer: 'Climate' })
    expect((await repo.finishQuiz({ binding, artifactId: withQuiz.artifacts[0]!.id, attemptId: 'import-attempt' })).quizAttempts[0]).toMatchObject({ score: 1, total: 1 })
    expect(readFileSync(join(course, binding.rootRelPath, '단어장.md'), 'utf8')).toContain(row)
  })
  test('rejects a malformed imported word batch without saving earlier valid entries', async () => {
    await seed()
    const before = await repo.read(binding)
    await expect(repo.importDraft({ binding, draft: { version: 1, words: [
      { surface: 'climate', sentence: 'x', sourceRef: source },
      { surface: 'invented', sentence: 'invented sentence', sourceRef: source }
    ] } })).rejects.toThrow('원문')
    expect(await repo.read(binding)).toEqual(before)
  })
  test('cannot save the results of a cancelled import preview', async () => {
    await seed()
    const draft: LearningDraft = { version: 1, artifacts: [quiz()] }
    await repo.updateRun({ binding, run: { id: 'cancelled-import', kind: 'import-material', provider: 'codex', status: 'cancelled', articleIds: [], wordIds: [], message: '', error: null, draft: null, createdAt: clock, updatedAt: clock } })
    const before = await repo.read(binding)
    await expect(repo.importDraft({ binding, draft, runId: 'cancelled-import' })).rejects.toThrow('상태')
    expect(await repo.read(binding)).toEqual(before)
  })
  test('repoints a vocabulary preview and keeps its moved source despite a stale adapter update', async () => {
    await create()
    const row = '| climate | 기후 |'
    writeFileSync(join(course, 'old.md'), row)
    const draft: LearningDraft = { version: 1, words: [{ surface: 'climate', sentence: row, sourceRef: { kind: 'material', pathScope: 'course', relPath: 'old.md', quote: row, contentHash: learningHash(row) } }] }
    const run: LearningRun = { id: 'moved-preview', kind: 'import-material', provider: 'codex', status: 'awaiting-confirmation', articleIds: [], wordIds: [], source: { kind: 'material', relPath: 'old.md' }, message: '', error: null, draft, createdAt: clock, updatedAt: clock }
    await repo.updateRun({ binding, run })
    renameSync(join(course, 'old.md'), join(course, 'new.md'))
    await repo.repoint({ courseId: binding.courseId, fromRelPath: 'old.md', toRelPath: 'new.md', isDirectory: false })
    const moved = (await repo.read(binding)).runs[0]!
    expect(moved.draft!.words![0]!.sourceRef.relPath).toBe('new.md')
    await repo.updateRun({ binding, run: { ...run, status: 'interrupted', draft: null } })
    expect((await repo.read(binding)).runs[0]!.source?.relPath).toBe('new.md')
    await repo.updateRun({ binding, run: moved })
    expect((await repo.importDraft({ binding, runId: moved.id, draft: moved.draft! })).words).toHaveLength(1)
  })
  test('preserves homonyms and ambiguous lemmas but reuses a surface after AI lemmatization', async () => {
    await seed()
    let result = await repo.saveWord({ binding, surface: 'climate', sentence: 'x', sourceRef: source, partOfSpeech: 'noun' })
    result = await repo.saveWord({ binding, surface: 'climate', sentence: 'x', sourceRef: source, partOfSpeech: 'verb' })
    expect(result.words).toHaveLength(2)
    result = await repo.saveWord({ binding, surface: 'climate', sentence: 'x', sourceRef: source, lemma: 'different' })
    expect(result.words).toHaveLength(3)
    const changingSource: LearningSourceRef = { kind: 'article', articleId: 'article-1', paragraphId: 'p1', sentenceId: 'p1-s1', quote: 'changing' }
    result = await repo.saveWord({ binding, surface: 'changing', sentence: 'x', sourceRef: changingSource })
    const changing = result.words.find(word => word.surface === 'changing')!
    await repo.updateWord({ binding, wordId: changing.id, lemma: 'change' })
    await repo.addArticle({ binding, article: article({ id: 'article-2', sourceUrl: 'https://example.com/changing', paragraphs: splitLearningParagraphs('A changing world needs careful study.') }) })
    result = await repo.saveWord({ binding, surface: 'changing', sentence: 'x', sourceRef: { kind: 'article', articleId: 'article-2', quote: 'changing' } })
    expect(result.words.filter(word => word.surface === 'changing')).toHaveLength(1)
    expect(result.occurrences.filter(occurrence => occurrence.wordId === changing.id)).toHaveLength(2)
  })
  test('rejects invented occurrence text and offsets before committing', async () => {
    await seed()
    const before = readFileSync(statePath(), 'utf8')
    await expect(repo.saveWord({ binding, surface: 'planet', sentence: 'The planet.', sourceRef: { ...source, quote: 'planet' } })).rejects.toThrow('예문')
    await expect(repo.saveWord({ binding, surface: 'climate', sentence: 'x', sourceRef: { ...source, start: 0 } })).rejects.toThrow('위치')
    expect(readFileSync(statePath(), 'utf8')).toBe(before)
  })
  test('serializes simultaneous windows and rejects stale revisions instead of losing a word', async () => {
    await seed()
    const initial = await repo.read(binding)
    const outcomes = await Promise.allSettled([
      repo.saveProgress({ binding, expectedRevision: initial.revision, articleId: 'article-1', paragraphId: 'p1', scrollFraction: 0.2 }),
      repo.completeArticle({ binding, expectedRevision: initial.revision, articleId: 'article-1' })
    ])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await repo.read(binding)).revision).toBe(initial.revision + 1)
  })
  test('a failed state publication leaves the previous project intact and allows retry', async () => {
    await create()
    const initial = readFileSync(statePath(), 'utf8')
    failCommit = true
    await expect(repo.addArticle({ binding, article: article() })).rejects.toThrow('injected')
    expect(readFileSync(statePath(), 'utf8')).toBe(initial)
    clock = '2026-10-05T00:00:00.000Z'
    const result = await repo.addArticle({ binding, article: article() })
    expect(result.articles).toHaveLength(1)
    expect(readdirSync(join(course, binding.rootRelPath, LEARNING_DATA_DIR)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })
  test('recovers previous complete state and preserves damaged state on the next commit', async () => {
    await seed()
    await repo.completeArticle({ binding, articleId: 'article-1' })
    writeFileSync(statePath(), '{broken')
    const recovered = await repo.read(binding)
    expect(recovered.recovery).toBe('previous')
    expect(recovered.articles).toHaveLength(1)
    expect(recovered.articles[0]!.status).toBe('unread')
    await repo.completeArticle({ binding, articleId: 'article-1' })
    const corrupt = readdirSync(dirnameForState()).find((name) => name.startsWith('state.json.corrupt-'))!
    expect(readFileSync(join(dirnameForState(), corrupt), 'utf8')).toBe('{broken')
    expect((await repo.read(binding)).articles[0]!.status).toBe('completed')
  })
  function dirnameForState(): string { return join(course, binding.rootRelPath, LEARNING_DATA_DIR) }
  test('does not roll a future schema backwards to an older backup', async () => {
    await create()
    const state = JSON.parse(readFileSync(statePath(), 'utf8')) as Record<string, unknown>
    state['schemaVersion'] = 2; writeFileSync(statePath(), JSON.stringify(state))
    await expect(repo.read(binding)).rejects.toThrow('지원하지 않는')
    expect(JSON.parse(readFileSync(statePath(), 'utf8')).schemaVersion).toBe(2)
  })
  test('recovers structurally damaged records instead of exposing a half-valid project', async () => {
    await seed(); await repo.completeArticle({ binding, articleId: 'article-1' })
    const state = JSON.parse(readFileSync(statePath(), 'utf8'))
    state.articles[0].progress = null
    writeFileSync(statePath(), JSON.stringify(state))
    expect((await repo.read(binding)).recovery).toBe('previous')
  })
  test('preserves user edits to Markdown while continuing to generate vocabulary files', async () => {
    await seed()
    let result = await repo.saveWord({ binding, surface: 'climate', sentence: 'x', sourceRef: source })
    const exportPath = join(course, binding.rootRelPath, '단어장.md')
    writeFileSync(exportPath, '# 내 단어장\n직접 쓴 필기')
    result = await repo.updateWord({ binding, wordId: result.words[0]!.id, meaning: '기후' })
    expect(readFileSync(exportPath, 'utf8')).toBe('# 내 단어장\n직접 쓴 필기')
    expect(readFileSync(join(course, binding.rootRelPath, '단어장-2.md'), 'utf8')).toContain('기후')
    expect(result.words[0]!.meaning).toBe('기후')
  })
  test('persists quiz answers, auto-grades accepted spelling and records self-assessment separately', async () => {
    await seed(); await repo.putArtifact({ binding, artifact: quiz() })
    await repo.saveQuizAnswer({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1', questionId: 'q1', answer: 'a' })
    await repo.saveQuizAnswer({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1', questionId: 'q2', answer: ' CLIMATE ' })
    const restarted = createLearningRepo({ getCourseFolder: () => course })
    expect((await restarted.read(binding)).quizAttempts[0]!.answers).toHaveLength(2)
    await repo.saveQuizAnswer({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1', questionId: 'q3', answer: 'Long-term weather.' })
    await expect(repo.finishQuiz({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1' })).rejects.toThrow('자기 점검')
    await repo.saveQuizAnswer({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1', questionId: 'q3', answer: 'Long-term weather.', selfCheck: true })
    const result = await repo.finishQuiz({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1' })
    expect(result.quizAttempts[0]).toMatchObject({ score: 2, total: 2, selfCheckedCount: 1, selfPassedCount: 1 })
    expect(result.quizAttempts[0]!.answers[2]!.correct).toBe(null)
    expect(existsSync(join(course, binding.rootRelPath, result.quizAttempts[0]!.resultRelPath!))).toBe(true)
    const repeated = await repo.finishQuiz({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1' })
    expect(repeated.revision).toBe(result.revision)
  })
  test('keeps card scheduling when the same source-backed content is generated again and makes reviews idempotent', async () => {
    await seed(); await repo.putArtifact({ binding, artifact: cards('deck-1') })
    const cardId = (await repo.read(binding)).cards[0]!.id
    const reviewed = await repo.reviewCard({ binding, cardId, rating: 'good', reviewId: 'review-1' })
    expect(reviewed.cards[0]!.intervalDays).toBe(1)
    const regenerated = await repo.putArtifact({ binding, artifact: cards('deck-2') })
    expect(regenerated.cards).toHaveLength(1)
    expect(regenerated.cards[0]!.repetitions).toBe(1)
    const repeated = await repo.reviewCard({ binding, cardId, rating: 'good', reviewId: 'review-1' })
    expect(repeated.cards[0]!.repetitions).toBe(1)
    expect(repeated.revision).toBe(regenerated.revision)
    clock = '2026-10-05T00:00:00.000Z'
    const second = await repo.reviewCard({ binding, cardId, rating: 'good', reviewId: 'review-2' })
    expect(second.cards[0]!.intervalDays).toBe(3)
  })
  test('quiz completion and card review retry after an interrupted publication with a new clock', async () => {
    await seed()
    const focusedQuiz = quiz()
    if (focusedQuiz.kind !== 'quiz') throw new Error('expected quiz')
    await repo.putArtifact({ binding, artifact: { ...focusedQuiz, questions: focusedQuiz.questions.slice(0, 1) } })
    await repo.saveQuizAnswer({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1', questionId: 'q1', answer: 'a' })
    failCommit = true
    await expect(repo.finishQuiz({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1' })).rejects.toThrow('injected')
    clock = '2026-10-05T00:00:00.000Z'
    expect((await repo.finishQuiz({ binding, artifactId: 'quiz-1', attemptId: 'attempt-1' })).quizAttempts[0]!.completedAt).toBe(clock)
    await repo.putArtifact({ binding, artifact: cards('deck-1') })
    const cardId = (await repo.read(binding)).cards[0]!.id
    failCommit = true
    await expect(repo.reviewCard({ binding, cardId, rating: 'good', reviewId: 'review-1' })).rejects.toThrow('injected')
    clock = '2026-10-06T00:00:00.000Z'
    expect((await repo.reviewCard({ binding, cardId, rating: 'good', reviewId: 'review-1' })).cards[0]!.repetitions).toBe(1)
  })
  test('repoints immutable course source citations and reports changed files without losing the quote', async () => {
    await create()
    writeFileSync(join(course, 'lecture.md'), '# Climate\nThe climate is changing quickly.')
    const { learningHash } = await import('../../../src/main/features/learning/model')
    const materialSource: LearningSourceRef = { kind: 'material', pathScope: 'course', relPath: 'lecture.md', quote: 'The climate is changing quickly.', contentHash: learningHash(readFileSync(join(course, 'lecture.md'))) }
    await repo.putArtifact({ binding, artifact: { kind: 'cards', id: 'material-deck', title: 'Lecture cards', cards: [{ id: 'card-1', front: 'Climate', back: 'Long-term weather', sourceRefs: [materialSource] }] } })
    renameSync(join(course, 'lecture.md'), join(course, 'moved.md'))
    await repo.repoint({ courseId: binding.courseId, fromRelPath: 'lecture.md', toRelPath: 'moved.md', isDirectory: false })
    const artifact = await repo.readArtifact(binding, 'material-deck')
    expect(artifact.kind).toBe('cards')
    if (artifact.kind !== 'cards') throw new Error('expected cards')
    expect(artifact.cards[0]!.sourceRefs[0]).toMatchObject({ relPath: 'moved.md', availability: 'available' })
    writeFileSync(join(course, 'moved.md'), 'another file')
    const changed = await repo.readArtifact(binding, 'material-deck')
    if (changed.kind !== 'cards') throw new Error('expected cards')
    expect(changed.cards[0]!.sourceRefs[0]).toMatchObject({ quote: materialSource.quote, availability: 'changed' })
  })
  test('draft explanation changes only its named occurrence meaning', async () => {
    await seed()
    let result = await repo.saveWord({ binding, surface: 'climate', sentence: 'x', sourceRef: source, meaning: '기후' })
    await repo.addArticle({ binding, article: article({ id: 'article-2', sourceUrl: 'https://example.com/other', paragraphs: splitLearningParagraphs('The climate of opinion has changed.') }) })
    result = await repo.saveWord({ binding, surface: 'climate', sentence: 'x', sourceRef: { kind: 'article', articleId: 'article-2', quote: 'climate' } })
    const updated = await repo.importDraft({ binding, draft: { version: 1, wordUpdates: [{
      wordId: result.words[0]!.id, occurrenceId: result.occurrences[1]!.id, meaning: '분위기'
    }] } })
    expect(updated.occurrences.map((entry) => entry.meaning)).toEqual(['기후', '분위기'])
    const corrected = await repo.updateOccurrence({ binding, occurrenceId: updated.occurrences[1]!.id, meaning: '여론의 분위기' })
    expect(corrected.occurrences.map(entry => entry.meaning)).toEqual(['기후', '여론의 분위기'])
    expect(corrected.words[0]!.meaning).toBe('분위기')
  })
  test('moves project roots and exported material refs without changing learning identity', async () => {
    await seed()
    const original = await repo.read(binding)
    renameSync(join(course, '영어'), join(course, '학습'))
    await repo.repoint({ courseId: binding.courseId, fromRelPath: '영어', toRelPath: '학습', isDirectory: true })
    const movedBinding = { ...binding, rootRelPath: '학습' }
    const moved = await repo.read(movedBinding)
    expect(moved.projectId).toBe(original.projectId)
    const path = moved.articles[0]!.exportRelPath!
    renameSync(join(course, '학습', path), join(course, '학습', '기사', '내 기사.md'))
    await repo.repoint({ courseId: binding.courseId, fromRelPath: `학습/${path}`, toRelPath: '학습/기사/내 기사.md', isDirectory: false })
    expect((await repo.read(movedBinding)).articles[0]!.exportRelPath).toBe('기사/내 기사.md')
    expect((await repo.readArticle(movedBinding, 'article-1')).title).toBe('A changing climate')
  })
  test('refuses symlink escape and refuses to recreate a disconnected course', async () => {
    const outside = join(directory, 'outside'); mkdirSync(outside)
    symlinkSync(outside, join(course, 'escape'), 'dir')
    await expect(repo.create({ binding: { ...binding, rootRelPath: 'escape' }, name: 'x', topic: 'x' })).rejects.toThrow('outside')
    await expect(repo.create({ binding: { ...binding, rootRelPath: '../escape' }, name: 'x', topic: 'x' })).rejects.toThrow('path-traversal')
    rmSync(course, { recursive: true })
    await expect(create()).rejects.toThrow('course folder')
    expect(existsSync(course)).toBe(false)
  })
})
