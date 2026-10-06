// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { readBrowserAnchorRect } from '../../../src/renderer/src/features/workspace/panels/browserAnchor'

afterEach(() => { document.body.replaceChildren() })
test('retained hidden content never publishes native bounds even though it retains geometry', () => {
  const content = document.createElement('div'), anchor = document.createElement('div')
  content.append(anchor); document.body.append(content)
  const bounds = { x: 280, y: 100, width: 700, height: 500 }
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(bounds as DOMRect)
  vi.spyOn(anchor, 'getClientRects').mockReturnValue([bounds] as unknown as DOMRectList)
  anchor.style.visibility = 'visible'
  expect(readBrowserAnchorRect(anchor)).toEqual(bounds)
  content.hidden = true; content.style.display = 'block'
  expect(readBrowserAnchorRect(anchor)).toBeNull()
  content.hidden = false; content.setAttribute('inert', '')
  expect(readBrowserAnchorRect(anchor)).toBeNull()
  content.removeAttribute('inert'); anchor.style.visibility = 'hidden'
  expect(readBrowserAnchorRect(anchor)).toBeNull()
  anchor.style.visibility = 'visible'; content.remove()
  expect(readBrowserAnchorRect(anchor)).toBeNull()
})
