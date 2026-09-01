import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DrawingBox } from '../../../../shared/types/drawing'
import type { ResizeHandle } from './inkGeometry'

const HANDLE_SIZE = 0.016

const HANDLE_CORNERS: readonly ResizeHandle[] = ['nw', 'ne', 'sw', 'se']

/** 텍스트박스: 코너(자유 리사이즈) + 좌우 엣지(폭만 — 줄바꿈 재배치). */
export const TEXTBOX_HANDLES: readonly ResizeHandle[] = [
  'nw', 'ne', 'sw', 'se', 'e', 'w'
]

export interface ResizeHandleBox extends DrawingBox {
  handle: ResizeHandle
}

function handleCenter(
  handle: ResizeHandle,
  box: DrawingBox
): { x: number; y: number } {
  const midX = box.x + box.width / 2
  const midY = box.y + box.height / 2
  switch (handle) {
    case 'nw': return { x: box.x, y: box.y }
    case 'ne': return { x: box.x + box.width, y: box.y }
    case 'sw': return { x: box.x, y: box.y + box.height }
    case 'se': return { x: box.x + box.width, y: box.y + box.height }
    case 'n': return { x: midX, y: box.y }
    case 's': return { x: midX, y: box.y + box.height }
    case 'e': return { x: box.x + box.width, y: midY }
    case 'w': return { x: box.x, y: midY }
  }
}

export function resizeHandleBoxes(
  box: DrawingBox,
  aspect: number,
  handles: readonly ResizeHandle[] = HANDLE_CORNERS
): ResizeHandleBox[] {
  if (!Number.isFinite(aspect) || aspect <= 0) return []
  const screenSquareHeight = HANDLE_SIZE / aspect
  const halfWidth = HANDLE_SIZE / 2
  const halfHeight = screenSquareHeight / 2

  return handles.map((handle) => {
    const center = handleCenter(handle, box)
    return {
      handle,
      x: center.x - halfWidth,
      y: center.y - halfHeight,
      width: HANDLE_SIZE,
      height: screenSquareHeight
    }
  })
}

interface ResizeHandlesProps {
  box: DrawingBox
  aspect: number
  className: string
  fill?: string
  handles?: readonly ResizeHandle[]
  onPointerDown: (
    event: ReactPointerEvent<SVGRectElement>,
    handle: ResizeHandle
  ) => void
}

export function ResizeHandles({
  box,
  aspect,
  className,
  fill,
  handles = HANDLE_CORNERS,
  onPointerDown
}: ResizeHandlesProps): JSX.Element {
  return (
    <>
      {resizeHandleBoxes(box, aspect, handles).map(({ handle, ...handleBox }) => (
        <rect
          key={handle}
          className={className}
          data-resize-handle={handle}
          {...handleBox}
          fill={fill}
          onPointerDown={(event) => onPointerDown(event, handle)}
        />
      ))}
    </>
  )
}
