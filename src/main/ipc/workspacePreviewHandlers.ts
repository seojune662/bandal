import { app, BrowserWindow, nativeImage, type IpcMainInvokeEvent } from 'electron'
import type { PreviewRect, WorkspacePreviewIpcContract } from '../../shared/ipc/workspacePreviewContract'
import { boundedCaptureRect, captureAnnotationImage } from '../features/browser/annotationCapture'
import { workspaceBrowserPreviewTargets } from '../features/browser/nativeTabs'
import { createWindowPreviewCache, previewImageBytes } from '../features/workspace/windowPreviewCache'

type Handler = <K extends keyof WorkspacePreviewIpcContract>(channel: K, fn: (input: WorkspacePreviewIpcContract[K]['req'], event: IpcMainInvokeEvent) => WorkspacePreviewIpcContract[K]['res'] | Promise<WorkspacePreviewIpcContract[K]['res']>) => void
const intersects = (a: PreviewRect, b: PreviewRect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

export function registerWorkspacePreviewHandlers(handle: Handler): void {
  const cache = createWindowPreviewCache(app.getPath('userData'))
  handle('workspacePreview:capture', async (req, event) => {
    const host = BrowserWindow.fromWebContents(event.sender)
    if (!host || host.isDestroyed() || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid workspace preview host')
    const [width = 0, height = 0] = host.getContentSize(), zoom = event.sender.getZoomFactor()
    const rect = boundedCaptureRect(req.rect, { width: width / zoom, height: height / zoom }, zoom)
    const targets = workspaceBrowserPreviewTargets(event).filter(target => intersects(rect, target.bounds))
    const [imageDataUrl, pages] = await Promise.all([
      captureAnnotationImage(event.sender, rect),
      Promise.all(targets.map(async target => {
        const bounds = target.bounds
        // Private pixels must not even enter the capture IPC response.
        const imageDataUrl = target.isPrivate ? null : await captureAnnotationImage(target.contents, { x: 0, y: 0, width: bounds.width, height: bounds.height })
        if (!target.isCurrent()) throw new Error('Workspace changed during preview capture')
        return { rect: { x: bounds.x / zoom, y: bounds.y / zoom, width: bounds.width / zoom, height: bounds.height / zoom }, imageDataUrl, isPrivate: target.isPrivate }
      }))
    ])
    if (host.isDestroyed() || event.sender.isDestroyed() || event.sender.getZoomFactor() !== zoom) throw new Error('Workspace changed during preview capture')
    return { rect: { x: rect.x / zoom, y: rect.y / zoom, width: rect.width / zoom, height: rect.height / zoom }, imageDataUrl, pages }
  })
  handle('workspacePreview:read', async req => ({ imageDataUrl: await cache.read(req) }))
  handle('workspacePreview:save', async req => {
    const bytes = previewImageBytes(req.imageDataUrl), decoded = nativeImage.createFromBuffer(bytes)
    const size = decoded.getSize()
    if (decoded.isEmpty() || size.width > 640 || size.height > 640) throw new Error('Invalid workspace preview size')
    await cache.save(req, req.imageDataUrl)
    return { ok: true }
  })
  handle('workspacePreview:remove', async req => { await cache.remove(req); return { ok: true } })
}
