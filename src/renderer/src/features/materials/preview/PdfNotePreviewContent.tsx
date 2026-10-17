import { useEffect, useState } from 'react'
import type { Drawing } from '../../../../../shared/types/drawing'
import type { Annotation } from '../../../../../shared/types/annotation'
import { invoke, onPush } from '../../../lib/ipc'
import { loadPdfThumbnail, type MediaThumbnail } from './mediaThumbnails'
import { BoardShape } from './WhiteboardPreviewContent'

/** The paper thumbnail and editable objects always describe the same PDF revision. */
export function PdfNotePreviewContent({ courseId, relPath }: { courseId: string; relPath: string }): JSX.Element {
  const [preview, setPreview] = useState<{ paper: MediaThumbnail; surface: string; drawings: Drawing[]; annotations: Annotation[] } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true, sequence = 0
    const controller = new AbortController()
    const refresh = async () => {
      const current = ++sequence
      try {
        const info = await invoke('pdfNotes:info', { courseId, relPath })
        const request = { courseId, relPath, documentRevision: info.documentRevision }
        const [paper, drawings, annotations] = await Promise.all([
          loadPdfThumbnail(courseId, relPath, info.documentRevision, controller.signal, 1, undefined, info.documentRevision),
          invoke('drawings:listForFile', request), invoke('annotations:listForFile', request)
        ])
        if (active && sequence === current) { setError(false); setPreview({ paper, surface: info.surface, drawings: drawings.filter(row => row.page === 1).slice(-160), annotations: annotations.filter(row => row.page === 1).slice(-160) }) }
      } catch { if (active && sequence === current) setError(true) }
    }
    void refresh()
    const off = onPush('materials:changed', event => { if (event.courseId === courseId) void refresh() })
    return () => { active = false; controller.abort(); off() }
  }, [courseId, relPath])
  if (!preview) return <p className="material-preview-content__message">{error ? '미리보기를 불러올 수 없어요' : '미리보기 불러오는 중…'}</p>
  let references = 0
  return <>
    <div className="material-preview-content__board material-preview-content__pdf-note" data-surface={preview.surface} style={{ aspectRatio: `1 / ${preview.paper.aspect ?? Math.SQRT2}` }}>
      <img src={preview.paper.dataUrl} alt="노트 종이" draggable={false} />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" role="img" aria-label="노트 첫 페이지">
        {preview.annotations.flatMap(annotation => annotation.rects.map((rect, index) => <rect key={`${annotation.id}:${index}`} {...rect} className="is-highlighter" opacity={.3} fill={annotation.color === 'pink' ? '#ef82b1' : `var(--drawing-color-${annotation.color})`} />))}
        {preview.drawings.map(shape => {
          if (shape.kind === 'clip' || shape.kind === 'image') references++
          return <BoardShape key={shape.id} courseId={courseId} shape={shape} aspect={preview.paper.aspect ?? Math.SQRT2} loadReference={references <= 6} />
        })}
      </svg>
    </div>
    <span className="material-preview-content__caption">1 / {preview.paper.pageCount ?? 1}쪽</span>
  </>
}
