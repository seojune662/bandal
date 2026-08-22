import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { UpdateStatus } from '../../../src/shared/types/update'

const updateState = vi.hoisted(() => ({
  status: null as UpdateStatus | null,
  init: vi.fn(),
  check: vi.fn(async () => undefined),
  download: vi.fn(async () => undefined),
  install: vi.fn(async () => undefined)
}))

vi.mock('../../../src/renderer/src/stores/updateStore', () => ({
  useUpdateStore: <T,>(selector: (state: typeof updateState) => T): T =>
    selector(updateState)
}))

import { AboutPanel } from '../../../src/renderer/src/features/settings/SettingsPanels'

afterEach(() => {
  updateState.status = null
})

describe('AboutPanel version', () => {
  test('renders currentVersion from updater status instead of a constant', () => {
    updateState.status = { phase: 'unsupported', currentVersion: '9.8.7-test' }

    const html = renderToStaticMarkup(<AboutPanel />)

    expect(html).toContain('버전 9.8.7-test')
    expect(html).not.toContain('버전 0.1.0')
  })

  test('renders a dash before updater status arrives', () => {
    const html = renderToStaticMarkup(<AboutPanel />)

    expect(html).toContain('버전 —')
  })
})
