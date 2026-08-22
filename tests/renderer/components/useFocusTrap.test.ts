import { describe, expect, test, vi } from 'vitest'
import {
  handleFocusTrapKeyDown,
  restoreFocus
} from '../../../src/renderer/src/components/useFocusTrap'

interface FocusFixture {
  container: HTMLElement
  document: { activeElement: unknown }
  first: HTMLElement
  last: HTMLElement
}

function focusFixture(): FocusFixture {
  const ownerDocument: { activeElement: unknown } = { activeElement: null }
  const items: HTMLElement[] = []
  const makeItem = (): HTMLElement => {
    const item = {
      tabIndex: 0,
      isConnected: true,
      closest: () => null,
      focus: vi.fn(() => {
        ownerDocument.activeElement = item
      })
    } as unknown as HTMLElement
    items.push(item)
    return item
  }
  const first = makeItem()
  const last = makeItem()
  const container = {
    ownerDocument,
    querySelectorAll: () => items,
    contains: (element: unknown) => items.includes(element as HTMLElement),
    focus: vi.fn(() => {
      ownerDocument.activeElement = container
    })
  } as unknown as HTMLElement
  return { container, document: ownerDocument, first, last }
}

function tabEvent(shiftKey = false): {
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'defaultPrevented' | 'preventDefault'>
  preventDefault: ReturnType<typeof vi.fn>
} {
  const preventDefault = vi.fn()
  return {
    event: { key: 'Tab', shiftKey, defaultPrevented: false, preventDefault },
    preventDefault
  }
}

describe('useFocusTrap', () => {
  test('cycles Tab from the last item to the first item', () => {
    const fixture = focusFixture()
    fixture.document.activeElement = fixture.last
    const { event, preventDefault } = tabEvent()

    handleFocusTrapKeyDown(event, fixture.container)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(fixture.first.focus).toHaveBeenCalledOnce()
    expect(fixture.document.activeElement).toBe(fixture.first)
  })

  test('cycles Shift+Tab from the first item to the last item', () => {
    const fixture = focusFixture()
    fixture.document.activeElement = fixture.first
    const { event, preventDefault } = tabEvent(true)

    handleFocusTrapKeyDown(event, fixture.container)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(fixture.last.focus).toHaveBeenCalledOnce()
    expect(fixture.document.activeElement).toBe(fixture.last)
  })

  test('returns focus to the connected trigger element', () => {
    const trigger = {
      isConnected: true,
      focus: vi.fn()
    } as unknown as HTMLElement

    restoreFocus(trigger)

    expect(trigger.focus).toHaveBeenCalledOnce()
  })
})
