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
import { IPC_CHANNELS } from '../../shared/ipc/contract'
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
import { createActivityRepo, createContextWriter } from '../features/context'
import { createStudyRunner } from '../features/study'
import {
  createWhiteboardRepo,
  createWhiteboardService
} from '../features/whiteboard'
import { createCanvasRepo } from '../features/canvas'
import { createSearchIndex } from '../features/search'
import { createInsights } from '../features/insights'
import { createLinkService } from '../features/link'
import {
  createGroupNoteSharingService,
  createGroupRuntime
} from '../features/group'
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
const registered = new Set<IpcChannel>()

/**
 * Boot-time guard: every contract channel must have a handler.
 *
 * `handle()` type-checks each registration individually, but nothing tied the
 * SET of registrations to the contract — a declared-but-unhandled channel
 * compiled fine and only failed in the user's hands with "No handler
 * registered for ...". This runs before the window is created, so the gap
 * becomes a loud startup failure instead of one broken button.
 */
function assertEveryChannelHandled(): void {
  const missing = IPC_CHANNELS.filter((channel) => !registered.has(channel))
  if (missing.length > 0) {
    throw new Error(
      `[ipc] ${missing.length} channel(s) declared in IpcContract have no handler: ${missing.join(', ')}`
    )
  }
}

