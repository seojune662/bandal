// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { captureInkSnapshot } from '../../../src/renderer/src/features/ink/renderInkSnapshot'

beforeEach(() => {
  vi.stubGlobal('SVGImageElement', class {})
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['paper'], { type: 'image/png' })))
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn(async () => undefined) })
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('exports text in the same coordinates and typography across viewer zoom, including em insets and mixed font sizes', async () => {
  const computedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const actual = computedStyle(element)
    if (!element.matches('.ink-layer__textbox')) return actual
    const node = element as HTMLElement
    const font = parseFloat(node.style.fontSize)
    // Chromium reports a rounded screen border even for an authored em border.
    const values: Record<string, string> = { 'font-size': `${font}px`, 'line-height': `${font * 1.35}px`,
      padding: `${font * .3}px`, 'border-width': '1px' }
    return { fontFamily: actual.fontFamily, width: actual.width, height: actual.height,
      getPropertyValue: (property: string) => values[property] ?? actual.getPropertyValue(property) } as CSSStyleDeclaration
  })
  const geometry: number[][] = []
  for (const width of [528, 697, 900, 1250]) {
    const height = width * 2 / 3
    document.body.innerHTML = `<section><svg class="pdf-drawing-layer" viewBox="0 0 1 1"><foreignObject class="ink-layer__textbox-object" x="${width * .1}" y="${height * .22}" width="${width * .35}" height="${height * .18}" transform="scale(${1 / width} ${1 / height})"><div class="ink-layer__textbox" style="box-sizing:border-box;width:100%;height:100%;font-size:${width * 16 / 600}px;line-height:1.35;padding:.3em;border:.06em solid transparent;white-space:pre-wrap">복사할 한글 필기\n<span style="font-size:${width * 24 / 600}px">두 번째 줄</span></div></foreignObject></svg></section>`
    const snapshot = captureInkSnapshot(document.querySelector('section')!)!
    const paper = document.createElement('canvas'); paper.width = 1600; paper.height = 1067
    const image = await snapshot(paper, new AbortController().signal)
    const svg = new DOMParser().parseFromString(decodeURIComponent(image.src.split(',').slice(1).join(',')), 'image/svg+xml')
    expect(svg.querySelector('parsererror')?.textContent).toBeUndefined()
    const object = svg.querySelector('foreignObject')!
    const content = svg.querySelector<HTMLElement>('.ink-layer__textbox')!
    const mixed = svg.querySelector<HTMLElement>('span')!
    geometry.push([...['x', 'y', 'width', 'height'].map(attribute => Number(object.getAttribute(attribute))),
      parseFloat(content.style.fontSize), parseFloat(content.style.lineHeight), parseFloat(mixed.style.fontSize)])
    expect(content.style.padding).toBe('0.3em')
    expect(content.style.borderWidth).toBe('0.06em')
    expect(content.style.width).toBe('100%'); expect(content.style.height).toBe('100%')
  }
  for (const result of geometry.slice(1)) result.forEach((value, index) => expect(value).toBeCloseTo(geometry[0]![index]!, 6))
})
