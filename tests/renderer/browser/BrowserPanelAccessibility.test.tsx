import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import {
  BrowserFavoriteButton,
  BrowserLoginPrompt
} from '../../../src/renderer/src/features/browser/BrowserPanel'

describe('BrowserPanel accessibility', () => {
  test.each([
    [false, '즐겨찾기에 추가'],
    [true, '즐겨찾기에서 제거']
  ] as const)('renders the favorite button label for starred=%s', (starred, label) => {
    const html = renderToStaticMarkup(
      <BrowserFavoriteButton starred={starred} onToggle={vi.fn()} />
    )

    expect(html).toContain(`aria-label="${label}"`)
    expect(html).toContain(`aria-pressed="${starred}"`)
  })
})

describe('saved login prompt', () => {
  test.each([
    ['save', '이 사이트 로그인을 저장할까요?'],
    ['update', '비밀번호를 업데이트할까요?']
  ] as const)('uses the %s wording and all three decisions', (kind, wording) => {
    const html = renderToStaticMarkup(
      <BrowserLoginPrompt
        kind={kind}
        onSave={vi.fn()}
        onDecline={vi.fn()}
        onSuppress={vi.fn()}
      />
    )

    expect(html).toContain(wording)
    expect(html).toContain('저장')
    expect(html).toContain('이번엔 안 함')
    expect(html).toContain('이 사이트는 묻지 않기')
  })
})
