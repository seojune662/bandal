import { useEffect, useState } from 'react'
import type { Drawing } from '../../../../../shared/types/drawing'
import type { Annotation } from '../../../../../shared/types/annotation'
import { invoke, onPush } from '../../../lib/ipc'
import { loadPdfPreviewThumbnail, type MediaThumbnail } from './mediaThumbnails'
import { BoardShape } from './WhiteboardPreviewContent'
import { runThumbnailTask } from './thumbnailQueue'
import { PreviewMessage } from './PreviewMessage'

/** The paper thumbnail and editable objects always describe the same PDF revision. */
export function PdfNotePreviewContent({ courseId, relPath }: { courseId: string; relPath: string }): JSX.Element {
  const [preview, setPreview] = useState<{ paper: MediaThumbnail; surface: string; drawings: Drawing[]; annotations: Annotation[] } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true, sequence = 0
    let controller: AbortController | null = null
    let pendingRefresh: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      const current = ++sequence
      controller?.abort()
      const requestController = new AbortController()
      controller = requestController
      const timeout = setTimeout(() => requestController.abort(new Error('Preview timeout')), 10000)
      setPreview(null)
      setError(false)
      try {
        const snapshot = await runThumbnailTask(requestController.signal, () => invoke('pdf:previewSnapshot', { courseId, relPath }))
        requestController.signal.throwIfAborted()
        const paper = await loadPdfPreviewThumbnail(courseId, relPath, snapshot, requestController.signal)
        if (active && sequence === current) setPreview({ paper, surface: paper.surface ?? 'light', drawings: snapshot.drawings, annotations: snapshot.annotations })
      } catch { if (active && sequence === current) setError(true) }
      finally { clearTimeout(timeout) }
    }
    const schedule = (): void => {
      clearTimeout(pendingRefresh)
      pendingRefresh = setTimeout(() => { void refresh() }, 100)
    }
    const offMarkup = onPush('pdf:markupChanged', event => {
      if (event.courseId === courseId && event.relPath === relPath) schedule()
    })
    // Imports, sync and original replacements still use the course watcher.
    // The paper cache remains keyed by revision, so unchanged PDFs are not decoded again.
    const offMaterials = onPush('materials:changed', event => { if (event.courseId === courseId) schedule() })
    void refresh()
    return () => { active = false; clearTimeout(pendingRefresh); controller?.abort(); offMarkup(); offMaterials() }
  }, [courseId, relPath])
  if (!preview) return <PreviewMessage>{error ? '미리보기를 불러올 수 없어요' : '미리보기 불러오는 중…'}</PreviewMessage>
  let references = 0
  return <>
    <div className="material-preview-content__board material-preview-content__pdf-note" data-surface={preview.surface} style={{ aspectRatio: `1 / ${preview.paper.aspect ?? Math.SQRT2}` }}>
      <img src={preview.paper.dataUrl} alt="PDF 첫 페이지" draggable={false} />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" role="img" aria-label="저장된 필기">
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
