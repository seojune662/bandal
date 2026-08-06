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
  createCourseLinksRepo,
  createCoursesRepo,
  folderDisplayName,
  normalizeFolderPath
} from '../features/courses'
import { normalizeHttpUrl } from '../../shared/universities/courseLink'
import { ValidationError } from '../db/errors'
import { createMaterialsRepo, createMaterialsWatcher } from '../features/materials'
import { createNotesRepo } from '../features/notes'
import { createAnnotationsRepo } from '../features/annotations'
import { createDrawingsRepo, createPdfExporter } from '../features/pdf'
import { createBoardRepo } from '../features/board'
import {
  createBinaryLocator,
  createChatRepo,
  createClaudeCodeAdapter,
  createEventBatcher,
  createSessionManager,
  createCodexAdapter,
  createCodexBinaryLocator,
  createAgentInstaller,
  killAllCodexProcessesSync,
  getAgentModels,
  killAllClaudeProcessesSync
} from '../features/agent'
import { createBrowserSessionStore } from '../features/browser'
import { createFavoritesRepo } from '../features/favorites'
import { createGroupRuntime } from '../features/group'
import { isAuthCallbackUrl } from '../features/group/authCallbackUrl'
import { createUpdaterRuntime } from '../features/updater'

/**
 * What `registerHandlers` hands back to `main/index.ts`.
 *
 * Deep links cannot go through `ipcMain` — they arrive from the OS, not the
 * renderer — so this is the one seam that lets `index.ts` reach the group
 * runtime without owning it.
 */
export interface IpcRouter {
  /** Routes a `bandal://` URL. Fire-and-forget; never throws. */
  handleDeepLink(url: string): void
}

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

