import type {
  DrawingBox,
  DrawingClipSource
} from '../../../../shared/types/drawing'

export const BANDAL_CLIP_MIME = 'application/x-bandal-clip'

interface DragDataWriter {
  effectAllowed: string
  setData: (format: string, data: string) => void
}

interface DragDataReader {
  getData: (format: string) => string
}

function finiteUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isCrop(value: unknown): value is DrawingBox {
  if (typeof value !== 'object' || value === null) return false
  const crop = value as Record<string, unknown>
  if (
    !finiteUnit(crop['x']) ||
    !finiteUnit(crop['y']) ||
    !finiteUnit(crop['width']) ||
    !finiteUnit(crop['height']) ||
    crop['width'] <= 0 ||
    crop['height'] <= 0
  ) {
    return false
  }
  return crop['x'] + crop['width'] <= 1 && crop['y'] + crop['height'] <= 1
}

export function isDrawingClipSource(value: unknown): value is DrawingClipSource {
  if (typeof value !== 'object' || value === null) return false
  const source = value as Record<string, unknown>
  return (
    (source['documentRevision']===undefined||typeof source['documentRevision']==='string'&&/^[a-f0-9]{64}$/.test(source['documentRevision'])) &&
    (source['documentByteCount']===undefined||Number.isSafeInteger(source['documentByteCount'])&&(source['documentByteCount'] as number)>0) &&
    (source['materialID']===undefined||typeof source['materialID']==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(source['materialID'])) &&
    typeof source['relPath'] === 'string' &&
    source['relPath'].length > 0 &&
    Number.isInteger(source['page']) &&
    (source['page'] as number) > 0 &&
    typeof source['label'] === 'string' &&
    source['label'].length > 0 &&
    (source['crop'] === undefined || isCrop(source['crop'])) &&
    (source['pageAspect'] === undefined ||
      (typeof source['pageAspect'] === 'number' &&
        Number.isFinite(source['pageAspect']) &&
        source['pageAspect'] > 0))
  )
}

export function writeBandalClipDragData(
  dataTransfer: DragDataWriter,
  source: DrawingClipSource
): void {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(BANDAL_CLIP_MIME, JSON.stringify({
    relPath: source.relPath,
    ...(source.documentRevision===undefined?{}:{documentRevision:source.documentRevision}),
    ...(source.documentByteCount===undefined?{}:{documentByteCount:source.documentByteCount}),
    ...(source.materialID===undefined?{}:{materialID:source.materialID}),
    page: source.page,
    ...(source.crop === undefined ? {} : { crop: source.crop }),
    ...(source.pageAspect === undefined
      ? {}
      : { pageAspect: source.pageAspect }),
    label: source.label
  }))
}

export function readBandalClipDragData(
  dataTransfer: DragDataReader
): DrawingClipSource | null {
  const raw = dataTransfer.getData(BANDAL_CLIP_MIME)
  if (raw.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isDrawingClipSource(parsed)) return null
    return {
      relPath: parsed.relPath,
      ...(parsed.documentRevision===undefined?{}:{documentRevision:parsed.documentRevision}),
      ...(parsed.documentByteCount===undefined?{}:{documentByteCount:parsed.documentByteCount}),
      ...(parsed.materialID===undefined?{}:{materialID:parsed.materialID}),
      page: parsed.page,
      ...(parsed.crop === undefined ? {} : {
        crop: {
          x: parsed.crop.x,
          y: parsed.crop.y,
          width: parsed.crop.width,
          height: parsed.crop.height
        }
      }),
      ...(parsed.pageAspect === undefined
        ? {}
        : { pageAspect: parsed.pageAspect }),
      label: parsed.label
    }
  } catch {
    return null
  }
}

export function pdfClipLabel(
  relPath: string,
  page: number,
  cropped: boolean
): string {
  const segments = relPath.split('/')
  const fileName = segments[segments.length - 1] || relPath
  return `${fileName} · ${page}쪽${cropped ? ' 선택 영역' : ''}`
}
