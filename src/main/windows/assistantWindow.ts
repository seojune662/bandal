import { BrowserWindow, screen, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { app } from 'electron'
import { writeFileAtomic } from '../lib/atomicWrite'
import type { AssistantWindowRequest, AssistantWindowState } from '../../shared/types/assistantWindow'

let parent: BrowserWindow | null = null
let popup: BrowserWindow | null = null
let ready = false
let quitting = false
export function markAssistantQuitting(): void { quitting = true; stopResize() }
let state: AssistantWindowState = { visible: false, courseId: null, conversationId: null }
let pendingPrompt: Extract<AssistantWindowRequest, { action: 'prompt' }> | null = null
let relative = { x: 100, y: 120, width: 760, height: 660 }
let moving = false
let resizeTimer: ReturnType<typeof setInterval> | undefined
function stopResize(): void { clearInterval(resizeTimer); resizeTimer = undefined; saveBounds() }
function beginResize(corner: 'top-left' | 'bottom-right'): void {
  if (!popup || popup.isDestroyed() || !parent || parent.isDestroyed()) return
  stopResize()
  const initial = popup.getBounds(), start = screen.getCursorScreenPoint(), startedAt = Date.now()
  resizeTimer = setInterval(() => {
    if (!popup || popup.isDestroyed() || !parent || parent.isDestroyed() || Date.now() - startedAt > 10000) { stopResize(); return }
    const point = screen.getCursorScreenPoint(), area = parent.getContentBounds()
    const dx = point.x - start.x, dy = point.y - start.y
    const left = corner === 'top-left' ? Math.max(area.x, Math.min(initial.x + dx, initial.x + initial.width - 320)) : initial.x
    const top = corner === 'top-left' ? Math.max(area.y, Math.min(initial.y + dy, initial.y + initial.height - 300)) : initial.y
    const width = corner === 'top-left' ? initial.width + initial.x - left : Math.max(320, Math.min(initial.width + dx, area.x + area.width - left))
    const height = corner === 'top-left' ? initial.height + initial.y - top : Math.max(300, Math.min(initial.height + dy, area.y + area.height - top))
    const current = popup.getBounds()
    if (current.x !== left || current.y !== top || current.width !== width || current.height !== height) {
      popup.setBounds({ x: left, y: top, width, height })
    }
  }, 16)
}
const stateFile = (): string => join(app.getPath('userData'), 'assistant-window.json')
function publish(): void {
  if (parent && !parent.isDestroyed()) parent.webContents.send('assistant:state', state)
  if (popup && !popup.isDestroyed() && ready) popup.webContents.send('assistant:state', state)
}
function saveBounds(): void {
  if (!parent || parent.isDestroyed() || !popup || moving || resizeTimer || popup.isDestroyed()) return
  const p = parent.getContentBounds(), b = popup.getBounds()
  relative = { x: b.x - p.x, y: b.y - p.y, width: b.width, height: b.height }
  writeFileAtomic(stateFile(), JSON.stringify(relative))
}
function place(): void {
  if (!parent || !popup || parent.isDestroyed() || popup.isDestroyed()) return
  const p = parent.getContentBounds()
  const width = Math.max(320, Math.min(relative.width, p.width))
  const height = Math.max(300, Math.min(relative.height, p.height))
  moving = true
  popup.setBounds({ x: p.x + Math.max(0, Math.min(relative.x, p.width - width)), y: p.y + Math.max(0, Math.min(relative.y, p.height - height)), width, height })
  moving = false
}
function show(): void {
  if (!popup || !parent || !ready) return
  if (state.visible && parent.isVisible() && !parent.isMinimized()) { place(); popup.show() }
  else popup.hide()
}
export function registerAssistantParent(win: BrowserWindow): void {
  parent = win
  win.on('move', place); win.on('resize', place); win.on('enter-full-screen', place); win.on('leave-full-screen', place)
  win.on('minimize', () => { stopResize(); popup?.hide() }); win.on('hide', () => { stopResize(); popup?.hide() })
  win.on('restore', show); win.on('show', show)
  win.once('closed', () => { stopResize(); popup?.destroy(); popup = null; parent = null; ready = false; state = { visible: false, courseId: null, conversationId: null } })
}
function create(geometry?: typeof relative): void {
  if (popup || !parent) return
  if (existsSync(stateFile())) {
    try { const saved = JSON.parse(readFileSync(stateFile(), 'utf8')); if (['x', 'y', 'width', 'height'].every(k => Number.isFinite(saved[k]))) relative = saved } catch { /* use defaults */ }
  } else if (geometry && Object.values(geometry).every(Number.isFinite)) relative = geometry
  const win = new BrowserWindow({ parent, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, minWidth: 320, minHeight: 300, skipTaskbar: true, hasShadow: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  popup = win
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.on('blur', stopResize)
  win.on('close', e => { stopResize(); if (quitting) return; e.preventDefault(); saveBounds(); state = { ...state, visible: false }; win.hide(); publish() })
  win.on('moved', saveBounds)
  win.on('resized', saveBounds)
  win.webContents.once('did-finish-load', () => {
    ready = true; publish(); show()
    if (pendingPrompt) { win.webContents.send('assistant:prompt', pendingPrompt); pendingPrompt = null }
  })
  place()
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}/overlay.html?view=assistant`)
  else void win.loadFile(join(__dirname, '../renderer/overlay.html'), { query: { view: 'assistant' } })
}
export function assistantWindowRequest(event: IpcMainInvokeEvent, req: AssistantWindowRequest): AssistantWindowState {
  const fromParent = parent?.webContents === event.sender
  const fromPopup = popup?.webContents === event.sender
  if ((!fromParent && !fromPopup) || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid assistant host')
  if (req.action === 'sync') {
    if (!fromParent) throw new Error('Invalid assistant state owner')
    state = req.state
    if (state.visible) create(req.geometry)
    publish(); show()
  } else if (req.action === 'resize') {
    if (!fromPopup) throw new Error('Invalid resize owner')
    if (req.phase === 'end') stopResize()
    else if (req.corner === 'top-left' || req.corner === 'bottom-right') beginResize(req.corner)
  } else if (req.action === 'close') {
    stopResize()
    state = { ...state, visible: false }; saveBounds(); popup?.hide(); publish()
  } else if (req.action === 'prompt') {
    if (!fromParent) throw new Error('Invalid assistant prompt owner')
    if (ready) popup?.webContents.send('assistant:prompt', req)
    else pendingPrompt = req
  }
  return state
}
