/** Small, read-only content used by the materials rail's delayed hover card. */
export interface MaterialHoverPreviewRequest {
  courseId: string
  relPath: string
}

export type MaterialHoverPreviewContent =
  | { kind: 'markdown' | 'text'; text: string; truncated: boolean; label?: string }
  | { kind: 'table'; rows: string[][]; sheetName: string; sheetCount: number; truncated: boolean }
  | { kind: 'slides'; text: string; slideCount: number; truncated: boolean; imageDataUrl?: string }
  | { kind: 'pdf' | 'image' | 'video' | 'recording' }
  | {
      kind: 'unsupported'
      reason: 'unsupported' | 'too-large' | 'unreadable' | 'needs-conversion' | 'timeout'
      message: string
    }

export interface MaterialHoverPreview {
  name: string
  relPath: string
  size: number
  mtime: number
  content: MaterialHoverPreviewContent
}
