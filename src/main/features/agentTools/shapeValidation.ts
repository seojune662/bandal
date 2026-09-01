import type {
  DrawingBox,
  DrawingClipSource,
  DrawingColor,
  DrawingData,
  DrawingImageSource,
  DrawingKind,
  DrawingPoint,
  DrawingStyle
} from '../../../shared/types/drawing'
import { DRAWING_KINDS } from '../../../shared/types/drawing'
import type { PutPersonalShapeInput } from '../../../shared/types/whiteboard'
import { ValidationError } from '../../db/errors'

type BoardShapeInput = PutPersonalShapeInput['shape']

const DRAWING_COLORS: readonly DrawingColor[] = [
  'ink',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet'
]

function assertUnit(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new ValidationError(`${field} must be a finite number between 0 and 1`)
  }
  return value
}

function assertPositive(value: unknown, field: string, max = 1): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > max
  ) {
    throw new ValidationError(
      `${field} must be a finite number greater than 0 and at most ${max}`
    )
  }
  return value
}

function assertPoint(value: unknown, field: string): DrawingPoint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be a drawing point`)
  }
  const point = value as Partial<DrawingPoint>
  return {
    x: assertUnit(point.x, `${field}.x`),
    y: assertUnit(point.y, `${field}.y`),
    p: assertUnit(point.p, `${field}.p`)
  }
}

function assertBox(value: unknown, field: string): DrawingBox {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be a drawing box`)
  }
  const box = value as Partial<DrawingBox>
  const result: DrawingBox = {
    x: assertUnit(box.x, `${field}.x`),
    y: assertUnit(box.y, `${field}.y`),
    width: assertUnit(box.width, `${field}.width`),
    height: assertUnit(box.height, `${field}.height`)
  }
  if (result.x + result.width > 1 || result.y + result.height > 1) {
    throw new ValidationError(`${field} must stay inside the normalized page`)
  }
  return result
}

function assertKind(value: unknown): DrawingKind {
  if (!DRAWING_KINDS.includes(value as DrawingKind)) {
    throw new ValidationError(`kind must be one of ${DRAWING_KINDS.join(', ')}`)
  }
  return value as DrawingKind
}

function assertImage(value: unknown): DrawingImageSource {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('data.image must be an object')
  }
  const image = value as Partial<DrawingImageSource>
  if (
    typeof image.relPath !== 'string' ||
    image.relPath.trim() === '' ||
    typeof image.label !== 'string' ||
    image.label.trim() === ''
  ) {
    throw new ValidationError('data.image needs relPath and label')
  }
  return { relPath: image.relPath, label: image.label }
}

function assertClip(value: unknown): DrawingClipSource {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('data.clip must be an object')
  }
  const clip = value as Partial<DrawingClipSource>
  if (
    typeof clip.relPath !== 'string' ||
    clip.relPath.trim() === '' ||
    typeof clip.label !== 'string' ||
    clip.label.trim() === ''
  ) {
    throw new ValidationError('data.clip needs relPath and label')
  }
  if (typeof clip.page !== 'number' || !Number.isInteger(clip.page) || clip.page < 1) {
    throw new ValidationError('data.clip.page must be an integer >= 1')
  }
  const result: DrawingClipSource = {
    relPath: clip.relPath,
    page: clip.page,
    label: clip.label
  }
  if (clip.crop !== undefined) {
    result.crop = assertBox(clip.crop, 'data.clip.crop')
  }
  return result
}

function assertData(value: unknown, kind: DrawingKind): DrawingData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('data must be an object')
  }
  const candidate = value as DrawingData
  let points: DrawingPoint[] | undefined
  if (candidate.points !== undefined) {
    if (!Array.isArray(candidate.points)) {
      throw new ValidationError('data.points must be an array')
    }
    points = candidate.points.map((point, index) =>
      assertPoint(point, `data.points[${index}]`)
    )
  }
  const box = candidate.box === undefined
    ? undefined
    : assertBox(candidate.box, 'data.box')
  const text = candidate.text
  if (text !== undefined && typeof text !== 'string') {
    throw new ValidationError('data.text must be a string')
  }

  if ((kind === 'ink' || kind === 'highlighter') && (points?.length ?? 0) === 0) {
    throw new ValidationError(`${kind} data needs at least one point`)
  }
  if ((kind === 'rect' || kind === 'ellipse' || kind === 'textbox') && box === undefined) {
    throw new ValidationError(`${kind} data needs a box`)
  }
  if (
    (kind === 'line' || kind === 'arrow') &&
    box === undefined &&
    (points?.length ?? 0) < 2
  ) {
    throw new ValidationError(`${kind} data needs a box or two points`)
  }
  if (kind === 'textbox' && text === undefined) {
    throw new ValidationError('textbox data needs text')
  }

  const image = candidate.image === undefined
    ? undefined
    : assertImage(candidate.image)
  if (kind === 'image' && (image === undefined || box === undefined)) {
    throw new ValidationError('image data needs a box and an image source')
  }

  const clip = candidate.clip === undefined
    ? undefined
    : assertClip(candidate.clip)
  if (kind === 'clip' && (clip === undefined || box === undefined)) {
    throw new ValidationError('clip data needs a box and a clip source')
  }

  const result: DrawingData = {}
  if (points !== undefined) result.points = points
  if (box !== undefined) result.box = box
  if (text !== undefined) result.text = text
  if (image !== undefined) result.image = image
  if (clip !== undefined) result.clip = clip
  return result
}

function assertStyle(value: unknown): DrawingStyle {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('style must be an object')
  }
  const style = value as Partial<DrawingStyle>
  if (!DRAWING_COLORS.includes(style.color as DrawingColor)) {
    throw new ValidationError(
      `style.color must be one of ${DRAWING_COLORS.join(', ')}`
    )
  }
  const result: DrawingStyle = {
    color: style.color as DrawingColor,
    width: assertPositive(style.width, 'style.width'),
    opacity: assertUnit(style.opacity, 'style.opacity')
  }
  if (style.fontScale !== undefined) {
    result.fontScale = assertPositive(style.fontScale, 'style.fontScale', 10)
  }
  if (style.bold !== undefined) {
    if (typeof style.bold !== 'boolean') {
      throw new ValidationError('style.bold must be a boolean')
    }
    result.bold = style.bold
  }
  return result
}

/**
 * Whiteboard validation intentionally mirrors the PDF drawing boundary. The
 * canvas repo itself only checks the kind and that data/style are objects.
 */
export function assertAgentBoardShape(value: unknown): BoardShapeInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('shape must be an object')
  }
  const candidate = value as { kind?: unknown; data?: unknown; style?: unknown }
  const kind = assertKind(candidate.kind)
  return {
    kind,
    data: assertData(candidate.data, kind),
    style: assertStyle(candidate.style)
  }
}
