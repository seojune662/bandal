/**
 * Registers a handler for EVERY channel in IpcContract.
 *
 * M1-A: courses / materials / notes / annotations / board / layout are real
 * implementations backed by src/main/features/* repos and the SQLite DB.
 * M4-H added the chat/agent runtime, M5 the materials watcher; the browser
 * runs as a renderer <webview> and needs no invoke channels here. Keep the
 * section comments so merges stay additive.
 */

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse } from '../../shared/ipc/contract'
import type { PushChannel, PushPayload } from '../../shared/ipc/events'
import { getSettings, setSettings } from '../settingsStore'
import { getDatabase } from '../db/database'
import { createLayoutRepo } from '../db/layoutRepo'
import {
  createCoursesRepo,
  folderDisplayName,
  normalizeFolderPath
} from '../features/courses'
import { createMaterialsRepo, createMaterialsWatcher } from '../features/materials'
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

/** Sends a push event to every open window. */
function broadcast<K extends PushChannel>(
  channel: K,
  payload: PushPayload<K>
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

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

  const materialsWatcher = createMaterialsWatcher({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    onChange: (courseId) => broadcast('materials:changed', { courseId })
  })

  /** Course went away (delete/archive) → release its live resources. */
  function releaseCourseRuntime(courseId: string): void {
    materialsWatcher.unwatch(courseId)
    sessionManager.close(courseId)
    eventBatcher.flush(courseId)
  }

  // -- courses --------------------------------------------------------------
  handle('courses:list', (req) => coursesRepo.list(req))
  handle('courses:create', (req) => coursesRepo.create(req))
  handle('courses:pickFolder', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = {
      title: '과목 폴더 선택',
      buttonLabel: '이 폴더 사용',
      properties: ['openDirectory', 'createDirectory']
    }
    const result =
      parent === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(parent, options)
    const picked = result.filePaths[0]
    if (result.canceled || picked === undefined) return null
    const path = normalizeFolderPath(picked)
    return { path, name: folderDisplayName(path) }
  })
  handle('courses:addFromFolder', (req) => coursesRepo.addFromFolder(req))
  handle('courses:relink', (req) => {
    const result = coursesRepo.relink(req)
    if (result.status === 'ok') {
      // The folder (and therefore the agent cwd) moved — drop everything that
      // was bound to the old path so the next watch/chat attaches to the new one.
      releaseCourseRuntime(req.courseId)
    }
    return result
  })
  handle('courses:rename', (req) => coursesRepo.rename(req))
  handle('courses:archive', (req) => {
    const course = coursesRepo.archive(req)
    if (req.archived) releaseCourseRuntime(req.courseId)
    return course
  })
  handle('courses:delete', (req) => {
    const result = coursesRepo.softDelete(req)
    releaseCourseRuntime(req.courseId)
    return result
  })

  // -- materials ------------------------------------------------------------
  handle('materials:tree', (req) => materialsRepo.tree(req.courseId))
  handle('materials:search', (req) => materialsRepo.search(req.courseId, req.query))
  handle('materials:import', (req) => materialsRepo.import(req.courseId, req.paths))
  handle('materials:reveal', (req) => materialsRepo.reveal(req.courseId, req.relPath))
  handle('materials:readFile', (req) => materialsRepo.readFile(req.courseId, req.relPath))
  handle('materials:watch', (req) => {
    materialsWatcher.watch(req.courseId)
    return OK
  })
  handle('materials:unwatch', (req) => {
    materialsWatcher.unwatch(req.courseId)
    return OK
  })

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
    send: (batch) => broadcast('chat:event-batch', batch)
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
    materialsWatcher.dispose()
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

  // -- settings (real implementation, settingsStore-owned) ------------------
  handle('settings:get', () => getSettings())
  handle('settings:set', (req) => setSettings(req))

  // -- layout ---------------------------------------------------------------
  handle('layout:get', (req) => layoutRepo.get(req.courseId))
  handle('layout:save', (req) => layoutRepo.save(req.courseId, req.layout))
}
