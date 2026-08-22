import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { BrowserFavoriteButton } from '../../../src/renderer/src/features/browser/BrowserPanel'

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
