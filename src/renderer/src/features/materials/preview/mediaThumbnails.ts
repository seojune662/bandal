import type { DrawingBox } from '../../../../../shared/types/drawing'
import { mediaUrlFor } from '../mediaUrl'

export interface MediaThumbnail {
  dataUrl: string
  pageCount?: number
  durationSeconds?: number
}

const THUMBNAIL_LIMIT = 24
const THUMBNAIL_EDGE = 360
const thumbnails = new Map<string, MediaThumbnail>()

function cached(key: string): MediaThumbnail | undefined {
  const value = thumbnails.get(key)
  if (value !== undefined) {
    thumbnails.delete(key)
    thumbnails.set(key, value)
  }
  return value
}

function remember(key: string, value: MediaThumbnail): MediaThumbnail {
  thumbnails.delete(key)
  thumbnails.set(key, value)
  while (thumbnails.size > THUMBNAIL_LIMIT) {
    const oldest = thumbnails.keys().next().value
    if (oldest !== undefined) thumbnails.delete(oldest)
  }
  return value
}

export function thumbnailFrameTime(durationSeconds: number): number {
  return Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.min(1, durationSeconds * 0.1)
    : 0
}

/** A small first-page render; range loading never starts background prefetch. */
export async function loadPdfThumbnail(
  courseId: string,
  relPath: string,
  version: string,
  signal: AbortSignal,
  pageNumber = 1,
  crop?: DrawingBox
): Promise<MediaThumbnail> {
  const key = JSON.stringify(['pdf', courseId, relPath, version, pageNumber, crop])
  const previous = cached(key)
  signal.throwIfAborted()
  if (previous !== undefined) return previous
  const [{ pdfjs }, { configurePdfWorker }] = await Promise.all([
    import('react-pdf'),
    import('../../pdf/pdfWorker')
  ])
  signal.throwIfAborted()
  configurePdfWorker()
  const loading = pdfjs.getDocument({
    url: mediaUrlFor(courseId, relPath),
    disableStream: true,
    disableAutoFetch: true,
    rangeChunkSize: 65536,
    isEvalSupported: false
  })
  const abort = (): void => { void loading.destroy().catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const pdf = await loading.promise
    signal.throwIfAborted()
    const page = await pdf.getPage(pageNumber)
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: THUMBNAIL_EDGE / Math.max(natural.width, natural.height) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const context = canvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('Canvas unavailable')
    const render = page.render({ canvas, canvasContext: context, viewport })
    const cancelRender = (): void => render.cancel()
    signal.addEventListener('abort', cancelRender, { once: true })
    try { await render.promise } finally { signal.removeEventListener('abort', cancelRender) }
    signal.throwIfAborted()
    let output = canvas
    if (crop !== undefined) {
      output = document.createElement('canvas')
      const x = Math.max(0, Math.min(1, crop.x)) * canvas.width
      const y = Math.max(0, Math.min(1, crop.y)) * canvas.height
      output.width = Math.max(1, Math.round(Math.min(1 - crop.x, crop.width) * canvas.width))
      output.height = Math.max(1, Math.round(Math.min(1 - crop.y, crop.height) * canvas.height))
      output.getContext('2d')?.drawImage(canvas, x, y, output.width, output.height, 0, 0, output.width, output.height)
    }
    return remember(key, { dataUrl: output.toDataURL('image/png'), pageCount: pdf.numPages })
  } finally {
    signal.removeEventListener('abort', abort)
    await loading.destroy().catch(() => undefined)
  }
}

/** Seeks a muted detached video without ever playing it, then releases its decoder. */
export function loadVideoThumbnail(
  courseId: string,
  relPath: string,
  version: string,
  signal: AbortSignal
): Promise<MediaThumbnail> {
  const key = JSON.stringify(['video', courseId, relPath, version])
  const previous = cached(key)
  if (signal.aborted) return Promise.reject(signal.reason)
  if (previous !== undefined) return Promise.resolve(previous)
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      video.onloadedmetadata = null
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    const finish = (value?: MediaThumbnail, error?: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      if (value !== undefined) resolve(remember(key, value))
      else reject(error ?? new Error('Video preview unavailable'))
    }
    const abort = (): void => finish(undefined, signal.reason)
    const timeout = setTimeout(() => finish(), 8000)
    const capture = (): void => {
      if (video.readyState < 2 || video.videoWidth === 0) return
      try {
        const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(video.videoWidth, video.videoHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        const context = canvas.getContext('2d')
        if (context === null) return finish()
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish({ dataUrl: canvas.toDataURL('image/jpeg', 0.8), durationSeconds: Number.isFinite(video.duration) ? video.duration : 0 })
      } catch (error) { finish(undefined, error) }
    }
    video.onloadedmetadata = () => {
      const time = thumbnailFrameTime(video.duration)
      if (time === 0) capture()
      else video.currentTime = time
    }
    video.onloadeddata = () => { if (thumbnailFrameTime(video.duration) === 0) capture() }
    video.onseeked = capture
    video.onerror = () => finish()
    signal.addEventListener('abort', abort, { once: true })
    video.src = mediaUrlFor(courseId, relPath)
    video.load()
  })
}
