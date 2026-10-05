// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/types/settings'
const fixture = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: fixture.invoke, onPush: () => () => {} }))
vi.mock('../../../src/renderer/src/i18n', () => ({ useT: () => (key: string) => key, useLocale: () => 'ko-KR', LOCALES: [], setLocale: vi.fn() }))
import { GeneralPanel } from '../../../src/renderer/src/features/settings/SettingsPanels'
let root: ReturnType<typeof createRoot> | null = null
let container: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root?.unmount()); container?.remove(); root = null; container = null; vi.resetAllMocks() })
test('the replay button reads the current recovery marker instead of replacing it from stale settings', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const current = { ...DEFAULT_SETTINGS, tutorial: { seenVersion: 1, activeCourseId: 'interrupted-sample' } }
  fixture.invoke.mockImplementation(async (channel: string) => channel === 'settings:get' ? current : current)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  act(() => root?.render(<GeneralPanel settings={DEFAULT_SETTINGS} />))
  const replay = [...container.querySelectorAll('button')].find(button => button.textContent === 'settings.general.tutorial.reopen')!
  await act(async () => { replay.click(); await Promise.resolve(); await Promise.resolve() })
  expect(fixture.invoke.mock.calls).toEqual([
    ['settings:get', {}],
    ['settings:set', { tutorial: { seenVersion: 0, activeCourseId: 'interrupted-sample' } }]
  ])
})
