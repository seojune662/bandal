import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { ProviderMark } from '../../../src/renderer/src/components/ProviderMark'

describe('ProviderMark', () => {
  test('renders the official Claude starburst in the brand clay color', () => {
    const html = renderToStaticMarkup(
      <ProviderMark provider="claude-code" size={32} />
    )

    expect(html).toContain('data-provider="claude-code"')
    expect(html).toContain('style="width:32px;height:32px"')
    expect(html).toContain('viewBox="0 0 24 24"')
    expect(html).toContain('fill="#D97757"')
    expect(html).toContain('m4.7144 15.9555')
    expect(html).not.toContain('>C<')
  })

  test('renders the OpenAI hexagonal knot with currentColor at compact size', () => {
    const html = renderToStaticMarkup(
      <ProviderMark provider="codex" size={20} />
    )

    expect(html).toContain('data-provider="codex"')
    expect(html).toContain('style="width:20px;height:20px"')
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('M22.282 9.821')
    expect(html).not.toContain('>X<')
  })

  test('renders the Gemini four-point star with currentColor', () => {
    const html = renderToStaticMarkup(
      <ProviderMark provider="gemini" size={32} />
    )

    expect(html).toContain('data-provider="gemini"')
    expect(html).toContain('provider-mark--gemini')
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('M12 2C12.8 7.6')
  })
})
