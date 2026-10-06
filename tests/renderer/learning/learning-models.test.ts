import { describe, expect, test } from 'vitest'
import type { LearningArticleSnapshot, LearningArtifact, LearningProjectSnapshot } from '../../../src/shared/types/learning'
import { readerVocabularyMatches, readerWordSelection } from '../../../src/renderer/src/features/learning/readerSelection'
import { learningDraftIsSaveable } from '../../../src/renderer/src/features/learning/LearningDraftPreview'
import { dueLearningCards, quizCanFinish } from '../../../src/renderer/src/features/learning/LearningReview'
import { isTabDescriptor } from '../../../src/shared/tabs'
import { descriptorFor, tabPanelId } from '../../../src/renderer/src/features/workspace/tabIdentity'
import { filterLearningArticles, learningProgressMetrics } from '../../../src/renderer/src/features/learning/learningMetrics'
import { findMovedLearningBinding } from '../../../src/renderer/src/features/learning/learningRelocation'

const text = 'Resilient teams build resilient cities. A new approach works.'
const article: LearningArticleSnapshot = { id: 'article-1', title: 'Cities', sourceUrl: 'https://example.test/cities', canonicalUrl: 'https://example.test/cities', byline: null, publishedAt: null, siteName: null, language: 'en', wordCount: 10, estimatedMinutes: 1, paragraphs: [{ id: 'p1', text, sentences: [{ id: 's1', text: text.slice(0, 38), start: 0, end: 38 }, { id: 's2', text: text.slice(39), start: 39, end: text.length }] }], contentHash: 'hash', fetchedAt: '2026-10-04', access: 'public', createdAt: '2026-10-04' }

describe('native reader evidence', () => {
  test('retains the selected occurrence when the same word appears twice', () => {
    const start = text.indexOf('resilient')
    const selected = readerWordSelection(article, 'p1', start, start + 9)
    expect(selected?.surface).toBe('resilient')
    expect(selected?.sourceRef).toMatchObject({ articleId: 'article-1', paragraphId: 'p1', sentenceId: 's1', quote: 'resilient', start, end: start + 9 })
    expect(selected?.sentence).toBe(text.slice(0, 38))
  })
  test('does not turn selections across sentences or outside the snapshot into word evidence', () => {
    expect(readerWordSelection(article, 'p1', 30, 45)).toBeNull()
    expect(readerWordSelection(article, 'p1', -1, 3)).toBeNull()
    expect(readerWordSelection(article, 'missing', 0, 3)).toBeNull()
  })
  test('highlights recurring whole words and phrases without inventing inflected or partial matches', () => {
    const words = [{ id: 'word', surface: 'climate', lemma: 'climate' }, { id: 'phrase', surface: 'take off', lemma: 'take off' }] as LearningProjectSnapshot['words']
    const text = 'Climate matters. Acclimate first. Take off now; take offense later.'
    const matches = readerVocabularyMatches(text, words)
    expect(matches.map(match => text.slice(match.start, match.end))).toEqual(['Climate', 'Take off'])
    expect(matches.map(match => match.wordId)).toEqual(['word', 'phrase'])
  })
})

describe('portable native learning tabs', () => {
  test('copied folders open independently and root learning differs from the overview', () => {
    const a = descriptorFor('learning', { courseId: 'course', rootRelPath: '영어 A', view: 'reader', itemId: 'article' })
    const b = descriptorFor('learning', { courseId: 'course', rootRelPath: '영어 B' })
    expect(isTabDescriptor(a)).toBe(true)
    expect(tabPanelId(a)).not.toBe(tabPanelId(b))
    expect(tabPanelId(descriptorFor('learning', { courseId: 'course', rootRelPath: '' }))).not.toBe(tabPanelId(descriptorFor('learning', { courseId: 'course' })))
    expect(tabPanelId(descriptorFor('learning', { courseId: 'course', rootRelPath: '@overview' }))).not.toBe(tabPanelId(descriptorFor('learning', { courseId: 'course' })))
    expect(isTabDescriptor({ kind: 'learning', payload: { courseId: 'course', view: 'unknown' } })).toBe(false)
  })
  test('follows a moved project only after its original folder disappears and does not follow copies', () => {
    const original = { courseId: 'course', rootRelPath: 'Reading/Science' }
    const moved = { ...original, rootRelPath: 'Library/Science' }
    const summary = (binding: typeof original, projectId = 'project') => ({ binding, projectId, warning: null }) as Parameters<typeof findMovedLearningBinding>[2][number]
    expect(findMovedLearningBinding(original, 'project', [summary(original), summary(moved)])).toBeNull()
    expect(findMovedLearningBinding(original, 'project', [{ ...summary(original), warning: 'damaged' }, summary(moved)])).toBeNull()
    expect(findMovedLearningBinding(original, 'project', [summary(moved)])).toEqual(moved)
    expect(findMovedLearningBinding(original, 'project', [summary(moved, 'another')])).toBeNull()
    expect(findMovedLearningBinding(original, 'project', [summary(moved), summary({ ...moved, rootRelPath: 'Copy' })])).toBeNull()
  })
})

