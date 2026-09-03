// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { IDockviewPanelProps } from 'dockview'
import { afterEach, describe, expect, test } from 'vitest'
import type { PluginSummary } from '../../../src/shared/types/plugin'
import { PluginPanelTab } from '../../../src/renderer/src/features/plugins/PluginPanelTab'
import { resetPluginsStoreForTests, usePluginsStore } from '../../../src/renderer/src/stores/pluginsStore'
import { descriptorFor } from '../../../src/renderer/src/features/workspace/tabIdentity'

const plugin: PluginSummary = {
  manifest: {
    manifestVersion: 1,
    id: 'study.tools',
    name: 'Study Tools',
    version: '1.2.0',
    minAppVersion: '0.35.0',
    description: 'Study helpers',
    author: 'Bandal Lab',
    main: 'main.js',
    permissions: ['panel'],
    contributes: {
      commands: [],
      panels: [{ id: 'dashboard', title: 'Dashboard', entry: 'index.html' }]
    },
    styles: null
  },
  enabled: true,
  state: 'active',
  approvedPermissions: ['panel'],
  installedAt: '2026-09-01T00:00:00.000Z',
  lastError: null
}

afterEach(() => resetPluginsStoreForTests())

describe('PluginPanelTab', () => {
  test('renders only the renderer-safe webview attributes', () => {
    usePluginsStore.setState({ plugins: [plugin] })
    const props = {
      params: {
        descriptor: descriptorFor('plugin-panel', {
          pluginId: 'study.tools',
          panelId: 'dashboard'
        })
      }
    } as unknown as IDockviewPanelProps

    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<PluginPanelTab {...props} />))
    const html = container.innerHTML
    const openingTag = html.match(/<webview[^>]*>/)?.[0] ?? ''

    expect(openingTag).toContain('src="bandal-plugin://study.tools/ui/index.html"')
    expect(openingTag).toContain('partition="plugin:study.tools"')
    expect(openingTag).not.toMatch(/\bpreload=/i)
    expect(openingTag).not.toMatch(/\ballowpopups(?:=|\s|>)/i)
    expect(openingTag).not.toMatch(/\bnodeintegration=/i)
    expect(openingTag).not.toMatch(/\bwebpreferences=/i)
    act(() => root.unmount())
  })
})
