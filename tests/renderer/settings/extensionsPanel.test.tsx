// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import type { PluginSummary } from '../../../src/shared/types/plugin'
import { ExtensionsPanel } from '../../../src/renderer/src/features/settings/ExtensionsPanel'
import { PluginPermissionDialog } from '../../../src/renderer/src/features/plugins/PluginPermissionDialog'
import { resetPluginsStoreForTests, usePluginsStore } from '../../../src/renderer/src/stores/pluginsStore'

const plugin: PluginSummary = {
  manifest: {
    manifestVersion: 1,
    id: 'notes.helper',
    name: 'Notes Helper',
    version: '2.0.0',
    minAppVersion: '0.35.0',
    description: '노트를 더 빠르게 정리합니다.',
    author: 'Bandal Lab',
    main: 'main.js',
    permissions: ['notes.read', 'notes.write'],
    contributes: { commands: [], panels: [] },
    styles: null
  },
  enabled: false,
  state: 'needs-approval',
  approvedPermissions: null,
  installedAt: '2026-09-01T00:00:00.000Z',
  lastError: '승인을 기다리는 중'
}

afterEach(() => resetPluginsStoreForTests())

describe('ExtensionsPanel', () => {
  test('renders metadata, state, activation, reload, delete, and logs controls', () => {
    usePluginsStore.setState({ plugins: [plugin], loading: false, error: null })
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<ExtensionsPanel />))
    const html = container.innerHTML

    expect(html).toContain('Notes Helper')
    expect(html).toContain('v2.0.0 · Bandal Lab')
    expect(html).toContain('승인 필요')
    expect(html).toContain('role="switch"')
    expect(html).toContain('다시 불러오기')
    expect(html).toContain('>로그</button>')
    expect(html).toContain('>삭제</button>')
    expect(html).toContain('승인을 기다리는 중')
    act(() => root.unmount())
  })

  test('lists every requested capability in the approval dialog', () => {
    const html = renderToStaticMarkup(
      <PluginPermissionDialog
        plugin={plugin}
        onApprove={() => undefined}
        onCancel={() => undefined}
      />
    )

    expect(html).toContain('notes.read')
    expect(html).toContain('노트 내용 읽기')
    expect(html).toContain('notes.write')
    expect(html).toContain('노트 만들기·수정하기')
    expect(html).toContain('승인하고 활성화')
  })
})
