import type { AnnotationReference } from './types/chatAnnotation'
import type { ChatAttachment } from './types/chat'
/** Snapshots are explicit user attachments; preserve ordering and deduplicate identical crops. */
export function referenceImages(references: readonly AnnotationReference[] = []): ChatAttachment[] {
  return [...new Set(references.flatMap(reference => reference.imageDataUrl ? [reference.imageDataUrl] : []))].map(url => {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url)
    if (!match || match[2]!.length > 7 * 1024 * 1024) throw new Error('참조 이미지가 너무 크거나 읽을 수 없어요. 다시 선택해 주세요.')
    return { mediaType: match[1]!, dataBase64: match[2]! }
  })
}
