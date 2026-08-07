import { describe, expect, test } from 'vitest'
import { splitQuizMarkdown } from '../../../src/renderer/src/features/notes/quizMarkdown'

describe('quiz markdown detection', () => {
  test('splits the AI quiz answer section without changing the source', () => {
    const markdown = `# 자료 퀴즈

## 문제

1. 핵심 개념은 무엇인가?

## 정답과 해설

1. 정답: 예시
`
    const sections = splitQuizMarkdown(markdown)

    expect(sections).not.toBeNull()
    expect(sections?.questionMarkdown).not.toContain('1. 정답: 예시')
    expect(sections?.answerMarkdown).toMatch(/^## 정답과 해설/)
    expect(`${sections?.questionMarkdown}${sections?.answerMarkdown}`).toBe(markdown)
  })

  test.each(['# 정답', '### 정답 및 해설', '###### 정답·해설'])(
    'accepts supported answer heading variant %s',
    (heading) => {
      expect(splitQuizMarkdown(`# 퀴즈\n\n${heading}\n\n42\n`)?.answerHeading).toContain(
        '정답'
      )
    }
  )

  test('does not treat an explanation-only section as a quiz answer', () => {
    expect(splitQuizMarkdown('# 필기\n\n## 해설\n\n개념 설명\n')).toBeNull()
  })

  test('ignores answer-like headings inside fenced code blocks', () => {
    expect(
      splitQuizMarkdown('# 필기\n\n```md\n## 정답과 해설\n```\n')
    ).toBeNull()
  })

  test('does not detect inline answer text', () => {
    expect(splitQuizMarkdown('# 필기\n\n정답과 해설은 나중에 확인한다.\n')).toBeNull()
  })
})
