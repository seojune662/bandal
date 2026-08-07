import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { QuizPreview } from '../../../src/renderer/src/features/notes/QuizPreview'

describe('QuizPreview', () => {
  test('keeps answer markdown out of the default collapsed render', () => {
    const html = renderToStaticMarkup(
      <QuizPreview
        sections={{
          questionMarkdown: '# 문제\n\n질문',
          answerMarkdown: '## 정답과 해설\n\nSECRET_ANSWER',
          answerHeading: '정답과 해설'
        }}
      />
    )

    expect(html).toContain('정답과 해설 보기')
    expect(html).not.toContain('SECRET_ANSWER')
  })
})
