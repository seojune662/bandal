import { describe, expect, test } from 'vitest'
import { buildAnnotationPrompt } from '../../../src/renderer/src/features/pdf/askAi'
import type { Annotation } from '../../../src/shared/types/annotation'

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    courseId: 'c1',
    relPath: 'Chap1.pdf',
    page: 12,
    color: 'yellow',
    rects: [],
    anchor: { quote: '미분의 연쇄 법칙', prefix: '', suffix: '' },
    comment: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('buildAnnotationPrompt', () => {
  test('quotes the highlight with its page and asks for an explanation', () => {
    // Act
    const prompt = buildAnnotationPrompt(annotation())

    // Assert
    expect(prompt).toBe(
      'p.12에서 하이라이트한 부분이야: "미분의 연쇄 법칙"\n이 부분 설명해줘'
    )
  })

  test('includes the memo line only when a comment exists', () => {
    // Act
    const withComment = buildAnnotationPrompt(
      annotation({ comment: '시험 범위인가?' })
    )
    const blankComment = buildAnnotationPrompt(annotation({ comment: '   ' }))

    // Assert
    expect(withComment).toContain('내 메모: 시험 범위인가?')
    expect(blankComment).not.toContain('내 메모')
  })

  test('truncates very long quotes', () => {
    // Arrange
    const longQuote = 'ㅁ'.repeat(1000)

    // Act
    const prompt = buildAnnotationPrompt(
      annotation({ anchor: { quote: longQuote, prefix: '', suffix: '' } })
    )

    // Assert
    expect(prompt).toContain('…')
    expect(prompt.length).toBeLessThan(700)
  })
})
