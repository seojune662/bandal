import type { WebContents } from 'electron'
import type { AnnotationBounds } from '../../../shared/types/chatAnnotation'

export function boundedCaptureRect(rect: AnnotationBounds, viewport: { width: number; height: number }, scale = 1): AnnotationBounds {
  if (![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height, scale].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || scale <= 0) throw new Error('선택 영역을 확인할 수 없어요. 다시 선택해 주세요.')
  const x = Math.max(0, Math.floor(rect.x * scale)), y = Math.max(0, Math.floor(rect.y * scale))
  const right = Math.min(Math.floor(viewport.width * scale), Math.ceil((rect.x + rect.width) * scale))
  const bottom = Math.min(Math.floor(viewport.height * scale), Math.ceil((rect.y + rect.height) * scale))
  if (right <= x || bottom <= y) throw new Error('선택 영역이 화면 밖에 있어요.')
  return { x, y, width: right - x, height: bottom - y }
}

/** Captures only the internal WebContents; no desktop/screen permission or frozen preview. */
export async function captureAnnotationImage(contents: WebContents, rect: AnnotationBounds): Promise<string> {
  const image = await contents.capturePage(rect)
  if (image.isEmpty()) throw new Error('선택한 부분을 캡처하지 못했어요. 다시 선택해 주세요.')
  const size = image.getSize(), factor = Math.min(1, 1200 / Math.max(size.width, size.height))
  const snapshot = factor < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)) }) : image
  return `data:image/jpeg;base64,${snapshot.toJPEG(85).toString('base64')}`
}
