import type { AnnotationBounds, AnnotationMode, AnnotationReference } from '../types/chatAnnotation'

export interface AnnotationIpcContract {
  'annotation:browserStart': { req: { tabId: string; sessionId: string; mode: AnnotationMode; courseId: string; sourcePanelId: string }; res: { epoch: string } }
  'annotation:browserDrain': { req: { tabId: string; sessionId: string }; res: { references: AnnotationReference[]; cancelled: boolean } }
  'annotation:browserStop': { req: { tabId: string; sessionId: string }; res: { ok: true; references: AnnotationReference[] } }
  'annotation:browserReveal': { req: { tabId: string; url: string; selector?: string; quote?: string }; res: { found: boolean } }
  'annotation:captureHost': { req: { rect: AnnotationBounds }; res: { imageDataUrl: string } }
}
export const ANNOTATION_CHANNELS = ['annotation:browserStart', 'annotation:browserDrain', 'annotation:browserStop', 'annotation:browserReveal', 'annotation:captureHost'] as const
