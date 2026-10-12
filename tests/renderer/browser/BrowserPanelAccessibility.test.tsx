import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import {
  BrowserFavoriteButton,
  BrowserLoginPrompt,
  BrowserPipChip
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
    ['save', '비밀번호 저장 확인'],
    ['update', '비밀번호 업데이트 확인']
  ] as const)('announces the %s candidate without opening a card', (kind, label) => {
    const html = renderToStaticMarkup(
      <BrowserLoginPrompt
        kind={kind}
        origin="https://accounts.google.com"
        username="student@example.edu"
        onSave={vi.fn()}
        onDecline={vi.fn()}
        onSuppress={vi.fn()}
      />
    )

    expect(html).toContain(`aria-label="${label}"`)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('role="status"')
    expect(html).toContain('accounts.google.com 로그인 정보를 저장할 수 있습니다.')
    expect(html).not.toContain('role="dialog"')
  })
})

describe('browser PiP chip', () => {
  test('appears only when the guest reports a video', () => {
    const visible = renderToStaticMarkup(
      <BrowserPipChip hasPlayingVideo onOpen={vi.fn()} />
    )
    const hidden = renderToStaticMarkup(
      <BrowserPipChip hasPlayingVideo={false} onOpen={vi.fn()} />
    )

    expect(visible).toContain('aria-label="작은 창으로 보기"')
    expect(visible).toContain('PiP')
    expect(hidden).toBe('')
  })
})
