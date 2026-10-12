// @vitest-environment jsdom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: mocks.invoke }))

import { BrowserLoginPrompt } from '../../../src/renderer/src/features/browser/BrowserLoginPrompt'
import { isPointerPassthroughActive } from '../../../src/renderer/src/features/browser/webviewPassthrough'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
const callbacks = { onSave: vi.fn(), onDecline: vi.fn(), onSuppress: vi.fn() }
const candidate = { kind: 'save' as const, origin: 'https://accounts.google.com', username: 'student@example.edu' }

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function render(kind: 'save' | 'update' = 'save'): void {
  act(() => root.render(<BrowserLoginPrompt {...candidate} {...callbacks} kind={kind} />))
}

function trigger(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('.browser-password-trigger')!
}

function open(): HTMLElement {
  const button = trigger()
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(800, 20, 80, 28))
  act(() => { button.focus(); button.click() })
  return document.querySelector<HTMLElement>('[role="dialog"]')!
}

function dialogButton(label: string): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
    .find(button => button.textContent === label)!
}

describe('password save card', () => {
  test.each(['save', 'update'] as const)('opens the %s card at its trigger without adding a browser content row', kind => {
    render(kind)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(isPointerPassthroughActive()).toBe(false)
    const before = Array.from(host.children)
    const card = open()
    expect(card).not.toBeNull()
    expect(host.contains(card)).toBe(false)
    expect(Array.from(host.children)).toEqual(before)
    expect(card.style.top).toBe('56px')
    expect(card.style.right).toBe(`${window.innerWidth - 880}px`)
    expect(card.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(card.getAttribute('aria-labelledby')!)?.textContent)
      .toBe(kind === 'update' ? '비밀번호 업데이트' : '비밀번호 저장')
    expect(card.querySelector('.browser-password-card__account strong')?.textContent).toBe('accounts.google.com')
    expect(card.querySelector('.browser-password-card__account span')?.textContent).toBe('student@example.edu')
    expect(dialogButton(kind === 'update' ? '업데이트' : '저장')).toBeDefined()
    expect(isPointerPassthroughActive()).toBe(true)
    expect(mocks.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: true })
  })

  test.each(['close', 'escape', 'outside', 'resize', 'blur'])('%s dismisses only the card and preserves the save candidate', action => {
    render()
    open()
    act(() => {
      if (action === 'close') document.querySelector<HTMLButtonElement>('[aria-label="비밀번호 안내 닫기"]')!.click()
      else if (action === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      else if (action === 'outside') document.querySelector('.browser-password-backdrop')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      else window.dispatchEvent(new Event(action))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
    expect(callbacks.onSave).not.toHaveBeenCalled()
    expect(callbacks.onDecline).not.toHaveBeenCalled()
    expect(callbacks.onSuppress).not.toHaveBeenCalled()
    expect(isPointerPassthroughActive()).toBe(false)
    expect(mocks.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: false })
    expect(open().querySelector('.browser-password-card__account span')?.textContent).toBe(candidate.username)
  })

  test.each([
    ['저장', 'onSave'], ['이번엔 안 함', 'onDecline'], ['이 사이트는 묻지 않기', 'onSuppress']
  ] as const)('%s invokes only its intended decision', (label, callback) => {
    render()
    open()
    act(() => dialogButton(label).click())
    for (const [name, handler] of Object.entries(callbacks)) {
      expect(handler).toHaveBeenCalledTimes(name === callback ? 1 : 0)
    }
  })

  test('a pending save disables repeated decisions while leaving dismissal available', () => {
    function SavingPrompt(): JSX.Element {
      const [pending, setPending] = useState(false)
      return <BrowserLoginPrompt {...candidate} {...callbacks} pending={pending} onSave={() => {
        callbacks.onSave()
        setPending(true)
      }} />
    }
    act(() => root.render(<SavingPrompt />))
    open()
    act(() => dialogButton('저장').click())
    const save = dialogButton('저장 중…')
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-busy')).toBe('true')
    expect(save.disabled).toBe(true)
    expect(dialogButton('이번엔 안 함').disabled).toBe(true)
    expect(dialogButton('이 사이트는 묻지 않기').disabled).toBe(true)
    act(() => { save.click(); dialogButton('이번엔 안 함').click(); dialogButton('이 사이트는 묻지 않기').click() })
    expect(callbacks.onSave).toHaveBeenCalledOnce()
    expect(callbacks.onDecline).not.toHaveBeenCalled()
    expect(callbacks.onSuppress).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLButtonElement>('[aria-label="비밀번호 안내 닫기"]')?.disabled).toBe(false)
  })

  test('removing an open candidate releases the browser input occlusion', () => {
    render()
    open()
    act(() => root.render(null))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(isPointerPassthroughActive()).toBe(false)
    expect(mocks.invoke).toHaveBeenLastCalledWith('browser:setHostOccluded', { occluded: false })
  })
})
