import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DrawingBox } from '../../../../shared/types/drawing'
import type { ResizeHandle } from './inkGeometry'

const HANDLE_SIZE = 0.016

const HANDLE_CORNERS: readonly ResizeHandle[] = ['nw', 'ne', 'sw', 'se']

export interface ResizeHandleBox extends DrawingBox {
  handle: ResizeHandle
}

export function resizeHandleBoxes(
  box: DrawingBox,
  aspect: number
): ResizeHandleBox[] {
  if (!Number.isFinite(aspect) || aspect <= 0) return []
  const screenSquareHeight = HANDLE_SIZE / aspect
  const halfWidth = HANDLE_SIZE / 2
  const halfHeight = screenSquareHeight / 2

  return HANDLE_CORNERS.map((handle) => {
    const east = handle === 'ne' || handle === 'se'
    const south = handle === 'sw' || handle === 'se'
    const centerX = east ? box.x + box.width : box.x
    const centerY = south ? box.y + box.height : box.y
    return {
      handle,
      x: centerX - halfWidth,
      y: centerY - halfHeight,
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
  onPointerDown
}: ResizeHandlesProps): JSX.Element {
  return (
    <>
      {resizeHandleBoxes(box, aspect).map(({ handle, ...handleBox }) => (
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
