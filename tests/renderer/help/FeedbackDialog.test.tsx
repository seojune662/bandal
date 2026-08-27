import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import {
  FeedbackDialog,
  OPEN_FEEDBACK_EVENT,
  feedbackResultState
} from '../../../src/renderer/src/features/help/FeedbackDialog'

describe('FeedbackDialog', () => {
  test('renders the requested copy, controls, and checked app-info default', () => {
    const html = renderToStaticMarkup(<FeedbackDialog initiallyOpen />)

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('피드백 보내기')
    expect(html).not.toContain('aria-describedby')
    expect(html).toContain('무엇을 개선하면 좋을까요?')
    expect(html).toContain('앱 정보 함께 보내기(버전·OS·테마)')
    expect(html).toContain('type="checkbox" checked=""')
    expect(html).toContain('maxLength="4000"')
    expect(html).toContain('>취소</button>')
    expect(html).toContain('>보내기</button>')
  })

  test.each([
    ['bug', '버그'],
    ['friction', '불편해요'],
    ['feature', '기능 제안']
  ] as const)('renders the %s segment as the selected state', (kind, label) => {
    const html = renderToStaticMarkup(
      <FeedbackDialog initiallyOpen initialKind={kind} />
    )
    const selected = html.match(
      /<button[^>]*data-selected="true"[^>]*aria-checked="true"[^>]*>([^<]+)<\/button>/
    )

    expect(selected?.[1]).toBe(label)
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  })

  test('maps all three send results to their renderer states', () => {
    expect(feedbackResultState({ ok: true })).toBe('success')
    expect(
      feedbackResultState({ ok: false, reason: 'rate-limited' })
    ).toBe('rate-limited')
    expect(
      feedbackResultState({ ok: false, reason: 'unavailable' })
    ).toBe('unavailable')
  })

  test('uses the app-wide feedback opening event contract', () => {
    expect(OPEN_FEEDBACK_EVENT).toBe('bandal:open-feedback')
  })
})
