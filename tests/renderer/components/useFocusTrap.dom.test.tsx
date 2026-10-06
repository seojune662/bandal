// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { focusableElements, handleFocusTrapKeyDown } from '../../../src/renderer/src/components/useFocusTrap'

afterEach(() => { document.body.replaceChildren() })

test.each([
  '<div style="display:none"><button>Hidden last</button></div>',
  '<button style="visibility:hidden">Hidden last</button>',
  '<fieldset disabled><button>Disabled last</button></fieldset>',
  '<button tabindex="0" disabled>Disabled last</button>'
])('Tab skips controls that cannot receive focus: %s', extra => {
  document.body.innerHTML = `<div id="dialog"><button id="first">First</button><button id="last">Last</button>${extra}</div>`
  const container = document.querySelector<HTMLElement>('#dialog')!
  document.querySelector<HTMLElement>('#last')!.focus()
  const preventDefault = vi.fn()
  handleFocusTrapKeyDown({ key: 'Tab', shiftKey: false, defaultPrevented: false, preventDefault }, container)
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(document.activeElement?.id).toBe('first')
})

test('Shift+Tab from the dialog container stays inside the dialog', () => {
  document.body.innerHTML = '<div id="dialog" tabindex="-1"><button id="first">First</button><button id="last">Last</button></div>'
  const container = document.querySelector<HTMLElement>('#dialog')!
  container.focus()
  handleFocusTrapKeyDown({ key: 'Tab', shiftKey: true, defaultPrevented: false, preventDefault: vi.fn() }, container)
  expect(document.activeElement?.id).toBe('last')
})

test('closed disclosure exposes its summary but excludes its hidden controls', () => {
  document.body.innerHTML = '<div id="dialog"><button id="first">First</button><details><summary id="summary" tabindex="0">Options</summary><input id="hidden"><details open><summary tabindex="0">Nested</summary><button>Hidden action</button></details></details></div>'
  const container = document.querySelector<HTMLElement>('#dialog')!
  expect(focusableElements(container).map(element => element.id)).toEqual(['first', 'summary'])
  document.querySelector<HTMLElement>('#summary')!.focus()
  handleFocusTrapKeyDown({ key: 'Tab', shiftKey: false, defaultPrevented: false, preventDefault: vi.fn() }, container)
  expect(document.activeElement?.id).toBe('first')
  container.querySelector('details')!.open = true
  expect(focusableElements(container).map(element => element.id)).toContain('hidden')
})
