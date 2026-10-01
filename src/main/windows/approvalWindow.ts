import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
let win: BrowserWindow | null = null
let owner: BrowserWindow | null = null
let conversation = ''
let ready = false
let wanted = false
const detach = (): void => { owner?.removeListener('move', place); owner?.removeListener('resize', place); owner?.removeListener('hide', hide); owner?.removeListener('closed', hide) }
function hide(): void { wanted = false; win?.hide() }
function place(): void {
  if (!win || win.isDestroyed() || !owner || owner.isDestroyed()) return
  const b = owner.getBounds(), area = screen.getDisplayMatching(b).workArea
  const width = Math.min(300, area.width), height = Math.min(230, Math.max(140, b.height - 230))
  const right = b.x + b.width + 10, left = b.x - width - 10
  const x = right + width <= area.x + area.width ? right : left >= area.x ? left : b.x + b.width - width - 12
  win.setBounds({ x: Math.max(area.x, Math.min(x, area.x + area.width - width)), y: Math.max(area.y, Math.min(b.y + 50, area.y + area.height - height)), width, height })
}
export function approvalWindowRequest(event: IpcMainInvokeEvent, req: { conversationId: string; visible: boolean }): void {
  const sender = BrowserWindow.fromWebContents(event.sender)
  if (!sender || event.senderFrame !== event.sender.mainFrame || sender === win) return
  if (!req.visible) { if (conversation === req.conversationId && owner === sender) hide(); return }
  if (!sender.isVisible() || sender.isMinimized()) return
  if (owner !== sender) { detach(); owner = sender; owner.on('move', place); owner.on('resize', place); owner.on('hide', hide); owner.once('closed', hide) }
  wanted = true
  conversation = req.conversationId
  if (!win || win.isDestroyed()) {
    ready = false
    win = new BrowserWindow({ width: 300, height: 230, frame: false, show: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#fafafa', hasShadow: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.once('did-finish-load', () => { ready = true; display() })
    win.once('closed', () => { win = null; ready = false; detach() })
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev) void win.loadURL(`${dev}/overlay.html?view=approval&conversationId=${encodeURIComponent(conversation)}`)
    else void win.loadFile(join(__dirname, '../renderer/overlay.html'), { query: { view: 'approval', conversationId: conversation } })
  }
  display()
}
function display(): void {
  if (!wanted || !ready || !win || !owner || owner.isDestroyed() || !owner.isVisible()) return
  place(); win.webContents.send('assistant:approval', { conversationId: conversation })
  if (!win.isVisible()) win.showInactive()
}
export function dismissApprovalWhenResolved(conversationId: string, pending: boolean): void { if (conversation === conversationId && !pending) hide() }
