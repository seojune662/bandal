import type { DrawingBox, DrawingPoint } from '../../../../shared/types/drawing'

const MAX_IMAGE_WIDTH = 0.4
const MAX_IMAGE_HEIGHT = 0.4

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** Fits an image around a normalized point while preserving its screen ratio. */
export function imageBoxAtPoint(
  point: Pick<DrawingPoint, 'x' | 'y'>,
  surfaceAspect: number,
  imageAspect: number
): DrawingBox {
  const safeSurfaceAspect = finitePositive(surfaceAspect) ? surfaceAspect : 1
  const safeImageAspect = finitePositive(imageAspect) ? imageAspect : 1
  const width = Math.min(
    MAX_IMAGE_WIDTH,
    MAX_IMAGE_HEIGHT * safeSurfaceAspect / safeImageAspect
  )
  const height = width * safeImageAspect / safeSurfaceAspect
  const x = Math.min(1 - width, Math.max(0, point.x - width / 2))
  const y = Math.min(1 - height, Math.max(0, point.y - height / 2))
  return { x, y, width, height }
}

export function dataUrlImageAspect(dataUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalHeight / image.naturalWidth
        : null
    )
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}
