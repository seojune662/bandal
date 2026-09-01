import { useCallback, useMemo } from 'react'
import type {
  CreateDrawingInput,
  Drawing,
  DrawingShape,
  UpdateDrawingInput
} from '../../../../../shared/types/drawing'
import { InkLayer } from '../../ink/InkLayer'
import type { InkToolState } from '../../ink/inkToolStore'
import { usePdfToolStore } from './toolStore'

interface DrawingLayerProps {
  courseId: string
  relPath: string
  page: number
  pageWidth: number
  aspect: number
  drawings: Drawing[]
  loading: boolean
  /** 패널 활성 여부 — 키보드 삭제가 활성 탭에만 반응하게. */
  interactive: boolean
  create: (input: CreateDrawingInput) => Promise<Drawing | null>
  update: (input: UpdateDrawingInput) => Promise<Drawing | null>
  remove: (ids: string[]) => Promise<boolean>
}

type CreateShape = Omit<DrawingShape, 'id' | 'createdAt' | 'updatedAt'>
type ShapePatch = Partial<Pick<DrawingShape, 'data' | 'style'>>

export function DrawingLayer(props: DrawingLayerProps): JSX.Element {
  const {
    courseId,
    relPath,
    page,
    pageWidth,
    aspect,
    drawings,
    loading,
    interactive,
    create,
    update,
    remove
  } = props
  const activeTool = usePdfToolStore((state) => state.activeTool)
  const color = usePdfToolStore((state) => state.color)
  const width = usePdfToolStore((state) => state.width)
  const opacity = usePdfToolStore((state) => state.opacity)
  const tool = useMemo<InkToolState>(
    () => ({ activeTool, color, width, opacity }),
    [activeTool, color, opacity, width]
  )

  const handleCreate = useCallback((shape: CreateShape) => create({
    courseId,
    relPath,
    page,
    ...shape
  }), [courseId, create, page, relPath])

  const handleUpdate = useCallback((id: string, patch: ShapePatch) => update({
    id,
    ...patch
  }), [update])

  return (
    <InkLayer
      courseId={courseId}
      aspect={aspect}
      baseWidthPx={pageWidth}
      shapes={drawings}
      tool={tool}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onRemove={remove}
      clampToBounds
      interactive={interactive}
      ariaLabel={`${page} 페이지 필기 레이어`}
      className={loading ? 'pdf-drawing-layer is-loading' : 'pdf-drawing-layer'}
    />
  )
}
