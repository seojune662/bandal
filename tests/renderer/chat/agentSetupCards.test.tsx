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
    expect(html).toContain('Claude 계정이 없다면 먼저 가입해요.')
    expect(html).toContain('무료 사용량과 유료 요금제')
    expect(html).toContain('터미널에서')
    expect(html).toContain('claude')
  })

  test('shows the ChatGPT account and codex login guide', () => {
    const html = renderToStaticMarkup(
      <LoginCard
        provider="codex"
        onProviderChange={() => undefined}
        onRefresh={() => undefined}
      />
    )
    expect(html).toContain('ChatGPT 계정이 없다면 먼저 가입해요.')
    expect(html).toContain('ChatGPT 로그인을 선택해요.')
    expect(html).toContain('codex')
  })
})
