/** Burn stored annotations and drawings into a new PDF without touching the source. */

import { randomUUID } from 'node:crypto'
import { readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  StandardFonts,
  rgb,
  type Color,
  type PDFFont,
  type PDFPage
} from 'pdf-lib'
import type { Annotation, HighlightColor } from '../../../shared/types/annotation'
import type {
  Drawing,
  DrawingBox,
  DrawingColor,
  DrawingPoint,
  ExportAnnotatedPdfInput
} from '../../../shared/types/drawing'
import { ValidationError } from '../../db/errors'
import { requireId, requireNonEmptyString, resolveInside } from '../../db/validate'

const DRAWING_COLORS: Record<DrawingColor, Color> = {
  ink: rgb(0.08, 0.09, 0.12),
  red: rgb(0.84, 0.14, 0.18),
  orange: rgb(0.94, 0.39, 0.08),
  yellow: rgb(0.96, 0.72, 0.04),
  green: rgb(0.1, 0.58, 0.3),
  blue: rgb(0.08, 0.38, 0.88),
  violet: rgb(0.49, 0.21, 0.82)
}

const HIGHLIGHT_COLORS: Record<HighlightColor, Color> = {
  yellow: rgb(0.98, 0.83, 0.18),
  green: rgb(0.3, 0.78, 0.4),
  pink: rgb(0.94, 0.38, 0.6),
  blue: rgb(0.3, 0.62, 0.94)
}

function pdfPoint(point: DrawingPoint, width: number, height: number): { x: number; y: number } {
  return { x: point.x * width, y: (1 - point.y) * height }
}

function linePoints(drawing: Drawing): [DrawingPoint, DrawingPoint] | null {
  const points = drawing.data.points
  if (points !== undefined && points.length >= 2) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first !== undefined && last !== undefined) return [first, last]
  }
  const box = drawing.data.box
  if (box === undefined) return null
  return [
    { x: box.x, y: box.y, p: 0.5 },
    { x: box.x + box.width, y: box.y + box.height, p: 0.5 }
  ]
}

