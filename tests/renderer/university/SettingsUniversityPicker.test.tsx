// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { SettingsUniversityPicker } from '../../../src/renderer/src/features/settings/SettingsUniversityPicker'

test('a failed custom-school save preserves the open form and name for retry', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onAddCustom = vi.fn(async () => false)
  const setInput = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  try {
    await act(async () => root.render(<SettingsUniversityPicker selectedId={null} onAddCustom={onAddCustom} onSelectPreset={() => {}} />))
    await act(() => setInput(host.querySelector('input[type=search]')!, 'My school'))
    await act(() => (host.querySelector('.university-picker__custom-cta') as HTMLButtonElement).click())
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(onAddCustom).toHaveBeenCalledWith({ nameKo: 'My school' })
    expect(host.querySelector('form')).not.toBeNull()
    expect((host.querySelector('form input') as HTMLInputElement).value).toBe('My school')
    onAddCustom.mockResolvedValue(true)
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(host.querySelector('form')).toBeNull()
  } finally { await act(() => root.unmount()); host.remove() }
})
