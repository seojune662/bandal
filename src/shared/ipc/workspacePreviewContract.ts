export interface PreviewRect { x: number; y: number; width: number; height: number }
export interface WorkspacePreviewKey { workspaceKey: string; windowId: string }
export interface WorkspacePreviewCapture {
  rect: PreviewRect
  imageDataUrl: string
  /** Native bounds come from the main process, in host CSS pixels. */
  pages: Array<{ rect: PreviewRect; imageDataUrl: string | null; isPrivate: boolean }>
}

/** App UI only. These local thumbnails are never exposed to agent tools or sync. */
export interface WorkspacePreviewIpcContract {
  'workspacePreview:capture': { req: { rect: PreviewRect }; res: WorkspacePreviewCapture }
  'workspacePreview:read': { req: WorkspacePreviewKey; res: { imageDataUrl: string | null } }
  'workspacePreview:save': { req: WorkspacePreviewKey & { imageDataUrl: string }; res: { ok: true } }
  'workspacePreview:remove': { req: WorkspacePreviewKey; res: { ok: true } }
}
export const WORKSPACE_PREVIEW_CHANNELS = ['workspacePreview:capture', 'workspacePreview:read', 'workspacePreview:save', 'workspacePreview:remove'] as const