function handle<K extends IpcChannel>(
  channel: K,
  fn: (req: IpcRequest<K>) => Promise<IpcResponse<K>> | IpcResponse<K>
): void {
  registered.add(channel)
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

/**
 * How long quitting waits for in-flight IPC to land. Long enough for a message
 * already on the wire, short enough that ⌘Q still feels instant.
 */
const QUIT_DRAIN_MS = 150

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
  handle('materials:import', (req) => {
    const result = materialsRepo.import(req.courseId, req.paths)
    note(req.courseId, 'material-added', `자료 ${req.paths.length}개를 가져왔습니다.`)
    return result
  })
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
  handle('notes:write', (req) => {
    const result = notesRepo.write(req)
    note(req.courseId, 'note-edited', `필기를 수정했습니다: ${req.relPath}`, req.relPath)
    return result
  })
  handle('notes:create', (req) => {
    const result = notesRepo.create(req)
    note(req.courseId, 'note-created', `필기를 만들었습니다: ${result.relPath}`, result.relPath)
    return result
  })

  // -- annotations ----------------------------------------------------------
  handle('annotations:listForFile', (req) => annotationsRepo.listForFile(req))
  handle('annotations:create', (req) => {
    const result = annotationsRepo.create(req)
    // The quote is the single best signal of what the student found important.
    note(
      req.courseId,
      'highlight-created',
      `${req.relPath} ${req.page}쪽을 강조했습니다: "${req.anchor.quote}"`,
      req.relPath
    )
    return result
  })
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

  // -- course activity + AI context ------------------------------------------
  //
  // Recording lives HERE rather than in each feature repo on purpose: every
  // action worth remembering already funnels through this file, so one place
  // stays consistent instead of a `record()` call scattered across a dozen
  // modules that later drift.
  //
  // Every call is best-effort. A failed activity write must never break the
  // action the student actually asked for.
  const activityRepo = createActivityRepo(db)
  const insights = createInsights({
    db,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  const contextWriter = createContextWriter({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    getCourse: (courseId) => ({ name: coursesRepo.getById(courseId).name }),
    activity: activityRepo,
    db,
    // Injected rather than read inside the dossier so the context feature does
    // not depend on board/insights. This is the only forward-looking part of
    // the dossier — it turns "summarise this PDF" into "the exam is in 12 days
    // and week 3 is still unopened".
    getUpcomingDeadlines: (courseId) =>
      boardRepo.upcoming({ courseId, withinDays: 30, limit: 8 }),
    getStudyGaps: (courseId) => insights.gaps(courseId)
  })
  const note = (
    courseId: string,
    kind: Parameters<typeof activityRepo.record>[0]['kind'],
    summary: string,
    relPath: string | null = null
  ): void => {
    try {
      activityRepo.record({ courseId, kind, relPath, summary })
    } catch (error) {
      console.error('[activity] failed to record', kind, error)
    }
  }

  handle('activity:record', (req) => {
    note(req.courseId, req.kind, req.summary, req.relPath ?? null)
    return OK
  })
  handle('activity:recent', (req) =>
    activityRepo.recent(req.courseId, req.limit)
  )
  handle('context:rebuild', (req) => contextWriter.rebuild(req.courseId))

  // -- board ----------------------------------------------------------------
  handle('board:listTasks', (req) => boardRepo.list(req))
  handle('board:createTask', (req) => {
    const result = boardRepo.create(req)
    if (req.courseId != null) {
      note(req.courseId, 'task-created', `할 일을 추가했습니다: ${req.title}`)
    }
    return result
  })
  handle('board:updateTask', (req) => boardRepo.update(req))
  handle('calendar:range', (req) => boardRepo.listRange(req))
  handle('calendar:upcoming', (req) => boardRepo.upcoming(req))
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

  // Refresh the dossier the agent reads before the session can ask for it.
  // Best-effort: a context failure must not stop the student from chatting.
  handle('chat:open', (req) => {
    try {
      contextWriter.rebuild(req.courseId)
    } catch (error) {
      console.error('[context] rebuild failed', error)
    }
    return activeSessions().open(req.courseId)
  })
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
  // -- AI study tools --------------------------------------------------------
  // The recipes run through the course's normal agent session and write their
  // answer into the course folder, so a result is editable, survives the
  // session, and becomes context for later questions.
  const studyRunner = createStudyRunner({
    getCourse: (courseId) => ({
      name: coursesRepo.getById(courseId).name,
      folder: coursesRepo.getFolder(courseId)
    }),
    ask: async (courseId, prompt) => {
      await activeSessions().send(courseId, prompt)
    },
    recordActivity: (courseId, summary, relPath) => {
      note(courseId, 'study-tool-run', summary, relPath)
    }
  })
  handle('study:tools', () => ({ tools: studyRunner.tools() }))
  handle('study:run', (req) => studyRunner.run(req))

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

  // -- group whiteboard ------------------------------------------------------
  // Borrows the group runtime's Supabase client: a second client would carry a
  // second session and the two could disagree about who is signed in.
  const whiteboardRepo = createWhiteboardRepo(db)
  const whiteboardService = createWhiteboardService({
    repo: whiteboardRepo,
    getClient: () => groupRuntime.getClient(),
    getUserId: () => groupRuntime.getUserId(),
    emit: (groupId, event) => broadcast('whiteboard:changed', { groupId, event })
  })
  handle('whiteboard:open', (req) => whiteboardService.open(req.groupId))
  handle('whiteboard:addShape', (req) => whiteboardService.addShape(req))
  handle('whiteboard:updateShape', (req) => whiteboardService.updateShape(req))
  handle('whiteboard:close', (req) => {
    whiteboardService.close(req.groupId)
    return OK
  })
  handle('whiteboard:removeShapes', (req) =>
    whiteboardService.removeShapes(req)
  )
  handle('whiteboard:sync', (req) =>
    whiteboardService.sync(req.boardId, req.since)
  )

  // -- personal whiteboards (local only) -------------------------------------
  // `canvas:` and not `board:` — the latter already means the study TASK board.
  const canvasRepo = createCanvasRepo(db)
  handle('canvas:list', (req) => canvasRepo.listBoards(req.courseId))
  handle('canvas:create', (req) => canvasRepo.createBoard(req))
  handle('canvas:rename', (req) => canvasRepo.renameBoard(req))
  handle('canvas:remove', (req) => {
    canvasRepo.removeBoard(req.id)
    return OK
  })
  handle('canvas:open', (req) => canvasRepo.open(req.boardId))
  handle('canvas:putShape', (req) => canvasRepo.putShape(req))
  handle('canvas:removeShapes', (req) => {
    canvasRepo.removeShapes(req)
    return OK
  })

  // -- note <-> material links -------------------------------------------------
  // The note stays plain markdown; the link is an ordinary markdown link with
  // a bandal: target, so the file still opens correctly in any other editor.
  const linkService = createLinkService({
    notes: notesRepo,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  handle('link:sendHighlightToNote', (req) => {
    const result = linkService.sendHighlightToNote(req)
    note(
      req.courseId,
      'note-edited',
      `하이라이트를 필기로 보냈습니다: ${result.relPath}`,
      result.relPath
    )
    return result
  })

  // -- full-text search + study gaps -----------------------------------------
  // The index is a rebuildable cache, not user data — same status as
  // materials_index — so it owns its own tables instead of a migration.
  const searchIndex = createSearchIndex(db, {
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  handle('search:query', (req) => {
    // Notes and text files are cheap to re-read; PDFs arrive from the renderer.
    searchIndex.refreshTextFiles(req.courseId)
    return { hits: searchIndex.query(req.courseId, req.query, req.limit) }
  })
  handle('search:indexPdfPages', (req) => {
    searchIndex.indexPdfPages(req)
    return OK
  })

  handle('insights:gaps', (req) => ({ gaps: insights.gaps(req.courseId) }))

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

  // Give queued IPC one turn of the event loop before the process goes away.
  //
  // `notes:write` is synchronous once its handler runs, so a note is safe the
  // moment main *handles* the message. The gap is earlier: the renderer's
  // autosave fires `invoke('notes:write')` and the app can quit while that
  // message is still in flight, which loses the student's last edit with no
  // error anywhere. The renderer cannot close this on its own.
  //
  // This is a mitigation, not a guarantee — it does not survive SIGKILL or a
  // crash. It does cover the ordinary "⌘Q right after typing" case, which is
  // the one students actually hit.
  let quitDrained = false
  app.on('before-quit', (event) => {
    if (quitDrained) return
    quitDrained = true
    event.preventDefault()
    setTimeout(() => {
      app.quit()
    }, QUIT_DRAIN_MS)
  })

  // Lazy `getGroupService` on purpose: building the router must not wake the
  // group runtime, which would open the OS keychain at launch.
  const noteSharing = createGroupNoteSharingService({
    notesRepo,
    getGroupService: () => groupRuntime.service(),
    getCourseName: (courseId) => coursesRepo.getById(courseId).name
  })
  handle('group:shareNote', (req) => noteSharing.shareNote(req))
  handle('group:saveSharedNote', (req) => noteSharing.saveSharedNote(req))

  app.on('before-quit', () => {
    whiteboardService.dispose()
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

  assertEveryChannelHandled()

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
