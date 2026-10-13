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
    expect(providerLabel('claude-code')).toBe('Claude')
    expect(providerLabel('codex')).toBe('ChatGPT')
    expect(providerLabel('gemini')).toBe('Gemini')
  })

  test('offers all registered providers in the selector', () => {
    const html = renderToStaticMarkup(
      <ProviderSelector provider="claude-code" onChange={() => undefined} />
    )
    expect(html).toContain('Claude')
    expect(html).toContain('ChatGPT')
    expect(html).toContain('Gemini')
  })

  test('shows the staged Claude account and plan guide', () => {
    const html = renderToStaticMarkup(
      <LoginCard
        provider="claude-code"
        onProviderChange={() => undefined}
        onRefresh={() => undefined}
      />
    )
    expect(html).toContain('반달에서 Claude 사용하기')
    expect(html).toContain('Claude Pro·Max')
    expect(html).toContain('계정 로그인')
    expect(html).toContain('연결하기')
    expect(html).toContain('명령어를 입력할 필요가 없어요')
  })

  test('shows the ChatGPT account and codex login guide', () => {
    const html = renderToStaticMarkup(
      <LoginCard
        provider="codex"
        onProviderChange={() => undefined}
        onRefresh={() => undefined}
      />
    )
    expect(html).toContain('반달에서 ChatGPT 사용하기')
    expect(html).toContain('이용 가능 여부와 한도는 계정 요금제에 따라')
    expect(html).toContain('연결하기')
    expect(html).toContain('명령어를 입력할 필요가 없어요')
  })
})
