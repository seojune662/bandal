import { useRef, useState } from 'react'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { flushOpenNoteSession } from '../notes/noteSessionRegistry'
import './materialExport.css'

interface MaterialRef { courseId: string; relPath: string }

export async function exportMaterialFile(ref: MaterialRef): Promise<{ savedPath: string | null }> {
  let currentRef = ref
  if (/\.(?:md|markdown)$/iu.test(ref.relPath)) {
    const flushed = await flushOpenNoteSession(ref)
    if (flushed !== null) {
      if (flushed.result.status !== 'saved') {
        throw new Error('필기를 저장하지 못했어요. 저장 상태를 확인한 뒤 다시 내보내 주세요.')
      }
      currentRef = flushed.ref
    }
  }
  return invoke('materials:export', currentRef)
}

interface MaterialExportButtonProps {
  courseId?: string
  relPath?: string
  disabled?: boolean
  title?: string
  onExport?: () => Promise<{ savedPath: string | null }>
}

/** Shared action in each material's existing toolbar. Keeps export discoverable
 * even when formatting/drawing tools are collapsed. */
export function MaterialExportButton({ courseId, relPath, disabled = false,
  title = '공유 · 파일 내보내기', onExport }: MaterialExportButtonProps): JSX.Element {
  const [exporting, setExporting] = useState(false)
  const busy = useRef(false)
  const exportFile = async (): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setExporting(true)
    try {
      // Ink text boxes commit on blur, including the final unrendered keystroke.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      const result = onExport ? await onExport() : await exportMaterialFile({ courseId: courseId!, relPath: relPath! })
      if (result.savedPath !== null) showToast('내보낸 파일을 저장했어요.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '파일을 내보내지 못했어요.', 'danger')
    } finally {
      busy.current = false
      setExporting(false)
    }
  }
  return <button type="button" className="material-export-button" aria-label="내보내기"
    aria-busy={exporting} title={title} disabled={disabled || exporting}
    onClick={() => void exportFile()}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3m-4 4 4-4 4 4M6 11H4v10h16V11h-2" />
    </svg><span className="material-export-button__label">{exporting ? '저장 중' : '공유'}</span>
  </button>
}
