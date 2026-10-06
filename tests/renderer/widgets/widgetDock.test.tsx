// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../../src/shared/types/settings'
import { WidgetDock } from '../../../src/renderer/src/features/widgets/WidgetDock'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), load: vi.fn(), toast: vi.fn(), pushes: new Map<string, Set<(value: any) => void>>() }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: mocks.invoke,
  onPush: (channel: string, handler: (value: any) => void) => {
    const handlers = mocks.pushes.get(channel) ?? new Set()
    handlers.add(handler); mocks.pushes.set(channel, handlers)
    return () => handlers.delete(handler)
  }
}))
vi.mock('../../../src/renderer/src/stores/settingsSnapshot', () => ({ ensureSettingsLoaded: mocks.load }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: mocks.toast }))
vi.mock('../../../src/renderer/src/app/icons', () => ({ Icon: () => null }))
vi.mock('../../../src/renderer/src/features/widgets/MailWidget', () => ({ NativeMailWidget: () => null }))
vi.mock('../../../src/renderer/src/stores/coursesStore', () => ({ useCoursesStore: (select: (state: any) => unknown) => select({ courses: [{ id: 'course', name: '수학', workspaceKind: 'course' }], selectedCourseId: 'course' }) }))
vi.mock('../../../src/renderer/src/stores/uiStore', () => ({ useUiStore: (select: (state: any) => unknown) => select({ rightRailOpen: true, isSettingsOpen: false, toggleBoardOverlay: () => {} }) }))
vi.mock('../../../src/renderer/src/stores/universityStore', () => ({ useUniversityStore: (select: (state: any) => unknown) => select({ services: [], init: () => {} }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, host: HTMLDivElement, settings: Settings, unmounted: boolean
const push = (channel: string, value: unknown): void => { mocks.pushes.get(channel)?.forEach(handler => handler(value)) }
beforeEach(() => {
  vi.clearAllMocks(); mocks.pushes.clear(); unmounted = false
  settings = { ...DEFAULT_SETTINGS, widgets: { ...DEFAULT_SETTINGS.widgets, enabled: ['todo'], heightRatio: 0.38 } }
  mocks.load.mockResolvedValue(settings)
  mocks.invoke.mockImplementation(async (channel, input) => {
    if (channel === 'settings:set') {
      settings = { ...settings, widgets: { ...settings.widgets, ...input.widgets } }
      push('settings:changed', { settings })
      return settings
    }
    return channel === 'board:listTasks' ? [] : { id: 'new-task' }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 1000, height: 1000, width: 300, x: 0, y: 0, left: 0, right: 300, toJSON() {} })
})
afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount())
  host.remove(); vi.restoreAllMocks()
})
const mount = async (): Promise<void> => { await act(async () => root.render(<WidgetDock />)) }
const divider = (): HTMLDivElement => host.querySelector('.widget-divider')!
const dock = (): HTMLElement => host.querySelector('.widget-dock')!
const input = (label: string): HTMLInputElement => host.querySelector(`input[aria-label="${label}"]`)!
const change = async (label: string, value: string): Promise<void> => { await act(async () => Simulate.change(input(label), { target: { value } } as never)) }
const pointer = async (type: string, y: number, pointerId = 1): Promise<void> => {
  await act(async () => {
    const event = new Event(type, { bubbles: true })
    Object.assign(event, { pointerId, clientY: y })
    window.dispatchEvent(event)
  })
}
const startResize = async (): Promise<void> => {
  divider().setPointerCapture = vi.fn()
  divider().hasPointerCapture = vi.fn(() => true)
  divider().releasePointerCapture = vi.fn()
  await act(async () => Simulate.pointerDown(divider(), { button: 0, pointerId: 1, clientY: 620 } as never))
}

test('a failed initial settings request shows a retry instead of silently hiding enabled widgets', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.load.mockRejectedValueOnce(new Error('settings IPC failed')).mockResolvedValue(settings)
  await mount()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('위젯 설정을 불러오지 못했어요')
  expect(host.querySelector('.widget-card')).toBeNull()
  await act(async () => host.querySelector<HTMLButtonElement>('[role=alert] button')!.click())
  expect(mocks.load).toHaveBeenCalledTimes(2)
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(input('할 일 추가')).not.toBeNull()
})

test('a settings push recovers the dock before an older initial request rejects', async () => {
  let fail!: (reason: Error) => void
  mocks.load.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await mount()
  await act(async () => push('settings:changed', { settings }))
  await act(async () => fail(new Error('stale initial request')))
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(input('할 일 추가')).not.toBeNull()
})

test('adding once preserves the title, date and color typed while the first task is pending', async () => {
  let finish!: (value: unknown) => void
  const initial = mocks.invoke.getMockImplementation()!
  mocks.invoke.mockImplementation((channel, value) => channel === 'board:createTask' ? new Promise(resolve => { finish = resolve }) : initial(channel, value))
  await mount(); await change('할 일 추가', '먼저 저장')
  await act(async () => { Simulate.submit(host.querySelector('form')!); Simulate.submit(host.querySelector('form')!) })
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'board:createTask')).toHaveLength(1)
  await change('할 일 추가', '다음 할 일'); await change('할 일 날짜', '2026-10-08')
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="파랑"]')!.click())
  await act(async () => finish({ id: 'saved' }))
  expect(input('할 일 추가').value).toBe('다음 할 일')
  expect(input('할 일 날짜').value).toBe('2026-10-08')
  expect(host.querySelector('button[aria-label="파랑"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="추가"]')!.disabled).toBe(false)
})

