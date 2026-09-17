const SVG_NS = 'http://www.w3.org/2000/svg'
const OMIT = '.ink-layer__selection-frame, [class*="-resize"], .ink-layer__textbox-hit-target, .ink-layer__preview, .ink-layer__image-frame'
const PAINT = [
  'color', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'mix-blend-mode', 'overflow', 'font-family', 'font-size', 'font-weight',
  'font-style', 'line-height', 'text-align', 'text-decoration', 'white-space',
  'overflow-wrap', 'word-break', 'letter-spacing', 'background-color',
  'box-sizing', 'padding', 'border-width', 'border-style', 'border-color',
  'border-radius', 'display', 'vertical-align'
]

function blobUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('이미지를 읽지 못했어요.'))
    reader.readAsDataURL(blob)
  })
}

async function dataUrl(url: string): Promise<string> {
  // Local drawing images already arrive through IPC as data URLs. Fetching
  // those again is unnecessary and is blocked by the renderer's connect-src.
  if (url.startsWith('data:')) return url
  const response = await fetch(url)
  if (!response.ok) throw new Error('필기의 이미지를 불러오지 못했어요.')
  return blobUrl(await response.blob())
}

function containsCharacter(text: string, range: string): boolean {
  if (!range) return true
  return range.split(',').some((part) => {
    const [from, to] = part.trim().replace(/^U\+/i, '').split('-')
    if (!from) return false
    const min = parseInt(from.replace(/\?/g, '0'), 16)
    const max = parseInt((to ?? from).replace(/\?/g, 'F'), 16)
    return [...text].some((char) => { const cp = char.codePointAt(0)!; return cp >= min && cp <= max })
  })
}

/** Image-mode SVG cannot fetch web fonts: embed only the subsets used here. */
async function embedFonts(text: string, families: Set<string>): Promise<string> {
  const rules: CSSFontFaceRule[] = []
  const visit = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSFontFaceRule) rules.push(rule)
      else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules) } catch { /* Cross-origin styles do not supply our ink font. */ }
  }
  const needed = rules.filter((rule) => {
    const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim()
    return [...families].some((value) => value.replace(/["']/g, '').split(',').some((part) => part.trim() === family)) &&
      containsCharacter(text, rule.style.getPropertyValue('unicode-range'))
  })
  return (await Promise.all(needed.map(async (rule) => {
    let css = rule.cssText
    const urls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)]
    for (const match of urls) {
      const url = new URL(match[1]!, rule.parentStyleSheet?.href ?? document.baseURI).href
      css = css.replace(match[0], `url("${await dataUrl(url)}")`)
    }
    return css
  }))).join('\n')
}

/** Capture current ink, including an uncommitted textbox, without editor chrome. */
export async function renderInkSnapshot(source: SVGSVGElement, width: number, height: number, background: Promise<HTMLCanvasElement>): Promise<HTMLImageElement> {
  const clone = source.cloneNode(true) as SVGSVGElement
  const originals = [source, ...Array.from(source.querySelectorAll('*'))]
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))]
  const images: Promise<void>[] = []
  const families = new Set<string>()
  for (let index = 0; index < originals.length; index++) {
    const original = originals[index]!, copy = copies[index] as HTMLElement | SVGElement
    const style = getComputedStyle(original)
    for (const property of PAINT) copy.style.setProperty(property, style.getPropertyValue(property))
    if (original instanceof HTMLElement) {
      families.add(style.fontFamily)
      copy.style.width = style.width
      copy.style.height = style.height
    }
    if (original.matches('.ink-layer__textbox')) {
      copy.style.borderColor = 'transparent'
      copy.style.boxShadow = 'none'
      // Editing adds a panel-colored background, which is not part of the note.
      copy.style.background = original.hasAttribute('data-fill') ? style.getPropertyValue('--textbox-fill') : 'transparent'
    }
    if (original instanceof HTMLImageElement) {
      const url = original.currentSrc || original.src
      images.push(dataUrl(url).then((value) => { (copy as HTMLImageElement).src = value }))
    }
    if (original instanceof SVGImageElement) {
      images.push(dataUrl(original.href.baseVal).then((value) => { copy.setAttribute('href', value) }))
    }
    copy.removeAttribute('contenteditable')
    copy.removeAttribute('tabindex')
  }
  clone.querySelectorAll(OMIT).forEach((node) => node.remove())
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.style.cssText = 'overflow:hidden'
  const [fonts, paper] = await Promise.all([embedFonts(source.textContent ?? '', families), background, Promise.all(images)])
  const blob = await new Promise<Blob>((resolve, reject) => paper.toBlob((value) => value ? resolve(value) : reject(new Error('슬라이드를 읽지 못했어요.')), 'image/png'))
  const backdrop = document.createElementNS(SVG_NS, 'image')
  backdrop.setAttribute('href', await blobUrl(blob))
  backdrop.setAttribute('width', '1')
  backdrop.setAttribute('height', '1')
  backdrop.setAttribute('preserveAspectRatio', 'none')
  // Keep paper inside the SVG so multiply highlighters blend with the slide's
  // text, instead of tinting black text when a transparent overlay is flattened.
  clone.prepend(backdrop)
  if (fonts) {
    const style = document.createElementNS(SVG_NS, 'style')
    style.textContent = fonts
    clone.prepend(style)
  }
  const image = new Image()
  // Data URLs keep foreignObject SVG origin-clean in Chromium's image decoder.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
  await image.decode()
  return image
}
