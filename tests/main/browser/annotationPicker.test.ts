// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { browserAnnotationPickerSource } from '../../../src/main/features/browser/annotationPickerSource'

type Picker = { stop(): void; resume(): void; valid(pickId: number): boolean; drain(): Promise<{ events: { pickId: number; quote?: string; rect: { x: number; y: number; width: number; height: number }; cancelled?: boolean }[] }> }
const picker = (): Picker => (window as unknown as Record<string, Picker>)['__bandalAnnotationPickerV1']!
const pointer = (type: string, x: number, y: number): void => { document.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })) }

beforeEach(() => {
  document.body.innerHTML = '<p id="source">A source paragraph</p><input type="password" value="never capture me">'
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.spyOn(document.querySelector('p')!, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 60, width: 200, height: 40, toJSON: () => ({}) })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => document.querySelector('p')) })
})
afterEach(() => { picker()?.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('picks a live semantic node without clicking it and restores the existing text selection', async () => {
  const source = document.querySelector('p')!, range = document.createRange()
  range.selectNodeContents(source); window.getSelection()!.addRange(range)
  window.eval(browserAnnotationPickerSource({ sessionId: 'session-1', mode: 'element' }))
  expect(document.querySelector('[data-bandal-annotation]')).not.toBeNull()
  pointer('pointerdown', 30, 30); pointer('pointerup', 30, 30)
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  source.dispatchEvent(click)
  expect(click.defaultPrevented).toBe(true)
  const result = await picker().drain()
  expect(result.events[0]).toMatchObject({ quote: 'A source paragraph', rect: { x: 10, y: 20, width: 200, height: 40 } })
  picker().stop()
  expect(document.querySelector('[data-bandal-annotation]')).toBeNull()
  expect(window.getSelection()!.toString()).toBe('A source paragraph')
})

test('manual regions use drag coordinates and escape is queued for the owning conversation', async () => {
  window.eval(browserAnnotationPickerSource({ sessionId: 'session-2', mode: 'region' }))
  pointer('pointerdown', 120, 130); pointer('pointerup', 20, 30)
  const result = await picker().drain()
  expect(result.events[0]?.rect).toEqual({ x: 20, y: 30, width: 100, height: 100 })
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  expect((await picker().drain()).events[0]?.cancelled).toBe(true)
  expect(document.querySelector('[data-bandal-annotation]')).toBeNull()
})

test('never reads text-entry values as semantic annotations', async () => {
  vi.mocked(document.elementFromPoint).mockReturnValue(document.querySelector('input'))
  window.eval(browserAnnotationPickerSource({ sessionId: 'session-3', mode: 'element' }))
  pointer('pointerup', 30, 30)
  expect((await picker().drain()).events).toEqual([])
})


test('revalidates same-page source edits and keeps later selections when a capture finishes', async () => {
  window.eval(browserAnnotationPickerSource({ sessionId: 'session-4', mode: 'element' }))
  pointer('pointerup', 30, 30)
  const first = (await picker().drain()).events[0]!
  expect(picker().valid(first.pickId)).toBe(true)
  document.querySelector('p')!.textContent = 'Changed after clicking'
  expect(picker().valid(first.pickId)).toBe(false)
  pointer('pointerup', 30, 30)
  picker().resume()
  const second = (await picker().drain()).events[0]!
  expect(picker().valid(second.pickId)).toBe(true)
  expect(second.quote).toBe('Changed after clicking')
})
