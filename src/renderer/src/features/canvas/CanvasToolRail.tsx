import { useEffect } from 'react'
import type { DrawingColor } from '../../../../shared/types/drawing'
import { useInkToolStore, type InkTool } from '../ink'
import { CanvasToolIcon } from './CanvasToolIcon'

interface ToolButton {
  tool: InkTool
  label: string
  shortcut?: string
}

const TOOLS: readonly ToolButton[] = [
  { tool: 'select', label: '선택', shortcut: 'V' },
  { tool: 'pen', label: '펜', shortcut: 'P' },
  { tool: 'highlighter', label: '형광펜', shortcut: 'H' },
  { tool: 'eraser', label: '지우개', shortcut: 'E' },
  { tool: 'text', label: '텍스트', shortcut: 'T' },
  { tool: 'rect', label: '사각형', shortcut: 'R' },
  { tool: 'ellipse', label: '타원', shortcut: 'O' },
  { tool: 'arrow', label: '화살표' },
  { tool: 'line', label: '직선' }
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
  return target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

export interface CanvasToolRailProps {
  canUndo: boolean
  canRedo: boolean
  enabled: boolean
  onUndo: () => void
  onRedo: () => void
}

export function CanvasToolRail({
  canUndo,
  canRedo,
  enabled,
  onUndo,
  onRedo
}: CanvasToolRailProps): JSX.Element {
  const activeTool = useInkToolStore((state) => state.activeTool)
  const color = useInkToolStore((state) => state.color)
  const width = useInkToolStore((state) => state.width)
  const setActiveTool = useInkToolStore((state) => state.setActiveTool)
  const setColor = useInkToolStore((state) => state.setColor)
  const setWidth = useInkToolStore((state) => state.setWidth)

  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) onRedo()
        else onUndo()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const entry = TOOLS.find(
        (candidate) => candidate.shortcut?.toLowerCase() === event.key.toLowerCase()
      )
      if (entry !== undefined) {
        event.preventDefault()
        setActiveTool(entry.tool)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, onRedo, onUndo, setActiveTool])

  return (
    <div className="canvas-tools" role="toolbar" aria-label="개인 화이트보드 도구">
      <div className="canvas-tools__group" role="group" aria-label="그리기 도구">
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            className="canvas-tools__button"
            data-active={activeTool === entry.tool ? 'true' : 'false'}
            aria-pressed={activeTool === entry.tool}
            aria-label={entry.label}
            title={`${entry.label}${entry.shortcut === undefined ? '' : ` (${entry.shortcut})`}`}
            disabled={!enabled}
            onClick={() => setActiveTool(entry.tool)}
          >
            <CanvasToolIcon name={entry.tool} />
          </button>
        ))}
      </div>

      <div className="canvas-tools__group" role="group" aria-label="색상">
        {COLORS.map((entry) => (
          <button
            key={entry}
            type="button"
            className="canvas-tools__swatch"
            data-color={entry}
            data-selected={color === entry ? 'true' : 'false'}
            aria-label={COLOR_LABELS[entry]}
            aria-pressed={color === entry}
            title={COLOR_LABELS[entry]}
            disabled={!enabled}
            onClick={() => setColor(entry)}
          />
        ))}
      </div>

      <div className="canvas-tools__group" role="group" aria-label="선 굵기">
        <label className="canvas-tools__range" title="선 굵기">
          <CanvasToolIcon name="lineWidth" />
          <input
            type="range"
            min="0.001"
            max="0.025"
            step="0.001"
            value={width}
            aria-label="선 굵기"
            disabled={!enabled}
            onChange={(event) => setWidth(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="canvas-tools__group" role="group" aria-label="편집 기록">
        <button
          type="button"
          className="canvas-tools__button"
          aria-label="되돌리기"
          title="되돌리기"
          disabled={!enabled || !canUndo}
          onClick={onUndo}
        >
          <CanvasToolIcon name="undo" />
        </button>
        <button
          type="button"
          className="canvas-tools__button"
          aria-label="다시 실행"
          title="다시 실행"
          disabled={!enabled || !canRedo}
          onClick={onRedo}
        >
          <CanvasToolIcon name="redo" />
        </button>
      </div>
    </div>
  )
}
