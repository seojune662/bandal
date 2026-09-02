// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import {
  parsePptx,
  PptxParseError
} from '../../../src/renderer/src/features/file/pptx/parsePptx'

const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function presentationXml(slideRefs: string[], sldSz = 'cx="9144000" cy="6858000"'): string {
  return `<?xml version="1.0"?>
    <p:presentation ${P_NS} ${R_NS}>
      <p:sldIdLst>
        ${slideRefs.map((rid, index) => `<p:sldId id="${256 + index}" r:id="${rid}"/>`).join('')}
      </p:sldIdLst>
      <p:sldSz ${sldSz}/>
    </p:presentation>`
}

function relsXml(entries: Array<[string, string]>): string {
  return `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${entries.map(([id, target]) => `<Relationship Id="${id}" Type="t" Target="${target}"/>`).join('')}
    </Relationships>`
}

function textSlide(text: string, withFrame = true): string {
  const xfrm = withFrame
    ? '<a:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="914400"/></a:xfrm>'
    : ''
  return `<?xml version="1.0"?>
    <p:sld ${P_NS} ${A_NS} ${R_NS}>
      <p:cSld><p:spTree>
        <p:sp>
          <p:spPr>${xfrm}</p:spPr>
          <p:txBody>
            <a:p><a:r><a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`
}

function baseFiles(slides: Record<string, string>): Map<string, string | Uint8Array> {
  const names = Object.keys(slides)
  const files = new Map<string, string | Uint8Array>()
  files.set('ppt/presentation.xml', presentationXml(names.map((_, i) => `rId${i + 1}`)))
  files.set(
    'ppt/_rels/presentation.xml.rels',
    relsXml(names.map((name, i) => [`rId${i + 1}`, `slides/${name}`]))
  )
  for (const [name, xml] of Object.entries(slides)) {
    files.set(`ppt/slides/${name}`, xml)
  }
  return files
}

describe('parsePptx', () => {
  test('follows sldIdLst order and parses frames + runs', () => {
    const files = baseFiles({
      'slideB.xml': textSlide('두번째'),
      'slideA.xml': textSlide('첫번째')
    })
    // rels 순서가 슬라이드 순서 — 파일명이 아니라 sldIdLst 를 따라야 한다.
    const parsed = parsePptx(files)
    expect(parsed.slideCx).toBe(9144000)
    expect(parsed.slides).toHaveLength(2)

    const first = parsed.slides[0]!.shapes[0]!
    expect(first.type).toBe('text')
    if (first.type !== 'text') return
    expect(first.frame).toEqual({ x: 914400, y: 914400, w: 4572000, h: 914400 })
    const run = first.paragraphs[0]![0]!
    expect(run.text).toBe('두번째')
    expect(run.sizePt).toBe(24)
    expect(run.bold).toBe(true)
    expect(run.color).toBe('#FF0000')
  })

  test('defaults slide size to 16:9 when sldSz is missing', () => {
    const files = baseFiles({ 'slide1.xml': textSlide('t') })
    files.set('ppt/presentation.xml', presentationXml(['rId1'], ''))
    const parsed = parsePptx(files)
    expect(parsed.slideCx).toBe(12192000)
    expect(parsed.slideCy).toBe(6858000)
  })

  test('a shape without xfrm gets frame null (placeholder inheritance)', () => {
    const parsed = parsePptx(baseFiles({ 'slide1.xml': textSlide('제목', false) }))
    const shape = parsed.slides[0]!.shapes[0]!
    expect(shape.frame).toBeNull()
  })

  test('resolves picture rels to a data url (png) and degrades unknown media', () => {
    const slide = `<?xml version="1.0"?>
      <p:sld ${P_NS} ${A_NS} ${R_NS}>
        <p:cSld><p:spTree>
          <p:pic>
            <p:blipFill><a:blip r:embed="rId7"/></p:blipFill>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr>
          </p:pic>
          <p:pic>
            <p:blipFill><a:blip r:embed="rId8"/></p:blipFill>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr>
          </p:pic>
        </p:spTree></p:cSld>
      </p:sld>`
    const files = baseFiles({ 'slide1.xml': slide })
    files.set(
      'ppt/slides/_rels/slide1.xml.rels',
      relsXml([['rId7', '../media/image1.png'], ['rId8', '../media/vector.emf']])
    )
    files.set('ppt/media/image1.png', Uint8Array.from([1, 2, 3]))
    files.set('ppt/media/vector.emf', Uint8Array.from([9, 9]))
    const shapes = parsePptx(files).slides[0]!.shapes
    expect(shapes[0]).toMatchObject({
      type: 'image',
      dataUrl: `data:image/png;base64,${btoa('')}`
    })
    expect(shapes[1]).toMatchObject({ type: 'image', dataUrl: null })
  })

  test('tables become rows and charts become labeled placeholders', () => {
    const slide = `<?xml version="1.0"?>
      <p:sld ${P_NS} ${A_NS}>
        <p:cSld><p:spTree>
          <p:graphicFrame>
            <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
              <a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>셀A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>셀B</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>
            </a:graphicData></a:graphic>
          </p:graphicFrame>
          <p:graphicFrame>
            <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic>
          </p:graphicFrame>
        </p:spTree></p:cSld>
      </p:sld>`
    const shapes = parsePptx(baseFiles({ 'slide1.xml': slide })).slides[0]!.shapes
    expect(shapes[0]!.type).toBe('table')
    if (shapes[0]!.type === 'table') {
      expect(shapes[0]!.rows[0]!.map((cell) => cell[0]!.text)).toEqual(['셀A', '셀B'])
    }
    expect(shapes[1]).toMatchObject({ type: 'placeholder', label: '차트' })
  })

  test('a broken slide xml degrades to an empty slide, not a throw', () => {
    const files = baseFiles({ 'slide1.xml': '<broken<<' })
    expect(parsePptx(files).slides[0]!.shapes).toEqual([])
  })

  test('throws PptxParseError when there are no slides', () => {
    const files = new Map<string, string | Uint8Array>([
      ['ppt/presentation.xml', presentationXml([])]
    ])
    expect(() => parsePptx(files)).toThrow(PptxParseError)
  })
})
