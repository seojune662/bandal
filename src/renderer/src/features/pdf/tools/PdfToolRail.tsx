import { createPortal } from 'react-dom'
import { useDismissableMenu } from '../../../components/useDismissableMenu'
import { useViewportBounds } from '../../../lib/useViewportBounds'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  onExport?: () => Promise<void>
  expanded?: boolean
  interactive?: boolean
}

interface ToolButton {
  tool: PdfDrawingTool
  label: string
  shortcut?: string
  icon: JSX.Element
}

const TOOLS: readonly ToolButton[] = [
  {
    tool: 'select',
    label: '선택',
    shortcut: 'V',
    icon: <PdfToolIcon name="select" />
  },
  { tool: 'pen', label: '펜', shortcut: 'P', icon: <PdfToolIcon name="pen" /> },
  {
    tool: 'highlighter',
    label: '형광펜',
    shortcut: 'H',
    icon: <PdfToolIcon name="highlighter" />
  },
  {
    tool: 'eraser',
    label: '지우개',
    shortcut: 'E',
    icon: <PdfToolIcon name="eraser" />
  },
  {
    tool: 'text',
    label: '텍스트',
    shortcut: 'T',
    icon: <PdfToolIcon name="text" />
  },
  {
    tool: 'rect',
    label: '사각형',
    shortcut: 'R',
    icon: <PdfToolIcon name="rect" />
  },
  {
    tool: 'ellipse',
    label: '타원',
    shortcut: 'O',
    icon: <PdfToolIcon name="ellipse" />
  },
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
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

export function PdfToolRail({
  courseId,
  relPath,
  drawingsApi,
  onExport,
  interactive = true,
  expanded = true
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
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{
    kind: 'tools' | 'style'
    x: number
    y: number
  } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  useDismissableMenu(menu !== null, menuRef, closeMenu)
  useViewportBounds(menuRef)
  useEffect(() => {
    if (!expanded) closeMenu()
  }, [expanded, closeMenu])
  const openMenu = (
    button: HTMLButtonElement,
    kind: 'tools' | 'style'
  ): void => {
    const rect = button.getBoundingClientRect()
    setMenu((current) =>
      current?.kind === kind ? null : { kind, x: rect.left, y: rect.bottom + 6 }
    )
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!interactive || rootRef.current?.closest('.workspace-course[hidden]'))
        return
      if (
        rootRef.current
          ?.closest('.pdf-tab, .presentation-viewer')
          ?.getClientRects().length === 0
      )
        return
      if (
        rootRef.current?.closest('.dv-groupview') &&
        !rootRef.current.closest('.dv-active-group')
      )
        return
      if (isEditableTarget(event.target)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) void drawingsApi.redo()
        else void drawingsApi.undo()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const tool = TOOLS.find(
        (entry) => entry.shortcut?.toLowerCase() === event.key.toLowerCase()
      )
      if (tool !== undefined) {
        event.preventDefault()
        setActiveTool(tool.tool)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [drawingsApi, setActiveTool, interactive])

  const exportPdf = async (): Promise<void> => {
    if (exporting) return
    setExporting(true)
    setExportMessage(null)
    try {
      if (onExport) {
        await onExport()
        return
      }
      const result = await invoke('pdf:exportAnnotated', { courseId, relPath })
      setExportMessage(
        result.savedPath === null ? null : '주석 포함 PDF를 저장했어요.'
      )
    } catch (error: unknown) {
      setExportMessage(
        error instanceof Error ? error.message : 'PDF 내보내기에 실패했어요.'
      )
    } finally {
      setExporting(false)
    }
  }

  const toolButton = (entry: ToolButton, showLabel = false): JSX.Element => (
    <button
      key={entry.tool}
      type="button"
      className="pdf-tool-rail__button"
      data-active={activeTool === entry.tool ? 'true' : 'false'}
      aria-pressed={activeTool === entry.tool}
      aria-label={entry.label}
      title={`${entry.label}${entry.shortcut ? ` (${entry.shortcut})` : ''}`}
      onClick={() => {
        setActiveTool(entry.tool)
        closeMenu()
      }}
    >
      {entry.icon}
      {showLabel && <span>{entry.label}</span>}
    </button>
  )
  return (
    <div ref={rootRef} className="pdf-tool-rail-shell" hidden={!expanded}>
      <div className="pdf-tool-rail" role="group" aria-label="자유 필기 도구">
        <div className="pdf-tool-rail__group pdf-tool-rail__tools">
          {TOOLS.slice(0, 4).map((entry) => toolButton(entry))}
        </div>
        <button
          className="pdf-tool-rail__button"
          aria-label="도형 및 텍스트 도구"
          title="도형 및 텍스트"
          aria-haspopup="dialog"
          aria-expanded={menu?.kind === 'tools'}
          onClick={(event) => openMenu(event.currentTarget, 'tools')}
        >
          <span aria-hidden="true">⋯</span>
        </button>
        <button
          className="pdf-tool-rail__button"
          aria-label="필기 스타일"
          title="색상 · 선 굵기 · 불투명도"
          aria-haspopup="dialog"
          aria-expanded={menu?.kind === 'style'}
          onClick={(event) => openMenu(event.currentTarget, 'style')}
        >
          <span className="pdf-tool-rail__swatch" data-color={color} />
        </button>
        <div className="pdf-tool-rail__group pdf-tool-rail__history">
          <button
            className="pdf-tool-rail__button"
            aria-label="되돌리기"
            title="되돌리기 (⌘Z)"
            disabled={!drawingsApi.canUndo || drawingsApi.historyBusy}
            onClick={() => void drawingsApi.undo()}
          >
            <PdfToolIcon name="undo" />
          </button>
          <button
            className="pdf-tool-rail__button"
            aria-label="다시 실행"
            title="다시 실행 (⇧⌘Z)"
            disabled={!drawingsApi.canRedo || drawingsApi.historyBusy}
            onClick={() => void drawingsApi.redo()}
          >
            <PdfToolIcon name="redo" />
          </button>
        </div>
        {(drawingsApi.error ?? exportMessage) && (
          <span className="pdf-tool-rail__status" role="status">
            {drawingsApi.error ?? exportMessage}
          </span>
        )}
      </div>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="pdf-tool-popover"
            role="dialog"
            aria-label={
              menu.kind === 'style' ? '필기 스타일' : '도형 및 텍스트 도구'
            }
            style={{ left: menu.x, top: menu.y }}
          >
            {menu.kind === 'tools' ? (
              <>
                <div className="pdf-tool-popover__tools">
                  {TOOLS.slice(4).map((entry) => toolButton(entry, true))}
                </div>
                <button
                  className="pdf-tool-popover__export"
                  aria-label={
                    exporting
                      ? '주석 포함 PDF 내보내는 중'
                      : '주석 포함 PDF 내보내기'
                  }
                  disabled={exporting}
                  onClick={() => void exportPdf()}
                >
                  <PdfToolIcon name="export" />
                  PDF 내보내기
                </button>
              </>
            ) : (
              <>
                <div
                  className="pdf-tool-rail__group pdf-tool-rail__palette"
                  role="group"
                  aria-label="필기 색상"
                >
                  {COLORS.map((entry) => (
                    <button
                      key={entry}
                      className="pdf-tool-rail__swatch"
                      data-color={entry}
                      data-selected={color === entry ? 'true' : 'false'}
                      aria-label={COLOR_LABELS[entry]}
                      aria-pressed={color === entry}
                      onClick={() => setColor(entry)}
                    />
                  ))}
                </div>
                <label className="pdf-tool-rail__range">
                  선 굵기
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
                <label className="pdf-tool-rail__range">
                  불투명도
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
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
