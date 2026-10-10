// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BrowserProfile } from '../../../src/shared/types/browserProfile'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: invokeMock }))
import { BrowserProfilePicker } from '../../../src/renderer/src/features/browser/BrowserProfilePicker'
import { BrowserProfileSelect } from '../../../src/renderer/src/features/browser/BrowserProfileSelect'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
let profiles: BrowserProfile[]
const personalId = 'a53d9836-6c30-488d-8e10-1127758d7d00'
const newId = 'bb3d9836-6c30-488d-8e10-1127758d7d00'

beforeEach(() => {
  profiles = [
    { id: 'default', name: '학교', color: '#4d7850', icon: '●' },
    { id: personalId, name: '개인', color: '#397db5', icon: '◆' }
  ]
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (channel, request) => {
    if (channel === 'browser:profiles') return profiles.map(profile => ({ ...profile }))
    if (channel === 'browser:saveProfile') {
      const saved = { ...request, id: request.id ?? newId }
      profiles = [...profiles.filter(profile => profile.id !== saved.id), saved]
      return saved
    }
    if (channel === 'browser:deleteProfile') profiles = profiles.filter(profile => profile.id !== request.id)
    return { ok: true }
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
async function mount(node: React.ReactNode): Promise<void> {
  await act(async () => root.render(node))
}
async function click(button: Element | null): Promise<void> {
  expect(button).not.toBeNull()
  await act(async () => (button as HTMLButtonElement).click())
}
function button(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}
function textButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes(text))
}
function choose(name: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.browser-profile-manager__choose')).find(item => item.textContent?.includes(name))
}
async function fillName(name: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('[aria-label="프로필 이름"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit(): Promise<void> {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
async function open(): Promise<void> { await click(button('브라우저 프로필')) }

describe('browser profile switching and management', () => {
  test('explains separate accounts, traps keyboard focus, and restores the toolbar button on Escape', async () => {
    await mount(<BrowserProfilePicker profileId={personalId} onChange={vi.fn()} />)
    const trigger = button('브라우저 프로필')!
    trigger.focus()
    await open()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(host.contains(dialog)).toBe(false)
    expect(dialog.textContent).toContain('Bandal 로그인 계정과는 별개')
    expect(button('개인 삭제')?.disabled).toBe(true)
    expect(button('학교 삭제')).toBeNull()
    const add = textButton('새 프로필 만들기')!
    add.focus()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(button('닫기'))
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  test('keeps the dialog and current selection after a cancelled profile switch', async () => {
    const change = vi.fn().mockResolvedValue(false)
    await mount(<BrowserProfilePicker profileId="default" onChange={change} />)
    await open()
    await click(choose('개인')!)
    expect(change).toHaveBeenCalledWith(personalId)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(choose('학교')?.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[role="status"]')?.textContent).toContain('전환을 취소')
  })

  test('creates and uses a separate login profile in one action', async () => {
    const change = vi.fn().mockResolvedValue(true)
    await mount(<BrowserProfilePicker profileId="default" onChange={change} />)
    await open()
    await click(textButton('새 프로필 만들기')!)
    expect(document.activeElement).toBe(document.querySelector('[aria-label="프로필 이름"]'))
    await fillName('  ChatGPT 개인  ')
    await submit()
    expect(invokeMock).toHaveBeenCalledWith('browser:saveProfile', expect.objectContaining({ name: 'ChatGPT 개인' }))
    expect(change).toHaveBeenCalledWith(newId)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  test('a failed switch after creation retains the saved profile for retry without duplicating it', async () => {
    const change = vi.fn().mockRejectedValueOnce(new Error('페이지를 열지 못했습니다.')).mockResolvedValue(true)
    await mount(<BrowserProfilePicker profileId="default" onChange={change} />)
    await open()
    await click(textButton('새 프로필 만들기')!)
    await fillName('ChatGPT 개인')
    await submit()
    expect(document.querySelector('form')).toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('페이지를 열지 못했습니다.')
    expect(choose('ChatGPT 개인')).toBeDefined()
    await click(choose('ChatGPT 개인')!)
    expect(invokeMock.mock.calls.filter(call => call[0] === 'browser:saveProfile')).toHaveLength(1)
    expect(change.mock.calls).toEqual([[newId], [newId]])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  test('editing broadcasts renamed profiles to other tabs and settings selectors', async () => {
    await mount(<><BrowserProfilePicker profileId="default" onChange={vi.fn()} /><BrowserProfileSelect value="default" onChange={vi.fn()} /></>)
    await open()
    await click(button('학교 편집'))
    await fillName('대학교')
    await submit()
    expect(button('브라우저 프로필')?.textContent).toContain('대학교')
    expect(document.querySelector('select[aria-label="설정할 브라우저 프로필"]')?.textContent).toContain('대학교')
    expect(document.querySelector('[role="status"]')?.textContent).toBe('프로필을 저장했습니다.')
  })

  test('save and delete failures preserve profiles and expose a visible error', async () => {
    await mount(<BrowserProfilePicker profileId="default" onChange={vi.fn()} />)
    await open()
    await click(button('개인 편집'))
    await fillName('다른 개인')
    const transport = invokeMock.getMockImplementation()!
    invokeMock.mockImplementation(async (channel, request) => {
      if (channel === 'browser:saveProfile') throw new Error('이름을 저장하지 못했습니다.')
      if (channel === 'browser:deleteProfile') throw new Error('이 프로필의 탭을 먼저 닫아 주세요.')
      return transport(channel, request)
    })
    await submit()
    expect(document.querySelector<HTMLInputElement>('[aria-label="프로필 이름"]')?.value).toBe('다른 개인')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('이름을 저장하지 못했습니다.')
    await click(button('개인 삭제'))
    expect(choose('개인')).toBeDefined()
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('이 프로필의 탭을 먼저 닫아 주세요.')
  })

  test('profile loading errors can be retried without silently selecting another account', async () => {
    invokeMock.mockRejectedValue(new Error('offline'))
    await mount(<BrowserProfileSelect value={personalId} onChange={vi.fn()} />)
    expect(document.querySelector('select')?.value).toBe(personalId)
    expect(document.querySelector('select')?.disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    invokeMock.mockResolvedValue(profiles)
    await click(textButton('다시 불러오기')!)
    expect(document.querySelector('select')?.disabled).toBe(false)
    expect(document.querySelector('select')?.value).toBe(personalId)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  test('a deleted selected profile stays explicit instead of displaying the default account', async () => {
    await mount(<BrowserProfileSelect value="deleted-profile" onChange={vi.fn()} />)
    expect(document.querySelector('select')?.value).toBe('deleted-profile')
    expect(document.querySelector('option:checked')?.textContent).toBe('사용할 수 없는 프로필')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('선택한 프로필이 없습니다')
  })
})