test('a failed task load offers retry without claiming the list is empty', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.invoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
  await mount()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('불러오지 못했어요')
  expect(host.textContent).not.toContain('남은 할 일이 없어요')
  await act(async () => host.querySelector<HTMLButtonElement>('[role=alert] button')!.click())
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(host.textContent).toContain('남은 할 일이 없어요')
})

test('a stale task response cannot replace a newer board push refresh', async () => {
  let finish!: (value: unknown) => void
  mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue([])
  await mount(); await act(async () => push('board:changed', {}))
  await act(async () => finish([{ id: 'old', title: 'stale', courseId: null, dueAt: null, sortOrder: 0, status: 'todo', color: 'none' }]))
  expect(host.textContent).not.toContain('stale')
  expect(host.textContent).toContain('남은 할 일이 없어요')
})

test('pointer cancellation restores the confirmed height and removes global listeners', async () => {
  await mount(); await startResize(); await pointer('pointermove', 500)
  expect(dock().style.maxHeight).toBe('50%')
  await pointer('pointercancel', 500)
  expect(dock().style.maxHeight).toBe('38%')
  await pointer('pointermove', 350); await pointer('pointerup', 350)
  expect(dock().style.maxHeight).toBe('38%')
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'settings:set')).toHaveLength(0)
})

test('unmounting during a drag removes its listeners without writing settings', async () => {
  await mount(); await startResize()
  const remove = vi.spyOn(window, 'removeEventListener')
  await act(async () => root.unmount()); unmounted = true
  expect(remove.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel']))
  await pointer('pointermove', 300); await pointer('pointerup', 300)
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'settings:set')).toHaveLength(0)
})

test('keyboard resizing exposes its range and saves bounded Arrow, Home and End values', async () => {
  await mount()
  expect(divider().tabIndex).toBe(0)
  expect(divider().getAttribute('aria-label')).toBe('위젯 높이 조절')
  expect(divider().getAttribute('aria-valuenow')).toBe('38')
  for (const [key, ratio] of [['ArrowUp', 0.4], ['ArrowDown', 0.38], ['Home', 0.25], ['End', 0.65]] as const) {
    await act(async () => Simulate.keyDown(divider(), { key } as never))
    expect(mocks.invoke).toHaveBeenLastCalledWith('settings:set', { widgets: { heightRatio: ratio } })
    expect(divider().getAttribute('aria-valuenow')).toBe(String(Math.round(ratio * 100)))
  }
})

test('a failed height save restores the confirmed ratio and can be retried', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await mount()
  mocks.invoke.mockRejectedValueOnce(new Error('disk full'))
  await startResize(); await pointer('pointerup', 500)
  expect(dock().style.maxHeight).toBe('38%')
  expect(mocks.toast).toHaveBeenCalledWith('위젯 크기를 저장하지 못했어요. 다시 조절해 주세요.', 'danger')
  await act(async () => Simulate.keyDown(divider(), { key: 'End' } as never))
  expect(dock().style.maxHeight).toBe('65%')
})

test('an older failed save cannot undo a newer keyboard height', async () => {
  await mount()
  let fail!: (reason: Error) => void
  mocks.invoke.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await act(async () => Simulate.keyDown(divider(), { key: 'ArrowUp' } as never))
  await act(async () => Simulate.keyDown(divider(), { key: 'End' } as never))
  await act(async () => fail(new Error('old request failed')))
  expect(dock().style.maxHeight).toBe('65%')
  expect(mocks.toast).not.toHaveBeenCalled()
})

test('another pointer cannot finish the drag and hiding the dock cancels it', async () => {
  await mount(); await startResize()
  await pointer('pointermove', 500, 2); await pointer('pointerup', 500, 2)
  expect(dock().style.maxHeight).toBe('38%')
  await pointer('pointermove', 500)
  expect(dock().style.maxHeight).toBe('50%')
  await act(async () => push('settings:changed', { settings: { ...settings, widgets: { ...settings.widgets, enabled: [] } } }))
  expect(host.querySelector('.widget-dock')).toBeNull()
  await pointer('pointerup', 500)
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'settings:set')).toHaveLength(0)
})

test('a failed collapse keeps the card open and makes the control available again', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await mount()
  mocks.invoke.mockRejectedValueOnce(new Error('disk full'))
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="투두 위젯 접기"]')!
  await act(async () => toggle.click())
  expect(toggle.disabled).toBe(false)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(mocks.toast).toHaveBeenCalledWith('위젯 상태를 저장하지 못했어요. 다시 시도해 주세요.', 'danger')
  await act(async () => toggle.click())
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
})
