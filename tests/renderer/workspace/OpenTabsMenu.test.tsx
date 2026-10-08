// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { IDockviewHeaderActionsProps, IDockviewPanel } from 'dockview'
import { OpenTabsAction } from '../../../src/renderer/src/features/workspace/OpenTabsMenu'
import { CourseActivity } from '../../../src/renderer/src/features/workspace/courseActivity'

const mocks = vi.hoisted(() => ({ close: vi.fn() }))
vi.mock('../../../src/renderer/src/stores/workspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ closeTab: mocks.close }) } }))
vi.mock('../../../src/renderer/src/i18n', () => ({ useLocale: () => 'ko-KR' }))
vi.mock('../../../src/renderer/src/features/workspace/workspaceIcons', () => ({ WorkspaceTabIcon: () => <svg data-icon /> }))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  mocks.close.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture(menuActions?: (close: () => void) => React.ReactNode) {
  const target = document.createElement('div'); document.body.append(target)
  const root = createRoot(target)
  const panels = ['첫 필기', '두 번째 PDF', '길고 자세한 세 번째 탭'].map((title, index) => ({
    id: `panel-${index}`, title, params: { descriptor: { kind: 'board', payload: {} } },
    api: { setActive: vi.fn(), onDidTitleChange: () => ({ dispose() {} }) }
  })) as unknown as IDockviewPanel[]
  const props = { group: { panels, activePanel: panels[1], element: target }, containerApi: { onDidLayoutChange: () => ({ dispose() {} }) } } as unknown as IDockviewHeaderActionsProps
  const render = (active = true) => root.render(<CourseActivity.Provider value={active}><OpenTabsAction {...props} {...(menuActions ? { menuActions } : {})} /></CourseActivity.Provider>)
  return { target, root, panels, props, render }
}

function button(text: string): HTMLButtonElement { return [...document.querySelectorAll('button')].find(node => node.textContent === text)! }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('the full list searches complete titles and keyboard selection targets its group', async () => {
  const { root, target, panels, render } = fixture()
  await act(async () => render())
  const trigger = target.querySelector('button')!
  await act(async () => trigger.click())
  expect(document.querySelectorAll('.workspace-open-tabs-menu__row')).toHaveLength(3)
  const input = document.querySelector<HTMLInputElement>('input')!
  expect(document.activeElement).toBe(input)
  await type(input, '세 번째')
  expect(document.querySelectorAll('.workspace-open-tabs-menu__row')).toHaveLength(1)
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement).toBe(button('길고 자세한 세 번째 탭'))
  await act(async () => button('길고 자세한 세 번째 탭').click())
  expect(panels[2]!.api.setActive).toHaveBeenCalledOnce()
  expect(panels[0]!.api.setActive).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => root.unmount())
})

test('closing uses the exact panel and Escape returns focus to the list button', async () => {
  const { root, target, render } = fixture()
  await act(async () => render())
  const trigger = target.querySelector('button')!
  await act(async () => trigger.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="첫 필기 탭 닫기"]')!.click())
  expect(mocks.close).toHaveBeenCalledWith('panel-0')
  const menu = document.querySelector('[role="dialog"]')!
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await act(async () => root.unmount())
})

test('a retained course cannot leave its tab menu on the next course', async () => {
  const { root, target, render } = fixture()
  await act(async () => render())
  await act(async () => target.querySelector<HTMLButtonElement>('button')!.click())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => render(false))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => root.unmount())
})

test('compact pane actions dismiss the list before opening the next surface', async () => {
  const run = vi.fn()
  const { root, target, render } = fixture(close => <button onClick={() => { close(); run() }}>새 탭 열기</button>)
  await act(async () => render())
  await act(async () => target.querySelector<HTMLButtonElement>('button')!.click())
  await act(async () => button('새 탭 열기').click())
  expect(run).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => root.unmount())
})