export function registerHandlers(): IpcRouter {
  const db = getDatabase()
  const coursesRepo = createCoursesRepo({
    db,
    getDataRoot: () => getSettings().dataRoot
  })
  const materialsRepo = createMaterialsRepo({
    db,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    revealItem: (absPath) => shell.showItemInFolder(absPath),
    // Trash, never unlink: these are the student's lecture materials and a
    // mis-click must stay recoverable.
    trashItem: (absPath) => shell.trashItem(absPath)
  })
  const notesRepo = createNotesRepo({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  const courseLinksRepo = createCourseLinksRepo(db)
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

  // -- course links (M8) ----------------------------------------------------
  handle('courseLinks:list', (req) => courseLinksRepo.list(req))
  handle('courseLinks:create', (req) => courseLinksRepo.create(req))
  handle('courseLinks:update', (req) => courseLinksRepo.update(req))
  handle('courseLinks:delete', (req) => courseLinksRepo.delete(req))

  // -- shell ----------------------------------------------------------------
  // Re-validated here rather than trusted from the renderer: this is the one
  // channel that hands a URL to the OS, so anything but http(s) is refused.
  handle('shell:openExternal', async (req) => {
    const url = normalizeHttpUrl(req.url)
    if (url === null) {
      throw new ValidationError('url must be an http(s) URL')
    }
    await shell.openExternal(url)
    return OK
  })

  // -- materials ------------------------------------------------------------
  handle('materials:tree', (req) => materialsRepo.tree(req.courseId))
  handle('materials:search', (req) => materialsRepo.search(req.courseId, req.query))
  handle('materials:import', (req) => materialsRepo.import(req.courseId, req.paths))
  handle('materials:reveal', (req) => materialsRepo.reveal(req.courseId, req.relPath))
  handle('materials:readFile', (req) => materialsRepo.readFile(req.courseId, req.relPath))
  handle('materials:writeFile', (req) => materialsRepo.writeFile(req))
  handle('materials:rename', (req) => materialsRepo.rename(req))
  handle('materials:delete', (req) => materialsRepo.softDelete(req))
  handle('materials:duplicate', (req) => materialsRepo.duplicate(req))
  handle('materials:createFolder', (req) => materialsRepo.createFolder(req))
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

  // -- pdf drawings (M9: free-form markup, kept apart from text highlights) --
  const drawingsRepo = createDrawingsRepo(db)
  handle('drawings:listForFile', (req) =>
    drawingsRepo.listForFile(req.courseId, req.relPath)
  )
  handle('drawings:create', (req) => drawingsRepo.create(req))
  handle('drawings:update', (req) => drawingsRepo.update(req))
  handle('drawings:delete', (req) => {
    drawingsRepo.softDelete(req.ids)
    return OK
  })

  // Export burns markup into a NEW file — the source pdf is never written to.
  const pdfExporter = createPdfExporter({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    listDrawings: (courseId, relPath) =>
      drawingsRepo.listForFile(courseId, relPath),
    listAnnotations: (courseId, relPath) =>
      annotationsRepo.listForFile({ courseId, relPath })
  })
  handle('pdf:exportAnnotated', async (req) => {
    const baseName = req.relPath.split('/').pop() ?? 'document.pdf'
    const suggested = baseName.replace(/\.pdf$/i, '') + ' (주석).pdf'
    const result = await dialog.showSaveDialog({
      title: '주석 포함 PDF로 내보내기',
      defaultPath: suggested,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || result.filePath === undefined) {
      return { savedPath: null }
    }
    await pdfExporter.exportAnnotated(req, result.filePath)
    return { savedPath: result.filePath }
  })

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
  const codexLocator = createCodexBinaryLocator()
  const codexAdapter = createCodexAdapter({ locator: codexLocator })

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
    codexSessionManager.disposeAll()
    eventBatcher.dispose()
  })
  process.on('exit', () => {
    killAllClaudeProcessesSync()
    killAllCodexProcessesSync()
  })

  // [M10] Two providers now. The session manager is per-adapter, so the
  // active one is resolved per call from settings rather than captured once —
  // switching providers in settings must take effect on the next message, not
  // on the next app launch.
  const codexSessionManager = createSessionManager({
    adapter: codexAdapter,
    repo: chatRepo,
    getCourse: (courseId) => ({
      folder: coursesRepo.getFolder(courseId),
      name: coursesRepo.getById(courseId).name
    }),
    emit: (courseId, event) => eventBatcher.push(courseId, event)
  })
  const activeSessions = (): typeof sessionManager =>
    getSettings().agentProvider === 'codex' ? codexSessionManager : sessionManager

  handle('chat:open', (req) => activeSessions().open(req.courseId))
  handle('chat:send', (req) =>
    activeSessions().send(req.courseId, req.content, req.attachments)
  )
  handle('chat:cancel', (req) => {
    activeSessions().cancel(req.courseId)
    return OK
  })
  handle('chat:respondPermission', (req) => {
    activeSessions().respondPermission(req.courseId, req.requestId, req.response)
    return OK
  })
  handle('chat:close', (req) => {
    activeSessions().close(req.courseId)
    eventBatcher.flush(req.courseId)
    return OK
  })
  handle('chat:setModel', (req) => {
    activeSessions().setModel(req.courseId, req.model)
    return OK
  })

  // -- agent (M4-H) ---------------------------------------------------------
  handle('agent:availability', async (req) =>
    req.provider === 'codex'
      ? codexLocator.availability()
      : binaryLocator.availability()
  )

  // Installers mutate the machine outside the app sandbox, so `agent:install`
  // is only ever reached from an explicit click after the UI has shown the
  // exact command from `agent:installCommand`.
  const agentInstaller = createAgentInstaller({
    broadcast: (progress) => broadcast('agent:install-progress', progress)
  })
  handle('agent:installCommand', (req) => agentInstaller.commandFor(req.provider))
  handle('agent:install', (req) => agentInstaller.install(req.provider))
  handle('agent:models', (req) => getAgentModels(req.provider))

  // -- favorites (left-rail pins for any TabDescriptor) ---------------------
  const favoritesRepo = createFavoritesRepo(db)
  handle('favorites:list', (req) => favoritesRepo.list(req.courseId))
  handle('favorites:add', (req) => favoritesRepo.add(req))
  handle('favorites:rename', (req) => favoritesRepo.rename(req))
  handle('favorites:remove', (req) => {
    favoritesRepo.softDelete(req.id)
    return OK
  })
  handle('favorites:reorder', (req) => {
    favoritesRepo.reorder(req)
    return OK
  })

  // -- browser session ------------------------------------------------------
  // Restore / auto-persist / before-quit are already wired inside
  // hardenBrowsingSession; this factory returns that same singleton, so only
  // the IPC surface is left to connect.
  const browserSessions = createBrowserSessionStore()
  handle('browser:sessionSites', async () => ({
    sites: await browserSessions.listSites()
  }))
  handle('browser:clearSession', (req) => browserSessions.clear(req.origin))

  // -- settings (real implementation, settingsStore-owned) ------------------
  handle('settings:get', () => getSettings())
  handle('settings:set', (req) => setSettings(req))

  // -- layout ---------------------------------------------------------------
  handle('layout:get', (req) => layoutRepo.get(req.courseId))
  handle('layout:save', (req) => layoutRepo.save(req.courseId, req.layout))

  // -- groups (P2-C) --------------------------------------------------------
  // Everything above this line is Phase 1 and is UNCHANGED by Phase 2 — that
  // is a hard rule, not a convention (docs/phase2-community.md §1.4-1).
  //
  // `groupRuntime` is a factory, not an instance: the Supabase client, the
  // encrypted session file and the realtime channels are built on the first
  // invoke below and never on the boot path. An app that is logged out,
  // offline or built without keys behaves exactly as it did in Phase 1.
  const groupRuntime = createGroupRuntime({
    db,
    broadcastAuth: (state) => broadcast('auth:changed', state),
    broadcastBatch: (batch) => broadcast('group:event-batch', batch),
    broadcastInvalidated: (reason) => broadcast('groups:invalidated', { reason })
  })
  const groups = (): ReturnType<typeof groupRuntime.service> =>
    groupRuntime.service()

  app.on('before-quit', () => {
    groupRuntime.dispose()
  })
  app.on('browser-window-blur', () => {
    if (groupRuntime.isStarted()) groups().setWindowFocused(false)
  })
  app.on('browser-window-focus', () => {
    if (groupRuntime.isStarted()) groups().setWindowFocused(true)
  })

  // auth
  handle('auth:getState', () => groups().getAuthState())
  handle('auth:signIn', (req) => groups().signIn(req.provider))
  handle('auth:signOut', async () => {
    await groups().signOut()
    return OK
  })
  handle('auth:setNickname', (req) => groups().setNickname(req.nickname))
  handle('auth:setAvatar', (req) => {
    const patch: { color?: string; emoji?: string } = {}
    if (req.color !== undefined) patch.color = req.color
    if (req.emoji !== undefined) patch.emoji = req.emoji
    return groups().setAvatar(patch)
  })

  // groups
  handle('groups:list', () => groups().listGroups())
  handle('groups:create', (req) => {
    const input: { name: string; color: string; courseId?: string } = {
      name: req.name,
      color: req.color
    }
    if (req.courseId !== undefined) input.courseId = req.courseId
    return groups().createGroup(input)
  })
  // ⚠ join returns `{ ok: false }` for rejections instead of throwing — the
  // rate-limit rows have to COMMIT, and a raise would roll them back
  // (supabase/README.md §8-②).
  handle('groups:joinWithCode', (req) => groups().joinWithCode(req.code))
  handle('groups:currentCode', (req) => groups().currentCode(req.groupId))
  handle('groups:regenerateCode', (req) =>
    groups().regenerateCode(req.groupId, req.maxUses ?? 0)
  )
  handle('groups:linkCourse', (req) =>
    groups().linkCourse(req.groupId, req.courseId)
  )
  handle('groups:leave', async (req) => {
    await groups().leaveGroup(req.groupId)
    return OK
  })
  handle('groups:members', (req) => groups().members(req.groupId))
  handle('groups:kick', async (req) => {
    await groups().kick(req.groupId, req.userId)
    return OK
  })

  // invites / friends
  handle('groups:inviteByNickname', (req) =>
    groups().inviteByNickname(req.groupId, req.nickname)
  )
  handle('groups:findProfile', (req) => groups().findProfile(req.nickname))
  handle('invites:listPending', () => groups().listPendingInvites())
  handle('invites:respond', async (req) => ({
    status: await groups().respondInvite(req.inviteId, req.accept)
  }))
  handle('friends:list', () => groups().listFriends())
  handle('friends:request', (req) => groups().requestFriend(req.nickname))
  handle('friends:respond', async (req) => ({
    status: await groups().respondFriend(req.requesterId, req.accept)
  }))

  // group chat
  handle('groupChat:open', (req) => groups().openChat(req.groupId))
  handle('groupChat:send', (req) =>
    groups().send(req.groupId, req.body, req.replyTo)
  )
  handle('groupChat:loadOlder', (req) =>
    groups().loadOlder(req.groupId, req.beforeSeq, req.limit)
  )
  handle('groupChat:markRead', async (req) => {
    await groups().markRead(req.groupId, req.seq)
    return OK
  })
  handle('groupChat:retry', (req) => {
    groups().retry(req.localId)
    return OK
  })
  handle('groupChat:deleteMessage', async (req) => {
    await groups().deleteMessage(req.messageId)
    return OK
  })
  handle('groupChat:close', (req) => {
    groups().closeChat(req.groupId)
    return OK
  })

  // safety
  handle('safety:block', async (req) => {
    await groups().block(req.userId, req.blocked)
    return OK
  })
  handle('safety:report', async (req) => {
    await groups().report({
      targetType: req.targetType,
      targetId: req.targetId,
      reason: req.reason
    })
    return OK
  })

  // -- auto update ----------------------------------------------------------
  // Constructed eagerly (unlike groupRuntime): it owns the periodic check, and
  // in an unpackaged build the factory returns an inert stub anyway.
  const updater = createUpdaterRuntime({
    broadcast: (status) => broadcast('update:changed', status)
  })
  app.on('before-quit', () => {
    updater.dispose()
  })

  handle('update:status', () => updater.status())
  handle('update:check', () => updater.check())
  handle('update:download', () => updater.download())
  handle('update:install', () => ({ ok: updater.install() }))

  return {
    handleDeepLink(url) {
      // Checked HERE so an unrelated `bandal://` route never constructs the
      // Supabase client — the laziness rule (§1.4-2) survives deep links.
      if (!isAuthCallbackUrl(url)) return
      void groups()
        .handleDeepLink(url)
        .catch((error: unknown) => {
          console.error('[ipc] deep link handling failed', error)
        })
    }
  }
}
