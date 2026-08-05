/**
 * Registers a handler for EVERY channel in IpcContract.
 *
 * M1-A: courses / materials / notes / annotations / board / layout are real
 * implementations backed by src/main/features/* repos and the SQLite DB.
 * chat / agent / browser remain typed stubs — their registration LINES live
 * here (so all channels are always handled) but their logic is owned by
 * later milestones. Keep the section comments so merges stay additive.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse } from '../../shared/ipc/contract'
import { getSettings, setSettings } from '../settingsStore'
import { getDatabase } from '../db/database'
import { createLayoutRepo } from '../db/layoutRepo'
import { createCoursesRepo } from '../features/courses'
import { createMaterialsRepo } from '../features/materials'
import { createNotesRepo } from '../features/notes'
import { createAnnotationsRepo } from '../features/annotations'
import { createBoardRepo } from '../features/board'
import {
  createBinaryLocator,
  createChatRepo,
  createClaudeCodeAdapter,
  createEventBatcher,
  createSessionManager,
  killAllClaudeProcessesSync
} from '../features/agent'

/**
 * Contract-typed wrapper around ipcMain.handle. Logs failures with channel
 * context, then rethrows so the renderer receives a rejected promise.
 */
function handle<K extends IpcChannel>(
  channel: K,
  fn: (req: IpcRequest<K>) => Promise<IpcResponse<K>> | IpcResponse<K>
): void {
  ipcMain.handle(channel, async (_event, req: IpcRequest<K>) => {
    try {
      return await fn(req)
    } catch (error) {
      console.error(`[ipc] ${channel} failed:`, error)
      throw error
    }
  })
}

const OK = { ok: true } as const

export function registerHandlers(): void {
  const db = getDatabase()
  const coursesRepo = createCoursesRepo({
    db,
    getDataRoot: () => getSettings().dataRoot
  })
  const materialsRepo = createMaterialsRepo({
    db,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    revealItem: (absPath) => shell.showItemInFolder(absPath)
  })
  const notesRepo = createNotesRepo({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  const annotationsRepo = createAnnotationsRepo(db)
  const boardRepo = createBoardRepo(db)
  const layoutRepo = createLayoutRepo(db)

  // -- courses --------------------------------------------------------------
  handle('courses:list', (req) => coursesRepo.list(req))
  handle('courses:create', (req) => coursesRepo.create(req))
  handle('courses:rename', (req) => coursesRepo.rename(req))
  handle('courses:archive', (req) => coursesRepo.archive(req))
  handle('courses:delete', (req) => coursesRepo.softDelete(req))

  // -- materials ------------------------------------------------------------
  handle('materials:tree', (req) => materialsRepo.tree(req.courseId))
  handle('materials:search', (req) => materialsRepo.search(req.courseId, req.query))
  handle('materials:import', (req) => materialsRepo.import(req.courseId, req.paths))
  handle('materials:reveal', (req) => materialsRepo.reveal(req.courseId, req.relPath))
  handle('materials:readFile', (req) => materialsRepo.readFile(req.courseId, req.relPath))

  // -- notes ----------------------------------------------------------------
  handle('notes:read', (req) => notesRepo.read(req))
  handle('notes:write', (req) => notesRepo.write(req))
  handle('notes:create', (req) => notesRepo.create(req))

  // -- annotations ----------------------------------------------------------
  handle('annotations:listForFile', (req) => annotationsRepo.listForFile(req))
  handle('annotations:create', (req) => annotationsRepo.create(req))
  handle('annotations:update', (req) => annotationsRepo.update(req))
  handle('annotations:delete', (req) => annotationsRepo.softDelete(req))

  // -- board ----------------------------------------------------------------
  handle('board:listTasks', (req) => boardRepo.list(req))
  handle('board:createTask', (req) => boardRepo.create(req))
  handle('board:updateTask', (req) => boardRepo.update(req))
  handle('board:deleteTask', (req) => boardRepo.softDelete(req))

  // -- chat (M4-H: Claude Code CLI runtime) ---------------------------------
  const chatRepo = createChatRepo(db)
  chatRepo.markDanglingInterrupted()
  const binaryLocator = createBinaryLocator()
  const claudeAdapter = createClaudeCodeAdapter({ locator: binaryLocator })
  const eventBatcher = createEventBatcher({
    send: (batch) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('chat:event-batch', batch)
      }
    }
  })
  const sessionManager = createSessionManager({
    adapter: claudeAdapter,
    repo: chatRepo,
    getCourse: (courseId) => ({
      folder: coursesRepo.getFolder(courseId),
      name: coursesRepo.getById(courseId).name
    }),
    emit: (courseId, event) => eventBatcher.push(courseId, event)
  })
  app.on('before-quit', () => {
    sessionManager.disposeAll()
    eventBatcher.dispose()
  })
  process.on('exit', () => {
    killAllClaudeProcessesSync()
  })

  handle('chat:open', (req) => sessionManager.open(req.courseId))
  handle('chat:send', (req) => sessionManager.send(req.courseId, req.content))
  handle('chat:cancel', (req) => {
    sessionManager.cancel(req.courseId)
    return OK
  })
  handle('chat:respondPermission', (req) => {
    sessionManager.respondPermission(req.courseId, req.requestId, req.response)
    return OK
  })
  handle('chat:close', (req) => {
    sessionManager.close(req.courseId)
    eventBatcher.flush(req.courseId)
    return OK
  })

  // -- agent (M4-H) ---------------------------------------------------------
  handle('agent:availability', async (req) =>
    req.provider === 'claude-code'
      ? binaryLocator.availability()
      : { installed: false, loggedIn: false }
  )

  // -- browser (STUBS — owned by the browser milestone) ---------------------
  handle('browser:createView', () => OK)
  handle('browser:destroyView', () => OK)
  handle('browser:setBounds', () => OK)
  handle('browser:setVisible', () => OK)
  handle('browser:navigate', () => OK)
  handle('browser:back', () => OK)
  handle('browser:forward', () => OK)
  handle('browser:reload', () => OK)

  // -- settings (real implementation, settingsStore-owned) ------------------
  handle('settings:get', () => getSettings())
  handle('settings:set', (req) => setSettings(req))

  // -- layout ---------------------------------------------------------------
  handle('layout:get', (req) => layoutRepo.get(req.courseId))
  handle('layout:save', (req) => layoutRepo.save(req.courseId, req.layout))
}
