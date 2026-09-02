import { expect, test } from '@playwright/test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

async function buildPptx(text: string): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
    </Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?>
    <p:presentation ${P_NS} ${R_NS}>
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      <p:sldSz cx="9144000" cy="6858000"/>
    </p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/>
    </Relationships>`)
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0"?>
    <p:sld ${P_NS} ${A_NS}>
      <p:cSld><p:spTree>
        <p:sp>
          <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="6858000" cy="1143000"/></a:xfrm></p:spPr>
          <p:txBody><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>${text}</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function buildHwpx(text: string): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('mimetype', 'application/hwp+zip')
  zip.file('Contents/section0.xml', `<?xml version="1.0"?>
    <hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
            xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
      <hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>
    </hs:sec>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function buildDocx(text: string): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`)
  zip.file('word/document.xml', `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
    </w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

test.describe('office document viewers + sidebar ux', () => {
  let bandal: BandalApp
  let courseDir: string

  test.beforeAll(async () => {
    bandal = await launchBandal()
    const { page } = bandal
    await createCourse(page, '공학설계')
    const folders = readdirSync(bandal.dataRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    courseDir = join(bandal.dataRoot, folders[0]!)

    writeFileSync(join(courseDir, 'deck.pptx'), await buildPptx('발표 제목 텍스트'))
    writeFileSync(join(courseDir, 'doc.hwpx'), await buildHwpx('한글 문서 본문'))
    writeFileSync(join(courseDir, 'memo.docx'), await buildDocx('워드 본문 확인'))
    writeFileSync(join(courseDir, 'old.ppt'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))
    writeFileSync(join(courseDir, 'temp.txt'), 'to be deleted')
    await page.getByRole('button', { name: '자료 새로고침' }).click()
  })

  test.afterAll(async () => {
    await bandal.close()
  })

  test('pptx opens as rendered slides in a tab', async () => {
    const { page } = bandal
    await page.locator('[data-material-path="deck.pptx"]').click()
    await expect(page.locator('.file-slides__slide')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('발표 제목 텍스트')).toBeVisible()
  })

  test('hwpx opens as a text preview', async () => {
    const { page } = bandal
    await page.locator('[data-material-path="doc.hwpx"]').click()
    await expect(page.locator('.file-hwp__document')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('한글 문서 본문')).toBeVisible()
  })

  test('docx keeps opening in the mammoth viewer (regression)', async () => {
    const { page } = bandal
    await page.locator('[data-material-path="memo.docx"]').click()
    await expect(page.locator('.file-docx__document')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('워드 본문 확인')).toBeVisible()
  })

  test('legacy ppt lands on the preview fallback, not Finder', async () => {
    const { page } = bandal
    await page.locator('[data-material-path="old.ppt"]').click()
    const panel = page.locator('.file-preview')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    // Quick Look 은 네이티브 패널이라 클릭하지 않는다 — 버튼 존재만 확인.
    await expect(panel.getByRole('button', { name: '미리보기' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Finder에서 보기' })).toBeVisible()
  })

  test('the right sidebar resizes by dragging its handle', async () => {
    const { page } = bandal
    const rail = page.locator('.app-rail--right')
    const before = (await rail.boundingBox())!.width
    const handle = page.locator('.rail-resizer--right')
    const grip = (await handle.boundingBox())!
    const x = grip.x + grip.width / 2
    const y = grip.y + grip.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 80, y, { steps: 4 })
    await page.mouse.up()
    const after = (await rail.boundingBox())!.width
    expect(after).toBeGreaterThan(before + 60)
    // 더블클릭 = 기본 폭 복원.
    await handle.dblclick()
    await expect
      .poll(async () => (await rail.boundingBox())!.width)
      .toBeLessThan(after - 20)
  })

  test('Delete key moves the selected material to trash (with confirm)', async () => {
    const { page } = bandal
    const row = page.locator('[data-material-path="temp.txt"]')
    await expect(row).toBeVisible()
    await row.click()
    await page.keyboard.press('Delete')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '휴지통으로 이동' }).click()
    await expect(row).toHaveCount(0)
  })
})