describe('review and conversion safeguards', () => {
  test('unfinished short answers require self-check and future cards remain out of today’s queue', () => {
    const quiz = { kind: 'quiz', questions: [{ id: 'q', type: 'short-answer', prompt: 'Explain', answer: 'Model', explanation: '', sourceRefs: [] }] } as Extract<LearningArtifact, { kind: 'quiz' }>
    const answer = { questionId: 'q', answer: 'My answer', correct: null, answeredAt: 'now' }
    const attempt = { answers: [answer] } as Parameters<typeof quizCanFinish>[1]
    expect(quizCanFinish(quiz, attempt)).toBe(false)
    const checked = { ...attempt!, answers: [{ ...answer, selfCheck: false }] }
    expect(quizCanFinish(quiz, checked)).toBe(true)
    expect(quizCanFinish(quiz, checked, { q: 'Changed answer' })).toBe(false)
    const project = { cards: [{ id: 'new', status: 'new', dueAt: '2026-10-05' }, { id: 'due', status: 'review', dueAt: '2026-10-03' }, { id: 'future', status: 'review', dueAt: '2026-10-05' }] } as LearningProjectSnapshot
    expect(dueLearningCards(project, Date.parse('2026-10-04')).map(card => card.id)).toEqual(['due', 'new'])
  })
  test('cleared local answers immediately block grading before their save completes', () => {
    const quiz = { kind: 'quiz', questions: [{ id: 'q', type: 'cloze' }] } as Extract<LearningArtifact, { kind: 'quiz' }>
    const attempt = { answers: [{ questionId: 'q', answer: 'previous answer' }] } as Parameters<typeof quizCanFinish>[1]
    expect(quizCanFinish(quiz, attempt)).toBe(true)
    expect(quizCanFinish(quiz, attempt, { q: '' })).toBe(false)
    expect(quizCanFinish(quiz, attempt, { q: '   ' })).toBe(false)
    expect(quizCanFinish(quiz, attempt, { q: 'new answer' })).toBe(true)
  })
  test('conversion preview rejects unknown correct options and empty cards', () => {
    expect(learningDraftIsSaveable({ version: 1, artifacts: [{ kind: 'quiz', title: 'Quiz', questions: [{ id: 'q', type: 'choice', prompt: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answer: 'unknown', explanation: '', sourceRefs: [] }] }] })).toBe(false)
    expect(learningDraftIsSaveable({ version: 1, artifacts: [{ kind: 'cards', title: 'Cards', cards: [{ id: 'c', front: 'Front', back: '', sourceRefs: [] }] }] })).toBe(false)
    expect(learningDraftIsSaveable({ version: 1, artifacts: [{ kind: 'quiz', title: 'Quiz', questions: [{ id: 'q', type: 'short-answer', prompt: 'Q', answer: '', modelAnswer: 'Model', explanation: '', sourceRefs: [] }] }] })).toBe(true)
    expect(learningDraftIsSaveable({ version: 1, words: [{ surface: 'adapt', sentence: 'Communities adapt.', sourceRef: { kind: 'material', relPath: 'words.md', quote: 'Communities adapt.' } }] })).toBe(true)
    expect(learningDraftIsSaveable({ version: 1, words: [{ surface: 'invented', sentence: 'Communities adapt.', sourceRef: { kind: 'material', relPath: 'words.md', quote: 'Communities adapt.' } }] })).toBe(false)
  })
})

test('learning records show distinct recurring words in completed articles and filter by saved date/status', () => {
  const articles = [{ id: 'read', status: 'completed', matchedWordIds: ['w1', 'w2'], createdAt: '2026-09-01', completedAt: '2026-10-02' }, { id: 'also-read', status: 'completed', matchedWordIds: ['w1'], createdAt: '2026-09-01', completedAt: '2026-09-02' }, { id: 'unread', status: 'unread', matchedWordIds: ['w3'], createdAt: '2026-10-03', completedAt: null }] as LearningProjectSnapshot['articles']
  const project = { articles, cards: [{ lastReviewedAt: null }, { lastReviewedAt: '2026-10-03' }], quizAttempts: [{ id: 'complete', completedAt: '2026-10-03' }, { id: 'draft', completedAt: null }] } as LearningProjectSnapshot
  expect(learningProgressMetrics(project)).toMatchObject({ encounteredWordCount: 2, reviewedCardCount: 1, latestQuiz: { id: 'complete' } })
  expect(filterLearningArticles(articles, 'completed', 'week', Date.parse('2026-10-04')).map(article => article.id)).toEqual(['read'])
})
