import { useEffect, useState } from 'react'
import type { DrawingColor } from '../../../../../shared/types/drawing'
import { invoke } from '../../../lib/ipc'
import { PdfToolIcon } from './pdfToolIcons'
import type { DrawingsApi } from './useDrawings'
import { usePdfToolStore, type PdfDrawingTool } from './toolStore'
import './pdfTools.css'

interface PdfToolRailProps {
  courseId: string
  relPath: string
  drawingsApi: DrawingsApi
}

interface ToolButton {
  tool: PdfDrawingTool
  label: string
  shortcut?: string
  icon: JSX.Element
}

const TOOLS: readonly ToolButton[] = [
  { tool: 'select', label: '선택', shortcut: 'V', icon: <PdfToolIcon name="select" /> },
  { tool: 'pen', label: '펜', shortcut: 'P', icon: <PdfToolIcon name="pen" /> },
  {
    tool: 'highlighter',
    label: '형광펜',
    shortcut: 'H',
    icon: <PdfToolIcon name="highlighter" />
  },
  { tool: 'eraser', label: '지우개', shortcut: 'E', icon: <PdfToolIcon name="eraser" /> },
  { tool: 'text', label: '텍스트', shortcut: 'T', icon: <PdfToolIcon name="text" /> },
  { tool: 'rect', label: '사각형', shortcut: 'R', icon: <PdfToolIcon name="rect" /> },
  { tool: 'ellipse', label: '타원', shortcut: 'O', icon: <PdfToolIcon name="ellipse" /> },
  { tool: 'arrow', label: '화살표', icon: <PdfToolIcon name="arrow" /> },
  { tool: 'line', label: '직선', icon: <PdfToolIcon name="line" /> }
]

const COLORS: readonly DrawingColor[] = [
  'ink',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet'
]

const COLOR_LABELS: Record<DrawingColor, string> = {
  ink: '먹색',
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  violet: '보라'
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

export function PdfToolRail({
  courseId,
  relPath,
  drawingsApi
}: PdfToolRailProps): JSX.Element {
  const activeTool = usePdfToolStore((state) => state.activeTool)
  const color = usePdfToolStore((state) => state.color)
  const width = usePdfToolStore((state) => state.width)
  const opacity = usePdfToolStore((state) => state.opacity)
  const setActiveTool = usePdfToolStore((state) => state.setActiveTool)
  const setColor = usePdfToolStore((state) => state.setColor)
  const setWidth = usePdfToolStore((state) => state.setWidth)
  const setOpacity = usePdfToolStore((state) => state.setOpacity)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) void drawingsApi.redo()
        else void drawingsApi.undo()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const tool = TOOLS.find((entry) => entry.shortcut?.toLowerCase() === event.key.toLowerCase())
      if (tool !== undefined) {
        event.preventDefault()
        setActiveTool(tool.tool)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drawingsApi, setActiveTool])

  const exportPdf = async (): Promise<void> => {
    if (exporting) return
    setExporting(true)
    setExportMessage(null)
    try {
      const result = await invoke('pdf:exportAnnotated', { courseId, relPath })
      setExportMessage(result.savedPath === null ? null : '주석 포함 PDF를 저장했어요.')
    } catch (error: unknown) {
      setExportMessage(error instanceof Error ? error.message : 'PDF 내보내기에 실패했어요.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="pdf-tool-rail" role="group" aria-label="자유 필기 도구">
      <div className="pdf-tool-rail__group pdf-tool-rail__tools">
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            className="pdf-tool-rail__button"
            data-active={activeTool === entry.tool ? 'true' : 'false'}
            aria-pressed={activeTool === entry.tool}
            aria-label={entry.label}
            title={`${entry.label}${entry.shortcut === undefined ? '' : ` (${entry.shortcut})`}`}
            onClick={() => setActiveTool(entry.tool)}
          >
            {entry.icon}
          </button>
        ))}
      </div>

      <div
        className="pdf-tool-rail__group pdf-tool-rail__palette"
        role="group"
        aria-label="필기 색상"
      >
        {COLORS.map((entry) => (
          <button
            key={entry}
            type="button"
            className="pdf-tool-rail__swatch"
            data-color={entry}
            data-selected={color === entry ? 'true' : 'false'}
            aria-label={COLOR_LABELS[entry]}
            aria-pressed={color === entry}
            title={COLOR_LABELS[entry]}
            onClick={() => setColor(entry)}
          />
        ))}
      </div>

      <div className="pdf-tool-rail__group pdf-tool-rail__settings">
        <label className="pdf-tool-rail__range" title="선 굵기">
          <PdfToolIcon name="lineWidth" />
          <input
            type="range"
            min="0.001"
            max="0.025"
            step="0.001"
            value={width}
            aria-label="선 굵기"
            onChange={(event) => setWidth(Number(event.target.value))}
          />
        </label>
        <label className="pdf-tool-rail__range" title="불투명도">
          <PdfToolIcon name="opacity" />
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={opacity}
            aria-label="불투명도"
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="pdf-tool-rail__group pdf-tool-rail__history">
        <button
          type="button"
          className="pdf-tool-rail__button"
          aria-label="되돌리기"
          title="되돌리기 (⌘Z)"
          disabled={!drawingsApi.canUndo || drawingsApi.historyBusy}
          onClick={() => void drawingsApi.undo()}
        >
          <PdfToolIcon name="undo" />
        </button>
        <button
          type="button"
          className="pdf-tool-rail__button"
          aria-label="다시 실행"
          title="다시 실행 (⇧⌘Z)"
          disabled={!drawingsApi.canRedo || drawingsApi.historyBusy}
          onClick={() => void drawingsApi.redo()}
        >
          <PdfToolIcon name="redo" />
        </button>
      </div>

      <div className="pdf-tool-rail__group pdf-tool-rail__export-group">
        <button
          type="button"
          className="pdf-tool-rail__button pdf-tool-rail__export"
          aria-label={exporting ? '주석 포함 PDF 내보내는 중' : '주석 포함 PDF 내보내기'}
          title={exporting ? '주석 포함 PDF 내보내는 중' : '주석 포함 PDF 내보내기'}
          disabled={exporting}
          onClick={() => void exportPdf()}
        >
          <PdfToolIcon name="export" />
        </button>

        {(drawingsApi.error ?? exportMessage) !== null && (
          <span
            className="pdf-tool-rail__status"
            role="status"
            title={drawingsApi.error ?? exportMessage ?? undefined}
          >
            {drawingsApi.error ?? exportMessage}
          </span>
        )}
      </div>
    </div>
  )
}
