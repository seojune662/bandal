// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FeatureLauncherPanel } from '../../../src/renderer/src/features/launcher/FeatureLauncherPanel'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'
import { setIpcAdapter, type IpcAdapter } from '../../../src/renderer/src/lib/ipc'

vi.mock('../../../src/renderer/src/features/launcher/featureInventory', () => ({
  useFeatureInventory: () => ({ entries: [], loading: false, error: null, reload: async () => {} }),
}))
vi.mock('../../../src/renderer/src/features/launcher/launcherContext', () => ({
  useLauncherContext: () => ({ context: {
    courseId: null, courseName: null, sourcePanelId: null, descriptor: null,
    material: null, binding: null, articleIds: [], wordIds: [], selection: '',
    browser: null, sourceUnavailable: false,
  }, loading: false, error: null }),
  refreshLauncherContext: vi.fn(),
}))
vi.mock('../../../src/renderer/src/features/learning/LearningProjects', () => ({
  useLearningProjects: () => ({ projects: [], loading: false, error: null, reload: async () => {} }),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | null = null
let parent: HTMLDivElement
beforeEach(() => {
  useUiStore.setState({ leftRailOpen: true, courseRailOpen: true, isSettingsOpen: false })
  setIpcAdapter({ invoke: vi.fn(), on: () => () => {} } as unknown as IpcAdapter)
  parent = document.createElement('div')
  document.body.append(parent)
  root = createRoot(parent)
  // jsdom does not implement inert; preserve the browser's focus restriction.
  const nativeFocus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options) {
    if (!this.closest('[inert]')) nativeFocus.call(this, options)
  })
})
afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  vi.restoreAllMocks()
  setIpcAdapter(null)
  document.body.replaceChildren()
  useUiStore.setState({ leftRailOpen: true, courseRailOpen: true, isSettingsOpen: false })
})
const search = (): HTMLInputElement => document.querySelector<HTMLInputElement>('[aria-label="기능 검색"]')!

test('opening from settings focuses search after the exit transition releases inert', async () => {
  useUiStore.setState({ isSettingsOpen: true })
  parent.setAttribute('inert', '')
  await act(async () => { root!.render(<FeatureLauncherPanel hidden={false} />) })
  await act(async () => { useUiStore.getState().closeSettings() })
  expect(document.activeElement).not.toBe(search())
  await act(async () => { parent.removeAttribute('inert') })
  expect(document.activeElement).toBe(search())
})

test('reopening the same plugin rail restores search focus without remounting it', async () => {
  await act(async () => { root!.render(<FeatureLauncherPanel hidden={false} />) })
  const input = search()
  expect(document.activeElement).toBe(input)
  const outside = document.createElement('button')
  document.body.append(outside)
  await act(async () => { useUiStore.setState({ courseRailOpen: false }); outside.focus() })
  expect(document.activeElement).toBe(outside)
  await act(async () => { useUiStore.setState({ courseRailOpen: true }) })
  expect(search()).toBe(input)
  expect(document.activeElement).toBe(input)
})

test('closing the rail cancels a pending focus while settings is fading out', async () => {
  parent.setAttribute('inert', '')
  await act(async () => { root!.render(<FeatureLauncherPanel hidden={false} />) })
  const outside = document.createElement('button')
  document.body.append(outside)
  await act(async () => { useUiStore.setState({ courseRailOpen: false }); outside.focus() })
  await act(async () => { parent.removeAttribute('inert') })
  expect(document.activeElement).toBe(outside)
})