function drawInk(page: PDFPage, drawing: Drawing, width: number, height: number): void {
  const points = drawing.data.points ?? []
  if (points.length === 0) return
  const color = DRAWING_COLORS[drawing.style.color]
  const baseThickness = drawing.style.width * width
  const opacity = drawing.kind === 'highlighter'
    ? Math.min(drawing.style.opacity, 0.38)
    : drawing.style.opacity
  const blendMode = drawing.kind === 'highlighter' ? BlendMode.Multiply : BlendMode.Normal
  const first = points[0]
  if (points.length === 1 && first !== undefined) {
    const point = pdfPoint(first, width, height)
    page.drawCircle({
      ...point,
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
    const pressure = drawing.kind === 'highlighter'
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

function drawBoxShape(page: PDFPage, drawing: Drawing, box: DrawingBox, width: number, height: number): void {
  const color = DRAWING_COLORS[drawing.style.color]
  const borderWidth = Math.max(drawing.style.width * width, 0.25)
  const x = box.x * width
  const boxWidth = box.width * width
  const boxHeight = box.height * height
  const y = height - (box.y + box.height) * height
  if (drawing.kind === 'rect') {
    page.drawRectangle({
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      borderColor: color,
      borderWidth,
      borderOpacity: drawing.style.opacity
    })
  } else {
    page.drawEllipse({
      x: x + boxWidth / 2,
      y: y + boxHeight / 2,
      xScale: boxWidth / 2,
      yScale: boxHeight / 2,
      borderColor: color,
      borderWidth,
      borderOpacity: drawing.style.opacity
    })
  }
}

function drawStraightLine(page: PDFPage, drawing: Drawing, width: number, height: number): void {
  const points = linePoints(drawing)
  if (points === null) return
  const start = pdfPoint(points[0], width, height)
  const end = pdfPoint(points[1], width, height)
  const thickness = Math.max(drawing.style.width * width, 0.25)
  const options = {
    thickness,
    color: DRAWING_COLORS[drawing.style.color],
    opacity: drawing.style.opacity,
    lineCap: LineCapStyle.Round
  }
  page.drawLine({ start, end, ...options })
  if (drawing.kind !== 'arrow') return

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

function winAnsiText(font: PDFFont, text: string): string {
  return [...text].map((character) => {
    if (character === '\n' || character === '\r' || character === '\t') return character
    try {
      font.encodeText(character)
      return character
    } catch {
      return '?'
    }
  }).join('')
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
  drawing: Drawing,
  box: DrawingBox,
  font: PDFFont,
  width: number,
  height: number
): void {
  const fontSize = Math.min(72, Math.max(6, width * 0.026 * (drawing.style.fontScale ?? 1)))
  const lineHeight = fontSize * 1.25
  const maxWidth = Math.max(box.width * width, fontSize)
  const text = winAnsiText(font, drawing.data.text ?? '')
  const lines = text.split(/\r?\n/u).flatMap((line) => wrapLine(font, line, fontSize, maxWidth))
  const x = box.x * width
  const top = height - box.y * height
  const bottom = height - (box.y + box.height) * height
  for (let index = 0; index < lines.length; index += 1) {
    const y = top - fontSize - index * lineHeight
    if (y < bottom) break
    page.drawText(lines[index] ?? '', {
      x,
      y,
      size: fontSize,
      font,
      color: DRAWING_COLORS[drawing.style.color],
      opacity: drawing.style.opacity,
      maxWidth
    })
  }
}

function drawAnnotation(page: PDFPage, annotation: Annotation, width: number, height: number): void {
  for (const rect of annotation.rects) {
    page.drawRectangle({
      x: rect.x * width,
      y: height - (rect.y + rect.height) * height,
      width: rect.width * width,
      height: rect.height * height,
      color: HIGHLIGHT_COLORS[annotation.color],
      opacity: 0.42,
      blendMode: BlendMode.Multiply
    })
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return join(await realpath(dirname(path)), basename(path))
  }
}

export function createPdfExporter(deps: {
  getCourseFolder: (courseId: string) => string
  listDrawings: (courseId: string, relPath: string) => Drawing[]
  listAnnotations: (courseId: string, relPath: string) => Annotation[]
}): {
  exportAnnotated(input: ExportAnnotatedPdfInput, savePath: string): Promise<void>
} {
  return {
    async exportAnnotated(input, savePathInput) {
      const courseId = requireId(input.courseId, 'courseId')
      const relPath = requireNonEmptyString(input.relPath, 'relPath')
      const savePath = requireNonEmptyString(savePathInput, 'savePath')
      if (!isAbsolute(savePath)) throw new ValidationError('savePath must be absolute')

      const sourcePath = resolveInside(deps.getCourseFolder(courseId), relPath)
      const [canonicalSource, canonicalSave] = await Promise.all([
        canonicalPath(sourcePath),
        canonicalPath(resolve(savePath))
      ])
      if (canonicalSource === canonicalSave) {
        throw new ValidationError('annotated PDF must be saved to a new file')
      }

      const pdf = await PDFDocument.load(await readFile(sourcePath))
      const pages = pdf.getPages()
      const annotations = deps.listAnnotations(courseId, relPath)
      const drawings = deps.listDrawings(courseId, relPath)
      const font = drawings.some((drawing) => drawing.kind === 'textbox')
        ? await pdf.embedFont(StandardFonts.Helvetica)
        : null

      for (const annotation of annotations) {
        const page = pages[annotation.page - 1]
        if (page === undefined) continue
        const { width, height } = page.getSize()
        drawAnnotation(page, annotation, width, height)
      }
      for (const drawing of drawings) {
        const page = pages[drawing.page - 1]
        if (page === undefined) continue
        const { width, height } = page.getSize()
        if (drawing.kind === 'ink' || drawing.kind === 'highlighter') {
          drawInk(page, drawing, width, height)
        } else if (drawing.kind === 'rect' || drawing.kind === 'ellipse') {
          if (drawing.data.box !== undefined) {
            drawBoxShape(page, drawing, drawing.data.box, width, height)
          }
        } else if (drawing.kind === 'line' || drawing.kind === 'arrow') {
          drawStraightLine(page, drawing, width, height)
        } else if (font !== null && drawing.data.box !== undefined) {
          drawTextbox(page, drawing, drawing.data.box, font, width, height)
        }
      }

      // Write beside the destination then atomically replace it. Besides avoiding
      // partial PDFs, this cannot follow a destination symlink/hardlink back to
      // the source file.
      const temporaryPath = join(
        dirname(savePath),
        `.${basename(savePath)}.${randomUUID()}.tmp`
      )
      try {
        await writeFile(temporaryPath, await pdf.save())
        await rename(temporaryPath, savePath)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
    }
  }
}
