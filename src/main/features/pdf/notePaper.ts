import { PageSizes, rgb, type PDFDocument, type PDFPage } from 'pdf-lib'

/** Paper templates for notes. Stored in the PDF keywords so the template
 * travels with the file and an inserted page can match it. */
export type Paper = 'blank' | 'lines' | 'grid' | 'dots'
export type NoteSurface = 'light' | 'dark'
export type Orientation = 'portrait' | 'landscape'
export const PAPERS: Paper[] = ['blank', 'lines', 'grid', 'dots']
const RULE_SPACING = 28
const WHITE = rgb(1, 1, 1), RULING = rgb(0.82, 0.84, 0.88)

export function noteSize(orientation: Orientation): [number, number] {
  const [width, height] = PageSizes.A4
  return orientation === 'landscape' ? [height, width] : [width, height]
}
/** Same ruling as the desktop board export, on white paper. */
export function drawPaper(page: PDFPage, paper: Paper, surface: NoteSurface = 'light'): void {
  const color = surface === 'dark' ? rgb(0.045, 0.065, 0.115) : WHITE
  const ruling = surface === 'dark' ? rgb(0.2, 0.25, 0.36) : RULING
  const { width, height } = page.getSize()
  page.drawRectangle({ x: 0, y: 0, width, height, color })
  if (paper === 'blank') return
  if (paper === 'dots') {
    for (let x = RULE_SPACING; x < width; x += RULE_SPACING) for (let y = RULE_SPACING; y < height; y += RULE_SPACING) page.drawCircle({ x, y, size: 0.85, color: ruling, opacity: 0.72 })
    return
  }
  for (let y = RULE_SPACING; y < height; y += RULE_SPACING) page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.55, color: ruling, opacity: 0.68 })
  if (paper === 'lines') return
  for (let x = RULE_SPACING; x < width; x += RULE_SPACING) page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: 0.55, color: ruling, opacity: 0.68 })
}
export function setPaper(pdf: PDFDocument, paper: Paper, orientation: Orientation, surface: NoteSurface = 'light'): void {
  pdf.setKeywords(['bandal-note', `paper=${paper}`, `orientation=${orientation}`, `surface=${surface}`])
}
export function readPaper(pdf: PDFDocument): Paper | null {
  const keywords = pdf.getKeywords() ?? ''
  if (!keywords.includes('bandal-note')) return null
  const match = /paper=(blank|lines|grid|dots)/.exec(keywords)
  return (match?.[1] as Paper | undefined) ?? 'blank'
}

export function readSurface(pdf: PDFDocument): NoteSurface {
  return /(?:^|[ ,;])surface=dark(?:$|[ ,;])/.test(pdf.getKeywords() ?? '') ? 'dark' : 'light'
}
