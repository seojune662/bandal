import type { DrawingImageSource } from '../../../../shared/types/drawing'
import {
  BANDAL_IMAGE_MIME,
  writeBandalImageDragData
} from '../ink/imageTransfer'

export { BANDAL_IMAGE_MIME }

interface MaterialImageDragDataWriter {
  effectAllowed: string
  setData: (format: string, data: string) => void
}

/** Writes the ink/PDF image contract plus a useful system drag fallback. */
export function writeMaterialImageDragData(
  dataTransfer: MaterialImageDragDataWriter,
  source: DrawingImageSource
): void {
  writeBandalImageDragData(dataTransfer, source)
  // PDF/ink request a copy, while Chromium or a parent drag owner may request
  // move. Advertising both keeps the native HTML5 DnD negotiation valid.
  dataTransfer.effectAllowed = 'copyMove'
  dataTransfer.setData('text/plain', source.label)
}
