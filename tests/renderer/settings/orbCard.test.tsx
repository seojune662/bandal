// @vitest-environment jsdom

import React, { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
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
        '메인 창을 닫아도 오브와 메뉴 막대 아이콘이 남습니다.',
      'settings.assistant.screen.title': '화면 읽기',
      'settings.assistant.screen.description':
        '오브가 화면을 읽을 때만 씁니다. 자세한 권한은 시스템 권한에서.',
      'settings.assistant.permissions.open': '시스템 권한 보기',
      'settings.ai.gemini.name': 'Gemini',
      'settings.ai.account.systemDefault': '시스템 기본',
      'settings.ai.account.deviceLogin': '이 기기의 Gemini 로그인을 사용',
      'settings.ai.account.thisDevice': '이 기기',
      'settings.ai.account.signedIn': '로그인됨',
      'settings.ai.account.reauthenticate': '재인증'
    }
    return messages[key] ?? key
  }
}))

import { AiPanel } from '../../../src/renderer/src/features/settings/SettingsPanels'
import { AssistantPanel } from '../../../src/renderer/src/features/settings/assistant/AssistantPanel'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'

function renderAssistantPanel(settings: Settings): string {
  return renderToStaticMarkup(<AssistantPanel settings={settings} />)
}

function renderAiPanel(): string {
  return renderToStaticMarkup(
    <AiPanel
      provider={DEFAULT_SETTINGS.agentProvider}
      providerReady
      providerSaving={false}
      providerFeedback={null}
      providerFeedbackError={false}
      availability={{ 'claude-code': null, codex: null, gemini: null }}
      loading={{ 'claude-code': false, codex: false, gemini: false }}
      error={{ 'claude-code': null, codex: null, gemini: null }}
      onProviderSelect={vi.fn()}
      onRetry={vi.fn()}
    />
  )
}

let mountedRoot: Root | null = null

afterEach(() => {
  if (mountedRoot !== null) {
    act(() => mountedRoot?.unmount())
    mountedRoot = null
  }
  setIpcAdapter(null)
  useUiStore.setState({ isSettingsOpen: false, settingsCategory: null })
})

function keepAliveSwitch(html: string): string {
  return (
    html.match(/<button[^>]*aria-label="창을 닫아도 오브 유지"[^>]*>/)?.[0] ??
    ''
  )
}

describe('AI engine settings', () => {
  test('uses real provider marks in selectors and provider cards', () => {
    const html = renderAiPanel()

    expect(html).not.toContain('반달 오브')
    expect(html).toContain('style="width:20px;height:20px" data-provider="claude-code"')
    expect(html).toContain('style="width:20px;height:20px" data-provider="codex"')
    expect(html).toContain('style="width:20px;height:20px" data-provider="gemini"')
    expect(html).toContain('style="width:32px;height:32px" data-provider="claude-code"')
    expect(html).toContain('style="width:32px;height:32px" data-provider="codex"')
    expect(html).toContain('style="width:32px;height:32px" data-provider="gemini"')
  })

  test('shows the signed-in Gemini account and reauthentication action', () => {
    const html = renderToStaticMarkup(
      <AiPanel
        provider="gemini"
        providerReady
        providerSaving={false}
        providerFeedback={null}
        providerFeedbackError={false}
        availability={{
          'claude-code': null,
          codex: null,
          gemini: {
            installed: true,
            loggedIn: true,
            accountEmail: 'student@example.com'
          }
        }}
        loading={{ 'claude-code': false, codex: false, gemini: false }}
        error={{ 'claude-code': null, codex: null, gemini: null }}
        onProviderSelect={vi.fn()}
        onRetry={vi.fn()}
      />
    )

    expect(html).toContain('시스템 기본')
    expect(html).toContain('student@example.com')
    expect(html).toContain('이 기기')
    expect(html).toContain('로그인됨')
    expect(html).toContain('>재인증</button>')
  })
})

describe('assistant settings orb card', () => {
  test('disables keep-alive while the orb is inside the app', () => {
    const html = renderAssistantPanel({
      ...DEFAULT_SETTINGS,
      assistantMode: 'in-app',
      desktopOrb: { keepAliveOnClose: true }
    })

    expect(html).toContain('반달 오브')
    expect(html).toContain('앱 안에서')
    expect(html).toContain('데스크톱 위에')
    expect(html).toContain('다른 앱을 쓰는 중에도 화면 위에 떠 있습니다.')
    expect(html).toContain('화면 읽기')
    expect(html).toContain('시스템 권한 보기')
    expect(html).not.toContain('미니 플레이어')
    expect(keepAliveSwitch(html)).toContain('disabled=""')
  })

  test('enables keep-alive for the desktop orb', () => {
    const html = renderAssistantPanel({
      ...DEFAULT_SETTINGS,
      assistantMode: 'desktop',
      desktopOrb: { keepAliveOnClose: false }
    })

    expect(keepAliveSwitch(html)).not.toContain('disabled=""')
    expect(html).toContain('aria-checked="false"')
  })

  test('persists orb changes and opens the system permissions category', () => {
    const invoke = vi.fn(async () => DEFAULT_SETTINGS)
    setIpcAdapter({
      invoke,
      on: vi.fn(() => () => undefined)
    } as unknown as IpcAdapter)
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      assistantMode: 'desktop',
      desktopOrb: { keepAliveOnClose: false }
    }
    const container = document.createElement('div')
    mountedRoot = createRoot(container)
    act(() => mountedRoot?.render(<AssistantPanel settings={settings} />))

    act(() =>
      container
        .querySelector<HTMLDivElement>('[role="radiogroup"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
        )
    )
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="창을 닫아도 오브 유지"]'
        )
        ?.click()
    )
    act(() =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === '시스템 권한 보기')
        ?.click()
    )

    expect(invoke).toHaveBeenCalledWith('settings:set', {
      assistantMode: 'in-app'
    })
    expect(invoke).toHaveBeenCalledWith('settings:set', {
      desktopOrb: { keepAliveOnClose: true }
    })
    expect(useUiStore.getState().settingsCategory).toBe('permissions')
  })
})
