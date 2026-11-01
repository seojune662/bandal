// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
const ipc = vi.hoisted(() => ({ invoke: vi.fn(), onPush: vi.fn(() => () => {}) }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ipc)
import { ago, SyncPanel } from '../../../src/renderer/src/features/settings/sync/SyncPanel'

const unbound = { available: true, provider: null, state: { state: 'off' }, device: { id: null, name: 'MacBook Air' }, devices: [], pending: 0 }
const bound = {
  ...unbound, provider: 'icloud', state: { state: 'synced', at: Date.now() - 3 * 60_000 }, device: { id: 'aaaa', name: 'MacBook Air' }, pending: 2,
  devices: [
    { id: 'aaaa', name: 'MacBook Air', platform: 'macos', last_seen: Date.now(), self: true },
    { id: 'bbbb', name: 'iPad Pro', platform: 'ipados', last_seen: Date.now() - 10 * 60_000, self: false }
  ]
}
const plan = {
  kind: 'choose', local: { courses: 2, docs: 3 }, remote: { courses: 1, docs: 2 },
  pairs: [{ local: 'l1', remote: 'r1', name: '선형대수학' }, { local: 'l2', remote: 'r2', name: '물리학' }]
}

afterEach(() => vi.restoreAllMocks())

async function render(handlers: Record<string, (req: unknown) => unknown>) {
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation(async (channel: string, req: unknown) => {
    const handler = handlers[channel]
    if (!handler) throw new Error(`unexpected ${channel}`)
    return handler(req)
  })
  // Attached: a detached form never submits in jsdom.
  const element = document.body.appendChild(document.createElement('div')), root = createRoot(element)
  await act(async () => root.render(<SyncPanel />))
  return {
    element,
    unmount: async () => {
      await act(() => root.unmount())
      element.remove()
    }
  }
}
const button = (element: HTMLElement, text: string) => [...element.querySelectorAll('button')].find(item => item.textContent === text)
const click = (target: Element | undefined | null) => act(async () => (target as HTMLElement).click())

test('with data on both sides it offers the three ways and merges only the checked same-name courses', async () => {
  const { element, unmount } = await render({ 'sync:status': () => unbound, 'sync:prepare': () => ({ status: 'ready', plan }), 'sync:connect': () => bound })
  try {
    await click(button(element, 'iCloud에 연결'))
    for (const label of ['합치기', '이 기기 자료로 덮어쓰기', '클라우드 자료 가져오기']) expect(element.textContent).toContain(label)
    await click([...element.querySelectorAll('label')].find(label => label.textContent === '물리학')!.querySelector('input'))
    await click(button(element, '시작'))
    expect(ipc.invoke).toHaveBeenCalledWith('sync:connect', { mode: 'merge', pairs: [{ local: 'l1', remote: 'r1' }], expect: 'choose' })
    expect(element.textContent).toContain('동기화됨 · 3분 전')
  } finally {
    await unmount()
  }
})

test('an overwrite says what goes away and sends nothing when declined', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { element, unmount } = await render({ 'sync:status': () => unbound, 'sync:prepare': () => ({ status: 'ready', plan }), 'sync:connect': () => bound })
  try {
    await click(button(element, 'iCloud에 연결'))
    await click([...element.querySelectorAll('[role="radio"]')].find(item => item.textContent?.startsWith('이 기기 자료로 덮어쓰기')))
    await click(button(element, '시작'))
    expect(confirm.mock.calls[0]![0]).toContain('과목 1개와 문서 2개가 모든 기기에서 사라집니다')
    expect(ipc.invoke.mock.calls.map(([channel]) => channel)).not.toContain('sync:connect')
    confirm.mockReturnValue(true)
    await click(button(element, '시작'))
    expect(ipc.invoke).toHaveBeenCalledWith('sync:connect', { mode: 'overwrite', pairs: [], expect: 'choose' })
  } finally {
    await unmount()
  }
})

test('before the iPad makes the folder it says so and checks again on request', async () => {
  const { element, unmount } = await render({ 'sync:status': () => unbound, 'sync:prepare': () => ({ status: 'needs-ipad' }) })
  try {
    await click(button(element, 'iCloud에 연결'))
    expect(element.querySelector('[role="alert"]')!.textContent).toContain('iPad에서 먼저 iCloud 동기화를 켜 주세요')
    await click(button(element, '다시 확인'))
    expect(ipc.invoke.mock.calls.filter(([channel]) => channel === 'sync:prepare')).toHaveLength(2)
  } finally {
    await unmount()
  }
})

test('a bound profile shows its state and devices, and renames this device', async () => {
  const { element, unmount } = await render({ 'sync:status': () => bound, 'sync:rename': () => ({ ...bound, device: { id: 'aaaa', name: '서준의 맥' } }) })
  try {
    for (const text of ['동기화됨 · 3분 전', '보낼 변경 2건', 'MacBook Air (이 기기)', 'iPad Pro', '10분 전']) expect(element.textContent).toContain(text)
    const input = element.querySelector('input.settings-text-input') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, '서준의 맥')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(button(element, '저장'))
    expect(ipc.invoke).toHaveBeenCalledWith('sync:rename', { name: '서준의 맥' })
  } finally {
    await unmount()
  }
})

test('times read in minutes, hours and days', () => {
  const now = Date.UTC(2026, 10, 1)
  expect([ago(now - 30_000, now), ago(now - 5 * 60_000, now), ago(now - 3 * 3_600_000, now), ago(now - 2 * 86_400_000, now)]).toEqual(['방금', '5분 전', '3시간 전', '2일 전'])
})
