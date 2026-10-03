import { describe, expect, test } from 'vitest'
import type { LearningCard, LearningQuizQuestion } from '../../../src/shared/types/learning'
import { gradeLearningAnswer, scheduleLearningCard, splitLearningParagraphs } from '../../../src/main/features/learning/model'

describe('learning schedules and text anchors', () => {
  test('advances only explicit good recall through the chosen fixed intervals', () => {
    let card: LearningCard = { id: 'card', artifactId: 'deck', front: 'front', back: 'back', sourceRefs: [],
      status: 'new', dueAt: '2026-10-04T00:00:00.000Z', intervalDays: 0, repetitions: 0, lapses: 0, lastReviewedAt: null }
    const now = '2026-10-04T00:00:00.000Z'
    const days: number[] = []
    for (let index = 0; index < 6; index += 1) { card = scheduleLearningCard(card, 'good', now); days.push(card.intervalDays) }
    expect(days).toEqual([1, 3, 7, 14, 30, 30])
    const hard = scheduleLearningCard(card, 'hard', now)
    expect(hard.repetitions).toBe(card.repetitions); expect(hard.intervalDays).toBe(30)
    expect(hard.dueAt).toBe('2026-10-05T00:00:00.000Z')
    const again = scheduleLearningCard(hard, 'again', now)
    expect(again.repetitions).toBe(0); expect(again.lapses).toBe(1)
    expect(again.dueAt).toBe('2026-10-04T00:10:00.000Z')
  })
  test('cloze grading uses explicit accepted answers and preserves punctuation differences', () => {
    const question: LearningQuizQuestion = { id: 'q1', type: 'cloze', prompt: 'A ___', answer: 'climate', acceptedAnswers: ['climates'], explanation: '', sourceRefs: [] }
    expect(gradeLearningAnswer(question, ' CLIMATE ')).toBe(true)
    expect(gradeLearningAnswer(question, 'climates')).toBe(true)
    expect(gradeLearningAnswer(question, 'climate!')).toBe(false)
    expect(gradeLearningAnswer({ ...question, type: 'short-answer' }, 'anything')).toBe(null)
  })
  test('every split sentence is an exact slice of the saved paragraph', () => {
    const paragraphs = splitLearningParagraphs('One sentence.  Another sentence!\n\nA new paragraph 🧠 has UTF-16 positions.')
    expect(paragraphs).toHaveLength(2)
    for (const paragraph of paragraphs) for (const sentence of paragraph.sentences) expect(paragraph.text.slice(sentence.start, sentence.end)).toBe(sentence.text)
  })
})
