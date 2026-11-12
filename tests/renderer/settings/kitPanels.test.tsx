import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'
import { NotificationsPanel } from '../../../src/renderer/src/features/settings/notifications/NotificationsPanel'
import { AppearancePanel } from '../../../src/renderer/src/features/settings/AppearancePanel'
import { TooltipProvider } from '../../../src/renderer/src/components/ui/tooltip'
import { UsagePanel } from '../../../src/renderer/src/features/settings/usage/UsagePanel'

const noop = (): void => {}

describe('NotificationsPanel', () => {
  test('the master switch off disables every alert toggle and says why', () => {
    const html = renderToStaticMarkup(
      <NotificationsPanel
        settings={{ ...DEFAULT_SETTINGS, notifications: { ...DEFAULT_SETTINGS.notifications, enabled: false } }}
      />
    )
    const switches = [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)].map(match => match[0])
    // master + 4 alerts + sound + focus
    expect(switches).toHaveLength(7)
    expect(switches.filter(tag => /\sdisabled=""/.test(tag))).toHaveLength(4)
    expect(html.match(/알림 켜기를 먼저 켜세요\./g)?.length).toBeGreaterThanOrEqual(4)
    expect(html).toContain('aria-pressed')
  })
})

describe('AppearancePanel', () => {
  test('keeps the theme and density preview radiogroups', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AppearancePanel
          theme="system"
          fontScale={1}
          editorFont="sans"
          density="comfortable"
          saving={false}
          error={null}
          onSelect={noop}
          onSelectFontScale={noop}
          onSelectEditorFont={noop}
          onSelectDensity={noop}
        />
      </TooltipProvider>
    )
    expect(html).toContain('aria-label="테마 선택"')
    expect(html).toContain('aria-label="밀도 선택"')
    expect(html).toContain('120%')
    expect(html).toContain('창의 색은 아래 꾸미기에서 고를 수 있어요.')
    expect(html).toContain('aria-label="색 선택"')
    expect(html).toContain('은은하게')
  })
})

describe('UsagePanel', () => {
  test('renders the period select while loading', () => {
    const html = renderToStaticMarkup(<UsagePanel />)
    expect(html).toContain('사용 통계를 불러오는 중입니다…')
  })
})
