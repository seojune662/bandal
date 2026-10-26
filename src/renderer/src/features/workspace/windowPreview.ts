import type { PreviewRect, WorkspacePreviewCapture, WorkspacePreviewKey } from '../../../../shared/ipc/workspacePreviewContract'
import { invoke } from '../../lib/ipc'

const CAPTURE_BUDGET_MS = 250
export interface CaptureWindowPreviewOptions extends WorkspacePreviewKey {
  element: HTMLElement
  /** The caller checks both active workspace and window, including overview state. */
  isCurrent?: () => boolean
}
type PreviewTransport = {
  capture: (rect: PreviewRect) => Promise<WorkspacePreviewCapture>
  read: (key: WorkspacePreviewKey) => Promise<string | null>
  save: (key: WorkspacePreviewKey, imageDataUrl: string) => Promise<unknown>
  remove: (key: WorkspacePreviewKey) => Promise<unknown>
}
const toRect = (rect: DOMRect): PreviewRect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
const keyOf = (key: WorkspacePreviewKey): string => JSON.stringify([key.workspaceKey, key.windowId])
const sameRect = (a: PreviewRect, b: PreviewRect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

function privateRects(element: HTMLElement): PreviewRect[] {
  // Panel contents are portaled outside Dockview, so inspect the host document.
  return [...element.ownerDocument.querySelectorAll<HTMLElement>('[data-private-preview], .browser-panel[data-private="true"]')]
    .filter(node => {
      if (node.closest('[hidden], [inert]')) return false
      const style = getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
    })
    .map(node => toRect(node.getBoundingClientRect())).filter(rect => rect.width > 0 && rect.height > 0)
}
const decode = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Workspace preview decoding failed'))
  image.src = src
})

/** Compose at most 640 px; private titles, toolbars, and page surfaces are masked last. */
export async function composeWindowPreview(capture: WorkspacePreviewCapture, masks: PreviewRect[]): Promise<string> {
  const rect = capture.rect, scale = Math.min(1, 640 / Math.max(rect.width, rect.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(rect.width * scale))
  canvas.height = Math.max(1, Math.round(rect.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Workspace preview canvas unavailable')
  const [host, ...pages] = await Promise.all([decode(capture.imageDataUrl), ...capture.pages.map(page => page.imageDataUrl ? decode(page.imageDataUrl) : Promise.resolve(null))])
  if (!host) throw new Error('Workspace preview unavailable')
  context.drawImage(host, 0, 0, canvas.width, canvas.height)
  capture.pages.forEach((page, index) => {
    const image = pages[index]
    if (image && !page.isPrivate) context.drawImage(image, (page.rect.x - rect.x) * scale, (page.rect.y - rect.y) * scale, page.rect.width * scale, page.rect.height * scale)
  })
  context.fillStyle = '#e8e8ec'
  for (const mask of [...masks, ...capture.pages.filter(page => page.isPrivate).map(page => page.rect)]) {
    // Expand by one source pixel to avoid antialiasing a private edge into the JPEG.
    context.fillRect((mask.x - rect.x - 1) * scale, (mask.y - rect.y - 1) * scale, (mask.width + 2) * scale, (mask.height + 2) * scale)
  }
  return canvas.toDataURL('image/jpeg', 0.8)
}

export function createWindowPreviewController(
  transport: PreviewTransport,
  compose: typeof composeWindowPreview = composeWindowPreview
) {
  const images = new Map<string, string | null>()
  const reads = new Map<string, Promise<string | null>>()
  const generations = new Map<string, number>()
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  const nextGeneration = (key: string): number => {
    const next = (generations.get(key) ?? 0) + 1
    generations.set(key, next)
    return next
  }
  const load = (key: WorkspacePreviewKey): Promise<string | null> => {
    const id = keyOf(key)
    if (images.has(id)) return Promise.resolve(images.get(id) ?? null)
    const existing = reads.get(id)
    if (existing) return existing
    const generation = generations.get(id)
    const pending = transport.read(key).catch(() => null).then(image => {
      if (generations.get(id) === generation && !images.has(id)) { images.set(id, image); notify() }
      return images.get(id) ?? null
    }).finally(() => { if (reads.get(id) === pending) reads.delete(id) })
    reads.set(id, pending)
    return pending
  }
  return {
    load,
    get: (key: WorkspacePreviewKey): string | null => images.get(keyOf(key)) ?? null,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
    async capture(options: CaptureWindowPreviewOptions): Promise<string | null> {
      const key = { workspaceKey: options.workspaceKey, windowId: options.windowId }, id = keyOf(key)
      const previous = images.get(id) ?? null, generation = nextGeneration(id)
      const rect = toRect(options.element.getBoundingClientRect()), masks = privateRects(options.element)
      let expired = false
      const current = (): boolean => !expired && generations.get(id) === generation && options.element.isConnected &&
        (options.isCurrent?.() ?? true) && sameRect(rect, toRect(options.element.getBoundingClientRect()))
      if (!current() || rect.width <= 0 || rect.height <= 0) return previous
      let timer: ReturnType<typeof setTimeout> | undefined
      const operation = (async () => {
        const capture = await transport.capture(rect)
        if (!current()) return previous
        const image = await compose(capture, [...masks, ...privateRects(options.element)])
        if (!current()) return previous
        // The budget covers capture/compositing, not disk latency. Cache the
        // accepted image immediately; its explicit key always remains the
        // source window while the main process atomically persists it.
        images.set(id, image)
        notify()
        void transport.save(key, image).catch(() => undefined)
        return image
      })().catch(() => previous)
      try {
        return await Promise.race([operation, new Promise<string | null>(resolve => {
          timer = setTimeout(() => { expired = true; resolve(previous) }, CAPTURE_BUDGET_MS)
        })])
      } finally { if (timer !== undefined) clearTimeout(timer) }
    },
    async remove(key: WorkspacePreviewKey): Promise<void> {
      const id = keyOf(key)
      nextGeneration(id)
      images.set(id, null)
      notify()
      await transport.remove(key)
    }
  }
}

const controller = createWindowPreviewController({
  capture: rect => invoke('workspacePreview:capture', { rect }),
  read: key => invoke('workspacePreview:read', key).then(result => result.imageDataUrl),
  save: (key, imageDataUrl) => invoke('workspacePreview:save', { ...key, imageDataUrl }),
  remove: key => invoke('workspacePreview:remove', key)
})
export const captureWindowPreview = controller.capture
export const loadWindowPreview = (workspaceKey: string, windowId: string): Promise<string | null> => controller.load({ workspaceKey, windowId })
export const getWindowPreview = (workspaceKey: string, windowId: string): string | null => controller.get({ workspaceKey, windowId })
export const deleteWindowPreview = (workspaceKey: string, windowId: string): Promise<void> => controller.remove({ workspaceKey, windowId })
export const subscribeWindowPreviews = controller.subscribe
