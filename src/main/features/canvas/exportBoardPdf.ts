import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit, {
  type Font as FontkitFont,
  type Path as FontkitPath
} from '@pdf-lib/fontkit'
import {
  BlendMode,
  LineCapStyle,
  PageSizes,
  PDFDocument,
  rgb,
  type Color,
  type PDFFont,
  type PDFPage
} from 'pdf-lib'
import type {
  DrawingBox,
  DrawingColor,
  DrawingPoint,
  DrawingShape
} from '../../../shared/types/drawing'
import type {
  BoardBackground,
  BoardSurface,
  OpenPersonalBoardResult
} from '../../../shared/types/whiteboard'
import { NotFoundError, ValidationError } from '../../db/errors'
import { requireId } from '../../db/validate'

const TEXTBOX_FONT_FILE = 'NotoSansKR-Regular.otf'
const RULE_SPACING = 28

const LIGHT_COLORS: Record<DrawingColor, Color> = {
  ink: rgb(0.08, 0.09, 0.12),
  red: rgb(0.84, 0.14, 0.18),
  orange: rgb(0.94, 0.39, 0.08),
  yellow: rgb(0.78, 0.54, 0.02),
  green: rgb(0.1, 0.58, 0.3),
  blue: rgb(0.08, 0.38, 0.88),
  violet: rgb(0.49, 0.21, 0.82)
}

/** High-contrast counterparts for marks drawn on the dark paper. */
const DARK_COLORS: Record<DrawingColor, Color> = {
  ink: rgb(0.94, 0.96, 0.99),
  red: rgb(1, 0.48, 0.5),
  orange: rgb(1, 0.68, 0.32),
  yellow: rgb(1, 0.88, 0.34),
  green: rgb(0.46, 0.88, 0.6),
  blue: rgb(0.46, 0.72, 1),
  violet: rgb(0.78, 0.62, 1)
}

interface BoardPalette {
  paper: Color
  ruling: Color
  marks: Record<DrawingColor, Color>
}

interface ScalableFontkitPath extends FontkitPath {
  scale(x: number, y: number): ScalableFontkitPath
}

interface TextboxFont {
  embedded: PDFFont
  outlines: FontkitFont
}

const BOARD_PALETTES: Record<BoardSurface, BoardPalette> = {
  light: {
    paper: rgb(1, 1, 1),
    ruling: rgb(0.82, 0.84, 0.88),
    marks: LIGHT_COLORS
  },
  dark: {
    paper: rgb(0.045, 0.065, 0.115),
    ruling: rgb(0.2, 0.25, 0.36),
    marks: DARK_COLORS
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pdfPoint(
  point: DrawingPoint,
  width: number,
  height: number
): { x: number; y: number } {
  return { x: point.x * width, y: (1 - point.y) * height }
}

function drawBackground(
  page: PDFPage,
  background: BoardBackground,
  palette: BoardPalette,
  width: number,
  height: number
): void {
  page.drawRectangle({ x: 0, y: 0, width, height, color: palette.paper })
  if (background === 'blank') return

  if (background === 'dots') {
    for (let x = RULE_SPACING; x < width; x += RULE_SPACING) {
      for (let y = RULE_SPACING; y < height; y += RULE_SPACING) {
        page.drawCircle({ x, y, size: 0.85, color: palette.ruling, opacity: 0.72 })
      }
    }
    return
  }

  for (let y = RULE_SPACING; y < height; y += RULE_SPACING) {
    page.drawLine({
      start: { x: 0, y },
      end: { x: width, y },
      thickness: 0.55,
      color: palette.ruling,
      opacity: 0.68
    })
  }
  if (background === 'lines') return
  for (let x = RULE_SPACING; x < width; x += RULE_SPACING) {
    page.drawLine({
      start: { x, y: 0 },
      end: { x, y: height },
      thickness: 0.55,
      color: palette.ruling,
      opacity: 0.68
    })
  }
}

function drawInk(
  page: PDFPage,
  shape: DrawingShape,
  palette: BoardPalette,
  surface: BoardSurface,
  width: number,
  height: number
): void {
  const points = shape.data.points ?? []
  const first = points[0]
  if (first === undefined) return
  const baseThickness = Math.max(shape.style.width * width, 0.25)
  const opacity = shape.kind === 'highlighter'
    ? Math.min(clamp(shape.style.opacity, 0, 1), 0.42)
    : clamp(shape.style.opacity, 0, 1)
  const color = palette.marks[shape.style.color]
  const blendMode = shape.kind === 'highlighter'
    ? surface === 'dark' ? BlendMode.Screen : BlendMode.Multiply
    : BlendMode.Normal
  if (points.length === 1) {
    page.drawCircle({
      ...pdfPoint(first, width, height),
      size: Math.max(baseThickness * Math.max(first.p, 0.25) / 2, 0.25),
      color,
      opacity,
      blendMode
    })
    return
  }
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (previous === undefined || current === undefined) continue
    const pressure = shape.kind === 'highlighter'
      ? 1
      : Math.max(0.2, (previous.p + current.p) / 2)
    page.drawLine({
      start: pdfPoint(previous, width, height),
      end: pdfPoint(current, width, height),
      thickness: Math.max(baseThickness * pressure, 0.25),
      color,
      opacity,
      blendMode,
      lineCap: LineCapStyle.Round
    })
  }
}

function boxOnPage(
  box: DrawingBox,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } | null {
  const boxWidth = box.width * width
  const boxHeight = box.height * height
  if (boxWidth <= 0 || boxHeight <= 0) return null
  return {
    x: box.x * width,
    y: height - (box.y + box.height) * height,
    width: boxWidth,
    height: boxHeight
  }
}

function drawBoxShape(
  page: PDFPage,
  shape: DrawingShape,
  box: DrawingBox,
  palette: BoardPalette,
  width: number,
  height: number
): void {
  const bounds = boxOnPage(box, width, height)
  if (bounds === null) return
  const border = {
    borderColor: palette.marks[shape.style.color],
    borderWidth: Math.max(shape.style.width * width, 0.25),
    borderOpacity: clamp(shape.style.opacity, 0, 1)
  }
  if (shape.kind === 'rect') {
    page.drawRectangle({ ...bounds, ...border })
  } else {
    page.drawEllipse({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      xScale: bounds.width / 2,
      yScale: bounds.height / 2,
      ...border
    })
  }
}

function linePoints(shape: DrawingShape): [DrawingPoint, DrawingPoint] | null {
  const points = shape.data.points
  if (points !== undefined && points.length >= 2) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first !== undefined && last !== undefined) return [first, last]
  }
  const box = shape.data.box
  if (box === undefined) return null
  return [
    { x: box.x, y: box.y, p: 0.5 },
    { x: box.x + box.width, y: box.y + box.height, p: 0.5 }
  ]
}

