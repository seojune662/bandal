import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  type Settings
} from '../../../src/shared/types/settings'

vi.mock('../../../src/renderer/src/i18n', () => ({
  LOCALES: ['ko-KR', 'en-US'],
  setLocale: vi.fn(),
  useLocale: () => 'ko-KR',
  useT: () => (key: string) => {
    const messages: Record<string, string> = {
      'settings.ai.orb.title': '반달 오브',
      'settings.ai.orb.description':
        '반달 AI를 부르는 오브를 어디에 둘지 정합니다.',
      'settings.ai.orb.mode.selectLabel': '반달 오브 위치 선택',
      'settings.ai.orb.mode.inApp': '앱 안에서',
      'settings.ai.orb.mode.desktop': '데스크톱 위에',
      'settings.ai.orb.mode.desktopDescription':
        '다른 앱을 쓰는 중에도 화면 위에 떠 있습니다.',
      'settings.ai.orb.keepAlive': '창을 닫아도 오브 유지',
      'settings.ai.orb.keepAliveDescription':
        '메인 창을 닫아도 오브와 메뉴 막대 아이콘이 남습니다.'
    }
    return messages[key] ?? key
  }
}))

import { AiPanel } from '../../../src/renderer/src/features/settings/SettingsPanels'

function renderPanel(settings: Settings): string {
  return renderToStaticMarkup(
    <AiPanel
      settings={settings}
      provider={settings.agentProvider}
      providerReady
      providerSaving={false}
      providerFeedback={null}
      providerFeedbackError={false}
      availability={{ 'claude-code': null, codex: null }}
      loading={{ 'claude-code': false, codex: false }}
      error={{ 'claude-code': null, codex: null }}
      onProviderSelect={vi.fn()}
      onRetry={vi.fn()}
    />
  )
}

function keepAliveSwitch(html: string): string {
  return (
    html.match(/<button[^>]*aria-label="창을 닫아도 오브 유지"[^>]*>/)?.[0] ??
    ''
  )
}

describe('AI settings orb card', () => {
  test('uses real provider marks in selectors and provider cards', () => {
    const html = renderPanel(DEFAULT_SETTINGS)

    expect(html).toContain('style="width:20px;height:20px" data-provider="claude-code"')
    expect(html).toContain('style="width:20px;height:20px" data-provider="codex"')
    expect(html).toContain('style="width:32px;height:32px" data-provider="claude-code"')
    expect(html).toContain('style="width:32px;height:32px" data-provider="codex"')
  })

  test('disables keep-alive while the orb is inside the app', () => {
    const html = renderPanel({
      ...DEFAULT_SETTINGS,
      assistantMode: 'in-app',
      desktopOrb: { keepAliveOnClose: true }
    })

    expect(html).toContain('반달 오브')
    expect(html).toContain('앱 안에서')
    expect(html).toContain('데스크톱 위에')
    expect(html).toContain('다른 앱을 쓰는 중에도 화면 위에 떠 있습니다.')
    expect(keepAliveSwitch(html)).toContain('disabled=""')
  })

  test('enables keep-alive for the desktop orb', () => {
    const html = renderPanel({
      ...DEFAULT_SETTINGS,
      assistantMode: 'desktop',
      desktopOrb: { keepAliveOnClose: false }
    })

    expect(keepAliveSwitch(html)).not.toContain('disabled=""')
    expect(html).toContain('aria-checked="false"')
  })
})
