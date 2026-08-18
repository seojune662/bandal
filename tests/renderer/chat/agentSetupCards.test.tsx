import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import {
  LoginCard,
  ProviderSelector,
  providerLabel
} from '../../../src/renderer/src/features/chat/AgentSetupCards'

describe('agent setup copy', () => {
  test('uses Korean provider labels', () => {
    expect(providerLabel('claude-code')).toBe('Claude Code')
    expect(providerLabel('codex')).toBe('Codex (GPT)')
  })

  test('offers both providers in the selector', () => {
    const html = renderToStaticMarkup(
      <ProviderSelector provider="claude-code" onChange={() => undefined} />
    )
    expect(html).toContain('Claude Code')
    expect(html).toContain('Codex (GPT)')
  })

  test('shows the staged Claude account and plan guide', () => {
    const html = renderToStaticMarkup(
      <LoginCard
        provider="claude-code"
        onProviderChange={() => undefined}
        onRefresh={() => undefined}
      />
    )
    expect(html).toContain('Claude Code 로그인이 필요해요')
    expect(html).toContain('로그인 창 열기')
    expect(html).toContain('자동으로 넘어가요')
  })

  test('shows the ChatGPT account and codex login guide', () => {
    const html = renderToStaticMarkup(
      <LoginCard
        provider="codex"
        onProviderChange={() => undefined}
        onRefresh={() => undefined}
      />
    )
    expect(html).toContain('Codex (GPT) 로그인이 필요해요')
    expect(html).toContain('로그인 창 열기')
    expect(html).toContain('자동으로 넘어가요')
  })
})
