// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { adaptiveTabLayout, focusWorkspaceHeader, headerChromeInset, installAdaptiveTabs, layoutAdaptiveTabs, minimumHeaderWidth } from '../../../src/renderer/src/features/workspace/adaptiveTabs'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('tabs share available space and progress from titles to usable icons', () => {
  expect(adaptiveTabLayout(1000, 2, 0)).toEqual({ width: 208, density: 'regular', visible: [0, 1] })
  expect(adaptiveTabLayout(416, 4, 3)).toEqual({ width: 104, density: 'regular', visible: [0, 1, 2, 3] })
  expect(adaptiveTabLayout(224, 4, 3)).toEqual({ width: 56, density: 'compact', visible: [0, 1, 2, 3] })
  expect(adaptiveTabLayout(128, 4, 3)).toEqual({ width: 32, density: 'icon', visible: [0, 1, 2, 3] })
})

test('a crowded pane retains its selected tab without shrinking targets or changing order', () => {
  expect(adaptiveTabLayout(100, 12, 11)).toEqual({ width: 100 / 3, density: 'icon', visible: [0, 1, 11] })
  expect(adaptiveTabLayout(100, 12, 1).visible).toEqual([0, 1, 2])
  expect(adaptiveTabLayout(100, 12, -1).visible).toEqual([0, 1, 2])
})

test('empty and temporarily unmeasured groups have no invalid dimensions', () => {
  for (const available of [0, 1, 31.9, -10, Number.NaN, Infinity]) expect(adaptiveTabLayout(available, 2, 1)).toEqual({ width: 0, density: 'icon', visible: [] })
  expect(adaptiveTabLayout(200, 0, -1).visible).toEqual([])
})

function header(width: number): { root: HTMLElement; group: HTMLElement; strip: HTMLElement; tabs: HTMLElement[] } {
  const root = document.createElement('div')
  root.innerHTML = '<div class="dv-groupview"><div class="dv-tabs-and-actions-container"><div class="dv-pre-actions-container"></div><div class="dv-tabs-container dv-horizontal"></div><div class="dv-left-actions-container"></div><div class="dv-void-container"></div><div class="dv-right-actions-container"></div></div></div>'
  document.body.append(root)
  const group = root.firstElementChild as HTMLElement
  const container = group.firstElementChild as HTMLElement
  container.style.border = '0px'
  const strip = root.querySelector<HTMLElement>('.dv-tabs-container')!
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect)
  for (const [selector, reserved] of [['.dv-pre-actions-container', 40], ['.dv-left-actions-container', 32], ['.dv-right-actions-container', 48]] as const)
    vi.spyOn(root.querySelector(selector)!, 'getBoundingClientRect').mockReturnValue({ width: reserved } as DOMRect)
  const tabs = Array.from({ length: 8 }, () => { const tab = document.createElement('div'); tab.className = 'dv-tab'; strip.append(tab); return tab })
  tabs[7]!.classList.add('dv-active-tab')
  return { root, group, strip, tabs }
}

test('each pane subtracts its own controls, reveals selection, and leaves tab nodes alive', () => {
  const first = header(280), second = header(600)
  layoutAdaptiveTabs(document.body)
  expect(first.strip.style.width).toBe('160px')
  expect(first.tabs.filter(tab => !tab.hasAttribute('data-tab-overflow'))).toEqual([first.tabs[0], first.tabs[1], first.tabs[2], first.tabs[3], first.tabs[7]])
  expect(second.strip.dataset.tabDensity).toBe('compact')
  expect(second.tabs.every(tab => !tab.hasAttribute('data-tab-overflow'))).toBe(true)
  first.tabs[7]!.classList.remove('dv-active-tab')
  first.tabs[5]!.classList.add('dv-active-tab')
  layoutAdaptiveTabs(first.group)
  expect(first.tabs[5]!.hasAttribute('data-tab-overflow')).toBe(false)
  expect(first.tabs[7]!.getAttribute('aria-hidden')).toBe('true')
  expect(first.strip.children).toHaveLength(8)
  expect(first.strip.getAttribute('role')).toBe('tablist')
})

test('adaptive layout observation is scoped and disposed with the workspace', () => {
  const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe = observe; unobserve = unobserve; disconnect = disconnect })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const { root, strip } = header(280)
  const stop = installAdaptiveTabs(root)
  expect(strip.dataset.tabDensity).toBe('icon')
  expect(observe).toHaveBeenCalledWith(root)
  stop()
  expect(disconnect).toHaveBeenCalledOnce()
})

test('compact headers retain a full-size selected icon and menu at the 100px pane minimum', () => {
  const { root, strip, tabs } = header(100)
  const container = strip.parentElement!
  for (const selector of ['.dv-pre-actions-container', '.dv-left-actions-container'])
    vi.spyOn(root.querySelector(selector)!, 'getBoundingClientRect').mockReturnValue({ width: 0 } as DOMRect)
  vi.spyOn(root.querySelector('.dv-right-actions-container')!, 'getBoundingClientRect').mockReturnValue({ width: 36 } as DOMRect)
  layoutAdaptiveTabs(root)
  expect(container.hasAttribute('data-tab-header-compact')).toBe(true)
  expect(strip.style.getPropertyValue('--workspace-adaptive-tab-width')).toBe('32px')
  expect(tabs.filter(tab => !tab.hasAttribute('data-tab-overflow'))).toEqual([tabs[0], tabs[7]])
})

test('corner minimums include native controls while ordinary panes remain compact', () => {
  expect(minimumHeaderWidth(0, 1000)).toBe(100)
  expect(minimumHeaderWidth(148, 1000)).toBe(224)
  expect(minimumHeaderWidth(148, 180)).toBe(180)
  const { root, strip } = header(240)
  const actions = document.createElement('div')
  actions.className = 'workspace-group-actions'
  actions.style.marginRight = '148px'
  root.querySelector('.dv-right-actions-container')!.append(actions)
  expect(headerChromeInset(strip.parentElement!)).toBe(188)
  layoutAdaptiveTabs(root)
  expect(strip.parentElement!.hasAttribute('data-tab-header-compact')).toBe(true)
})

test('header replacement restores keyboard focus to a selected tab or an empty pane list', () => {
  const old = document.createElement('button'); document.body.append(old); old.focus(); old.remove()
  const group = document.createElement('div')
  group.innerHTML = '<div class="dv-tab dv-active-tab" tabindex="0"></div><button class="workspace-open-tabs-button">목록</button>'
  document.body.append(group)
  expect(focusWorkspaceHeader(group)).toBe(true)
  expect(document.activeElement).toBe(group.firstElementChild)
  group.firstElementChild!.setAttribute('data-tab-overflow', '')
  expect(focusWorkspaceHeader(group)).toBe(true)
  expect(document.activeElement).toBe(group.lastElementChild)
  group.setAttribute('hidden', '')
  expect(focusWorkspaceHeader(group)).toBe(false)
  group.remove()
  expect(focusWorkspaceHeader(group)).toBe(false)
})
