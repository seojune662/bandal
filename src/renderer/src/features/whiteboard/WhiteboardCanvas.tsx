import {
  useEffect,
  useRef,
  useState,
  type RefObject
} from 'react'
import type { DrawingShape } from '../../../../shared/types/drawing'
import type { WhiteboardAvailability } from '../../../../shared/types/whiteboard'
import { InkLayer, useInkToolStore } from '../ink'
import { WhiteboardToolRail } from './WhiteboardToolRail'

export type DrawableWhiteboardAvailability = Extract<
  WhiteboardAvailability,
  { state: 'ready' | 'not-provisioned' }
>

interface CanvasSize {
  width: number
  height: number
}

function useCanvasSize(ref: RefObject<HTMLDivElement>): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const update = (width: number, height: number): void => {
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      )
    }
    const rect = element.getBoundingClientRect()
    update(rect.width, rect.height)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) update(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}

export interface WhiteboardCanvasProps {
  availability: DrawableWhiteboardAvailability
  shapes: readonly DrawingShape[]
  canUndo: boolean
  canRedo: boolean
  controlsEnabled: boolean
  statusMessage: string | null
  onCreate: (
    shape: Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'>
  ) => void
  onUpdate: (
    id: string,
    patch: Partial<Pick<DrawingShape, 'data' | 'style'>>
  ) => void
  onRemove: (ids: string[]) => void
  onUndo: () => void
  onRedo: () => void
}

export function WhiteboardCanvas({
  availability,
  shapes,
  canUndo,
  canRedo,
  controlsEnabled,
  statusMessage,
  onCreate,
  onUpdate,
  onRemove,
  onUndo,
  onRedo
}: WhiteboardCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null)
  const size = useCanvasSize(canvasRef)
  const activeTool = useInkToolStore((state) => state.activeTool)
  const color = useInkToolStore((state) => state.color)
  const width = useInkToolStore((state) => state.width)
  const opacity = useInkToolStore((state) => state.opacity)
  const hasMeasuredCanvas = Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  const aspect = hasMeasuredCanvas ? size.height / size.width : 0
  const baseWidthPx = hasMeasuredCanvas ? size.width : 0

  return (
    <section
      className="whiteboard"
      data-availability={availability.state}
      data-drawing-enabled="true"
      data-tool={activeTool}
    >
      {availability.state === 'not-provisioned' && (
        <p className="whiteboard__notice" role="status">
          공유 준비가 아직 안 됐어요. 지금 그리는 건 이 기기에만 저장됩니다
        </p>
      )}
      <WhiteboardToolRail
        canUndo={canUndo}
        canRedo={canRedo}
        enabled={controlsEnabled}
        onUndo={onUndo}
        onRedo={onRedo}
      />
      {statusMessage !== null && (
        <p className="whiteboard__status" role="status">{statusMessage}</p>
      )}
      <div className="whiteboard__viewport">
        <div ref={canvasRef} className="whiteboard__canvas">
          <InkLayer
            aspect={aspect}
            baseWidthPx={baseWidthPx}
            shapes={shapes}
            tool={{ activeTool, color, width, opacity }}
            onCreate={onCreate}
            onUpdate={onUpdate}
            onRemove={onRemove}
            clampToBounds={true}
            interactive={controlsEnabled}
            ariaLabel="공유 화이트보드 캔버스"
            className="whiteboard__ink-layer"
          />
        </div>
      </div>
    </section>
  )
}