function drawStraightLine(
  page: PDFPage,
  shape: DrawingShape,
  palette: BoardPalette,
  width: number,
  height: number
): void {
  const points = linePoints(shape)
  if (points === null) return
  const start = pdfPoint(points[0], width, height)
  const end = pdfPoint(points[1], width, height)
  const thickness = Math.max(shape.style.width * width, 0.25)
  const options = {
    thickness,
    color: palette.marks[shape.style.color],
    opacity: clamp(shape.style.opacity, 0, 1),
    lineCap: LineCapStyle.Round
  }
  page.drawLine({ start, end, ...options })
  if (shape.kind !== 'arrow') return

  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const headLength = Math.max(thickness * 4, width * 0.012)
  for (const offset of [-Math.PI / 6, Math.PI / 6]) {
    page.drawLine({
      start: end,
      end: {
        x: end.x - Math.cos(angle + offset) * headLength,
        y: end.y - Math.sin(angle + offset) * headLength
      },
      ...options
    })
  }
}

function wrapLine(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  if (text.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const character of text) {
    const candidate = current + character
    if (current.length > 0 && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current)
      current = character
    } else {
      current = candidate
    }
  }
  lines.push(current)
  return lines
}

function drawTextbox(
  page: PDFPage,
  shape: DrawingShape,
  box: DrawingBox,
  font: TextboxFont,
  palette: BoardPalette,
  width: number,
  height: number
): void {
  const bounds = boxOnPage(box, width, height)
  if (bounds === null) return
  const fontSize = Math.min(
    72,
    Math.max(6, width * 0.026 * (shape.style.fontScale ?? 1))
  )
  const lineHeight = fontSize * 1.25
  const maxWidth = Math.max(bounds.width, fontSize)
  const lines = (shape.data.text ?? '')
    .split(/\r?\n/u)
    .flatMap((line) => wrapLine(font.embedded, line, fontSize, maxWidth))
  const top = bounds.y + bounds.height
  for (let index = 0; index < lines.length; index += 1) {
    const y = top - fontSize - index * lineHeight
    if (y < bounds.y) break
    const line = lines[index] ?? ''
    const color = palette.marks[shape.style.color]
    const opacity = clamp(shape.style.opacity, 0, 1)
    // Keep a real subset-font text object for search/copy and its ToUnicode
    // map. Noto Sans KR is CFF-flavoured; some PDF engines mis-render its
    // subset charstrings, so the visible layer uses outlines from that exact
    // same font instead of ever falling back to '?' glyphs.
    page.drawText(line, {
      x: bounds.x,
      y,
      size: fontSize,
      font: font.embedded,
      color,
      opacity: 0,
      maxWidth
    })
    const run = font.outlines.layout(line)
    const scale = fontSize / font.outlines.unitsPerEm
    let penX = bounds.x
    let penY = y
    for (let glyphIndex = 0; glyphIndex < run.glyphs.length; glyphIndex += 1) {
      const glyph = run.glyphs[glyphIndex]
      const position = run.positions[glyphIndex]
      if (glyph === undefined || position === undefined) continue
      const path = glyph.path as ScalableFontkitPath
      const svgPath = path.scale(1, -1).toSVG()
      if (svgPath.length > 0) {
        page.drawSvgPath(svgPath, {
          x: penX + position.xOffset * scale,
          y: penY + position.yOffset * scale,
          scale,
          color,
          opacity
        })
      }
      penX += position.xAdvance * scale
      penY += position.yAdvance * scale
    }
  }
}

