import { expect, test, type Locator } from '@playwright/test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { OFFICE_RUNTIME_VERSION, runOfficeCommand } from '../src/main/features/presentation/conversionRuntime'
import { join } from 'node:path'
import { createCourse, launchBandal, type BandalApp } from './helpers/launch'

const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

async function expectCompactDrawingToolbar(viewer: Locator): Promise<void> {
  const toolbar = viewer.locator(':scope > .pdf-tool-rail-shell')
  await expect(toolbar).toBeVisible()
  await expect.poll(async () => (await toolbar.boundingBox())!.height).toBeLessThanOrEqual(48)
  const viewerBox = (await viewer.boundingBox())!
  const headerBox = (await viewer.locator('.presentation-toolbar').boundingBox())!
  const toolbarBox = (await toolbar.boundingBox())!
  const scrollerBox = (await viewer.locator('.presentation-scroller').boundingBox())!
  expect(toolbarBox.height).toBeGreaterThanOrEqual(28)
  expect(Math.abs(toolbarBox.y - headerBox.y - headerBox.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(scrollerBox.y - toolbarBox.y - toolbarBox.height)).toBeLessThanOrEqual(1)
  expect(scrollerBox.height).toBeGreaterThan(viewerBox.height * .7)
  const buttonBox = (await toolbar.getByRole('button', { name: '펜', exact: true }).boundingBox())!
  expect(buttonBox.y).toBeGreaterThanOrEqual(toolbarBox.y)
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(toolbarBox.y + toolbarBox.height)
}

async function buildPptx(text: string, count = 1): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
      ${Array.from({ length: count }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
    </Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?>
    <p:presentation ${P_NS} ${R_NS}>
      <p:sldIdLst>${Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst>
      <p:sldSz cx="9144000" cy="6858000"/>
    </p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}
    </Relationships>`)
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  for (let index = 0; index < count; index++) zip.file(`ppt/slides/slide${index + 1}.xml`, `<?xml version="1.0"?>
    <p:sld ${P_NS} ${A_NS}>
      <p:cSld><p:spTree>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
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
    writeFileSync(join(courseDir, 'paired.pptx'), await buildPptx('연결할 슬라이드', 6))
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
    await expect(page.locator('.presentation-viewer')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('발표 제목 텍스트')).toBeVisible()
    await expect(page.locator('.presentation-page .pdf-drawing-layer')).toBeVisible()
    await expectCompactDrawingToolbar(page.locator('.presentation-viewer'))
    await page.getByRole('button', { name: 'PDF로 변환', exact: true }).click()
    await expect(page.locator('.toast').filter({ hasNotText: '최신' }).last()).toContainText('PDF 사본을 저장했어요.', { timeout: 15_000 })
    await expect(page.locator('[data-material-path="deck.pdf"]')).toBeVisible({ timeout: 40_000 })
    const pdf = await PDFDocument.load(readFileSync(join(courseDir, 'deck.pdf')))
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getSize()).toEqual({ width: 720, height: 540 })
    expect(readFileSync(join(courseDir, 'deck.pptx')).length).toBeGreaterThan(0)
  })

  test('hwpx opens as a text preview', async () => {
    const { page } = bandal
    await page.locator('[data-material-path="doc.hwpx"]').click()
    await expect(page.locator('.file-hwp__document')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('한글 문서 본문')).toBeVisible()
  })

  test('PPTX annotations persist and paired Markdown scrolls in both directions', async ({}, testInfo) => {
    const { page } = bandal
    await page.locator('[data-material-path="paired.pptx"]').click()
    const viewer = page.locator('.presentation-viewer:visible')
    const layer = viewer.locator('.presentation-page[data-slide-index="0"] .pdf-drawing-layer')
    await expect(layer).toBeVisible()
    await expect(layer).not.toHaveClass(/is-loading/)
    await viewer.getByRole('button', { name: '텍스트', exact: true }).click()
    await layer.click({ position: { x: 70, y: 160 } })
    const textbox = viewer.locator('.ink-layer__textbox.is-editing')
    await expect(textbox).toBeVisible()
    await textbox.locator('[contenteditable="true"]').fill('첫 줄\n둘째 줄')
    await viewer.getByRole('button', { name: '선택', exact: true }).click()
    await expect(viewer.locator('.ink-layer__textbox-object')).toContainText('둘째 줄')
    await viewer.getByRole('button', { name: '페이지 필기', exact: true }).click()
    await page.getByRole('button', { name: '만들고 나란히 열기', exact: true }).click()
    await expect(page.locator('.page-note-paper')).toHaveCount(6)
    await expect(page.locator('.page-note-scroll')).toBeVisible()
    await expectCompactDrawingToolbar(viewer)
    const rail = viewer.locator('.pdf-tool-rail')
    await expect(viewer.locator('.pdf-tool-rail-shell')).toHaveAttribute('data-overflow', 'true')
    const slideTop = await viewer.locator('.presentation-scroller').evaluate((node) => node.scrollTop)
    await viewer.getByRole('button', { name: '다음 필기 도구', exact: true }).click()
    await expect.poll(() => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100)
    expect(await viewer.locator('.presentation-scroller').evaluate((node) => node.scrollTop)).toBe(slideTop)
    await rail.hover()
    await page.mouse.wheel(0, 2000)
    await expect(viewer.getByRole('button', { name: '다음 필기 도구', exact: true })).toBeDisabled()
    const exportButton = viewer.getByRole('button', { name: '주석 포함 PDF 내보내기', exact: true })
    const railBox = (await rail.boundingBox())!
    const exportBox = (await exportButton.boundingBox())!
    expect(exportBox.x).toBeGreaterThanOrEqual(railBox.x)
    expect(exportBox.x + exportBox.width).toBeLessThanOrEqual(railBox.x + railBox.width + 1)
    await expectCompactDrawingToolbar(viewer)
    await rail.evaluate((node) => { node.scrollLeft = 0 })
    await viewer.getByRole('spinbutton', { name: '슬라이드 번호' }).fill('3')
    await expect.poll(() => page.locator('.page-note-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(200)
    await page.locator('.page-note-scroll').hover()
    await page.mouse.wheel(0, 350)
    await expect.poll(() => viewer.getByRole('spinbutton', { name: '슬라이드 번호' }).inputValue()).not.toBe('3')
    await page.screenshot({ path: testInfo.outputPath('pptx-paired-toolbar.png') })
  })

  test('legacy runtime installs privately, verifies its signature, and normalizes PPT offline', async () => {
    test.skip(process.env.BANDAL_TEST_PPT_RUNTIME !== '1', 'Opt-in: downloads the signed LibreOffice runtime to a disposable test profile.')
    test.setTimeout(15 * 60_000)
    const installed = await bandal.page.evaluate(() => window.bandal.invoke('presentation:installRuntime', {}))
    expect(installed.status).toBe('ready')
    const binary = process.platform === 'darwin'
      ? join(bandal.userDataDir, 'presentation-runtime', `${OFFICE_RUNTIME_VERSION}-${process.platform}-${process.arch}`, 'LibreOffice.app/Contents/MacOS/soffice')
      : join(bandal.userDataDir, 'presentation-runtime', `${OFFICE_RUNTIME_VERSION}-${process.platform}-${process.arch}`, 'program/soffice.exe')
    await runOfficeCommand(binary, [`-env:UserInstallation=${pathToFileURL(join(bandal.profileDir, 'fixture-profile')).href}`, '--headless', '--convert-to', 'ppt:MS PowerPoint 97', '--outdir', courseDir, join(courseDir, 'deck.pptx')])
    const original = createHash('sha256').update(readFileSync(join(courseDir, 'deck.ppt'))).digest('hex')
    await bandal.page.getByRole('button', { name: '자료 새로고침' }).click()
    await bandal.page.locator('[data-material-path="deck.ppt"]').click()
    await expect(bandal.page.locator('.presentation-viewer:visible')).toBeVisible({ timeout: 90_000 })
    await expect(bandal.page.getByText('발표 제목 텍스트', { exact: true }).last()).toBeVisible()
    expect(createHash('sha256').update(readFileSync(join(courseDir, 'deck.ppt'))).digest('hex')).toBe(original)
    expect(readdirSync(join(bandal.userDataDir, 'presentation-runtime/cache', OFFICE_RUNTIME_VERSION))).toHaveLength(1)
  })

  test('docx keeps opening in the mammoth viewer (regression)', async () => {
    const { page } = bandal
    await page.locator('[data-material-path="memo.docx"]').click()
    await expect(page.locator('.file-docx__document')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('워드 본문 확인')).toBeVisible()
  })

  test('legacy ppt offers an explicit local runtime install, not Finder', async () => {
    const { page } = bandal
    await page.locator('[data-material-path="old.ppt"]').click()
    const panel = page.locator('.presentation-runtime')
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByRole('button', { name: '변환기 설치하고 열기' })).toBeVisible()
    await expect(panel.getByRole('button', { name: '파일 위치 보기' })).toBeVisible()
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
