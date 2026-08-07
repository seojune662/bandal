import { useEffect } from 'react'
import type { DrawingColor } from '../../../../shared/types/drawing'
import {
  useInkToolStore,
  type InkTool
} from '../ink'
import { WhiteboardToolIcon } from './WhiteboardToolIcon'

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

export interface WhiteboardToolRailProps {
  canUndo: boolean
  canRedo: boolean
  enabled: boolean
  onUndo: () => void
  onRedo: () => void
}

export function WhiteboardToolRail({
  canUndo,
  canRedo,
  enabled,
  onUndo,
  onRedo
}: WhiteboardToolRailProps): JSX.Element {
  const activeTool = useInkToolStore((state) => state.activeTool)
  const color = useInkToolStore((state) => state.color)
  const width = useInkToolStore((state) => state.width)
  const opacity = useInkToolStore((state) => state.opacity)
  const setActiveTool = useInkToolStore((state) => state.setActiveTool)
  const setColor = useInkToolStore((state) => state.setColor)
  const setWidth = useInkToolStore((state) => state.setWidth)
  const setOpacity = useInkToolStore((state) => state.setOpacity)

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
      const entry = TOOLS.find((candidate) =>
        candidate.shortcut?.toLowerCase() === event.key.toLowerCase()
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
    <div className="whiteboard-tools" role="toolbar" aria-label="화이트보드 도구">
      <div className="whiteboard-tools__group whiteboard-tools__drawing-tools">
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            className="whiteboard-tools__button"
            data-active={activeTool === entry.tool ? 'true' : 'false'}
            aria-pressed={activeTool === entry.tool}
            aria-label={entry.label}
            title={`${entry.label}${entry.shortcut === undefined ? '' : ` (${entry.shortcut})`}`}
            onClick={() => setActiveTool(entry.tool)}
          >
            <WhiteboardToolIcon name={entry.tool} />
          </button>
        ))}
      </div>

      <div
        className="whiteboard-tools__group whiteboard-tools__palette"
        role="group"
        aria-label="필기 색상"
      >
        {COLORS.map((entry) => (
          <button
            key={entry}
            type="button"
            className="whiteboard-tools__swatch"
            data-color={entry}
            data-selected={color === entry ? 'true' : 'false'}
            aria-label={COLOR_LABELS[entry]}
            aria-pressed={color === entry}
            title={COLOR_LABELS[entry]}
            onClick={() => setColor(entry)}
          />
        ))}
      </div>

      <div className="whiteboard-tools__group whiteboard-tools__settings">
        <label className="whiteboard-tools__range" title="선 굵기">
          <WhiteboardToolIcon name="lineWidth" />
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
        <label className="whiteboard-tools__range" title="불투명도">
          <WhiteboardToolIcon name="opacity" />
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

      <div className="whiteboard-tools__group whiteboard-tools__history">
        <button
          type="button"
          className="whiteboard-tools__button"
          aria-label="되돌리기"
          title="되돌리기 (Ctrl/Cmd+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <WhiteboardToolIcon name="undo" />
        </button>
        <button
          type="button"
          className="whiteboard-tools__button"
          aria-label="다시 실행"
          title="다시 실행 (Shift+Ctrl/Cmd+Z)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <WhiteboardToolIcon name="redo" />
        </button>
      </div>
    </div>
  )
}