function resolveDefaultFontPath(): string {
  // Keep Electron out of plain-Node tests until this default is actually used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron')
  return app.isPackaged
    ? join(process.resourcesPath, 'fonts', TEXTBOX_FONT_FILE)
    : join(app.getAppPath(), 'resources', 'fonts', TEXTBOX_FONT_FILE)
}

function safeFileStem(title: string): string {
  const stem = title
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim()
  return stem.length === 0 ? '화이트보드' : stem
}

function candidateFileName(stem: string, number: number): string {
  return number === 1 ? `${stem}.pdf` : `${stem} (${number}).pdf`
}

function isOccupiedTargetError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error.code === 'EEXIST' || error.code === 'EISDIR')
}

export interface BoardPdfExporterDeps {
  openBoard: (boardId: string) => OpenPersonalBoardResult
  getCourseFolder: (courseId: string) => string
  resolveFontPath?: () => string
}

export interface BoardPdfExporter {
  exportBoard(boardId: string): Promise<{ relPath: string }>
}

export function createBoardPdfExporter(deps: BoardPdfExporterDeps): BoardPdfExporter {
  let fontBytesPromise: Promise<Uint8Array> | null = null

  function loadFontBytes(): Promise<Uint8Array> {
    fontBytesPromise ??= Promise.resolve().then(() =>
      readFile((deps.resolveFontPath ?? resolveDefaultFontPath)())
    )
    return fontBytesPromise
  }

  return {
    async exportBoard(boardIdInput) {
      const boardId = requireId(boardIdInput, 'boardId')
      const { board, shapes } = deps.openBoard(boardId)
      const courseFolder = deps.getCourseFolder(board.courseId)
      try {
        if (!(await stat(courseFolder)).isDirectory()) {
          throw new NotFoundError('course folder', courseFolder)
        }
      } catch (error) {
        if (error instanceof NotFoundError) throw error
        throw new NotFoundError('course folder', courseFolder)
      }

      const pdf = await PDFDocument.create()
      pdf.setTitle(board.title)
      pdf.setCreator('Bandal')
      const palette = BOARD_PALETTES[board.surface]

      const hasTextbox = shapes.some((shape) => shape.kind === 'textbox')
      let font: TextboxFont | null = null
      if (hasTextbox) {
        const fontBytes = await loadFontBytes()
        pdf.registerFontkit(fontkit)
        // Deliberately no Helvetica fallback: exporting readable Korean or
        // failing loudly is safer than silently replacing a student's text.
        font = {
          embedded: await pdf.embedFont(fontBytes, { subset: true }),
          outlines: fontkit.create(fontBytes)
        }
      }

      let skippedClips = 0
      for (let pageNumber = 1; pageNumber <= board.pageCount; pageNumber += 1) {
        const page = pdf.addPage(PageSizes.A4)
        const { width, height } = page.getSize()
        drawBackground(page, board.background, palette, width, height)

        for (const shape of shapes) {
          if (shape.page !== pageNumber) continue
          if (shape.kind === 'clip') {
            skippedClips += 1
          } else if (shape.kind === 'ink' || shape.kind === 'highlighter') {
            drawInk(page, shape, palette, board.surface, width, height)
          } else if (shape.kind === 'rect' || shape.kind === 'ellipse') {
            if (shape.data.box !== undefined) {
              drawBoxShape(page, shape, shape.data.box, palette, width, height)
            }
          } else if (shape.kind === 'line' || shape.kind === 'arrow') {
            drawStraightLine(page, shape, palette, width, height)
          } else if (font !== null && shape.data.box !== undefined) {
            drawTextbox(page, shape, shape.data.box, font, palette, width, height)
          }
        }
      }

      const bytes = await pdf.save()
      const stem = safeFileStem(board.title)
      for (let number = 1; number <= 1000; number += 1) {
        const relPath = candidateFileName(stem, number)
        try {
          await writeFile(join(courseFolder, relPath), bytes, { flag: 'wx' })
          console.info(
            `[canvas] exported board PDF: ${relPath}; skipped clips: ${skippedClips}`
          )
          return { relPath }
        } catch (error) {
          if (!isOccupiedTargetError(error)) throw error
        }
      }
      throw new ValidationError(`could not find a free name for "${stem}.pdf"`)
    }
  }
}
