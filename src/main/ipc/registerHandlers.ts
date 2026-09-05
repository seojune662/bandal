/**
 * Registers a handler for EVERY channel in IpcContract.
 *
 * M1-A: courses / materials / notes / annotations / board / layout are real
 * implementations backed by src/main/features/* repos and the SQLite DB.
 * M4-H added the chat/agent runtime, M5 the materials watcher; the browser
 * runs as a renderer <webview> and needs no invoke channels here. Keep the
 * section comments so merges stay additive.
 */

import { randomUUID } from 'node:crypto'
import {
  accessSync,
  constants as fsConstants,
  mkdirSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  session,
  shell,
  webContents
} from 'electron'
import type { NativeImage } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/contract'
import { resolveInside } from '../db/validate'
import { matchCourseByUrl } from '../../shared/universities/matchCourseByUrl'
import { resolveUniversity } from '../../shared/universities'
import type { LmsPlatform } from '../../shared/types/university'
import { TARGET_INDEX_SOURCE } from '../features/browserAgent/snapshot'
import {
  createAuditRepo,
  createBrowserTools,
  createGrantsRepo,
  createGuestRegistry,
  createPageSurface,
  createRunRegistry,
  insertText,
  setFileInputFiles,
  createSeenRepo,
  GenerationTracker
} from '../features/browserAgent'
import type { IpcChannel, IpcRequest, IpcResponse } from '../../shared/ipc/contract'
import type { PushChannel, PushPayload } from '../../shared/ipc/events'
import type { AgentAppState } from '../../shared/types/agentTools'
import type { AgentProvider, Usage } from '../../shared/types/agent-events'
import { isUsageWindowDays } from '../../shared/types/usage'
import type { ScreenPermissionState } from '../../shared/types/overlay'
import type { Settings, SettingsPatch } from '../../shared/types/settings'
import {
  getSettings,
  resetSettings,
  setSettings as persistSettings
} from '../settingsStore'
import { getDatabase } from '../db/database'
import { createLayoutRepo } from '../db/layoutRepo'
import {
  createCourseGroupsRepo,
  createCourseLinksRepo,
  createCoursesRepo,
  folderDisplayName,
  normalizeFolderPath
} from '../features/courses'
import { normalizeHttpUrl } from '../../shared/universities/courseLink'
import { isTabDescriptor } from '../../shared/tabs'
import { ValidationError } from '../db/errors'
import { PRINT_PDF_MAX_BYTES, printPdfBytes } from '../features/print'
import { setPrintMenuEnabled } from '../menu'
import {
  createMaterialsRepo,
  createMaterialsWatcher,
  createMediaProgressRepo,
  createMediaProtocolHandler,
  MEDIA_SCHEME
} from '../features/materials'
import { DRAG_ICON_PNG_BASE64 } from './dragIcon'
import { createPdfViewStateRepo } from '../features/pdf/pdfViewStateRepo'
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
  createGeminiAdapter,
  createGeminiBinaryLocator,
  createAgentInstaller,
  createLoginLauncher,
  killAllCodexProcessesSync,
  killAllGeminiProcessesSync,
  getAgentModels,
  killAllClaudeProcessesSync,
  serializeTranscript,
  CARRYOVER_HISTORY_LIMIT
} from '../features/agent'
import { createUsageRepo } from '../features/usage/usageRepo'
import { runtimeSafeStorage } from '../lib/safeStorageGate'
import {
  attachDownloadHandler,
  BROWSING_PARTITION,
  createBrowserSessionStore,
  downloadControls,
  createPermissionsRepo,
  useSitePermissions,
  createFaviconFetcher,
  createHistoryRepo,
  fetchLinkForMaterials
} from '../features/browser'
import { createFavoritesRepo } from '../features/favorites'
import {
  createCredentialStore,
  createLoginCapturer,
  createLoginFiller
} from '../features/credentials'
import { createActivityRepo, createContextWriter } from '../features/context'
import {
  createPackRunner,
  createPackRunGuard,
  createPackStore
} from '../features/workflowPacks'
import {
  createWhiteboardRepo,
  createWhiteboardService
} from '../features/whiteboard'
import { createBoardPdfExporter, createCanvasRepo } from '../features/canvas'
import { createSearchIndex } from '../features/search'
import { createInsights } from '../features/insights'
import { createLinkService } from '../features/link'
import { createLinkIndex } from '../features/links'
import { createMaterialLinksRepo } from '../features/links/materialLinksRepo'
import { repointMaterialPath } from '../features/links/renameRepoint'
import {
  createGroupNoteSharingService,
  createGroupRuntime
} from '../features/group'
import { isAuthCallbackUrl } from '../features/group/authCallbackUrl'
import {
  createFeedbackRateGuard,
  createFeedbackService
} from '../features/feedback/feedbackService'
import { createUpdaterRuntime, resolveAppVersion } from '../features/updater'
import {
  createAgentConfirmer,
  createAgentJournal,
  parseMaterialEditTargetId,
  restoreMaterialBackup,
  startAgentToolsServer
} from '../features/agentTools'
import {
  createDesktopAuditRepo,
  createDesktopGrantsRepo,
  createDesktopRunRegistry,
  createDesktopSurface,
  createDesktopTools,
  createElectronDesktopDeps,
  type ScreenAccess
} from '../features/desktopAgent'
import { createMcpRegistry, testMcpServer } from '../features/mcpRegistry'
import { isMethodAllowed } from '../../shared/plugins/permissions'
import { createPluginApi } from '../features/plugins/pluginApi'
import { createPluginDataStore } from '../features/plugins/pluginDataStore'
import { createPluginLog } from '../features/plugins/pluginLog'
import {
  configurePluginPanels,
  postPluginPanelMessage
} from '../features/plugins/pluginPanels'
import { createPluginRateLimiter } from '../features/plugins/rateLimit'
import { createPluginRuntime } from '../features/plugins/pluginRuntime'
import { createPluginStore } from '../features/plugins/pluginStore'
import { createCatalogService } from '../features/plugins/catalog/catalogService'
import { createCatalogInstaller } from '../features/plugins/catalog/catalogInstall'
import {
  createDeadlineScheduler,
  createSystemNotifier
} from '../features/notifications'
import type { OverlayController } from '../windows/overlayController'
import {
  createMiniPlayerController,
  type MiniPlayerController
} from '../windows/miniPlayerController'

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
  miniPlayer: MiniPlayerController
}

export interface RegisterHandlersDeps {
  overlay: OverlayController
  /** Bootstrap wrapper that fans persisted settings changes out to main UI. */
  setSettings?: (patch: SettingsPatch) => Settings
  preloadPath: string
  pluginPanelPreloadPath: string
  userDataPath: string
  windowBackground(): string
  openMaterial(payload: PushPayload<'ui:openMaterial'>): void
  openUrl(payload: PushPayload<'ui:openUrl'>): void
  openInTab(url: string): void
  consumePendingOpen(): IpcResponse<'ui:consumePendingOpen'>
  onMiniPlayerStateChanged?(open: boolean): void
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
 * [드래그아웃] startDrag 는 드래그 제스처와 같은 틱에 동기로 불러야 한다 —
 * app.getFileIcon 을 기다렸다가 부르면 제스처가 끝나 드래그가 조용히 죽는다.
 * 그래서 인라인 PNG 기본 아이콘으로 즉시 시작하고, 진짜 파일 아이콘은
 * 드래그 시작 "후" 비동기로 받아 확장자별 캐시에 채워 다음 드래그에 쓴다.
 *
 * 주의: startDrag 는 빈 이미지에 throw 하므로 폴백은 반드시 디코드 가능한
 * PNG 여야 한다 (tests/main/dragIcon.test.ts 가 상수를 검증한다).
 */
const FALLBACK_DRAG_ICON = nativeImage.createFromBuffer(
  Buffer.from(DRAG_ICON_PNG_BASE64, 'base64')
)
const dragIconCache = new Map<string, NativeImage>()

/**
 * How long quitting waits for in-flight IPC to land. Long enough for a message
 * already on the wire, short enough that ⌘Q still feels instant.
 */
const QUIT_DRAIN_MS = 150

/** Sends a push event to every open window. */
export function broadcast<K extends PushChannel>(
  channel: K,
  payload: PushPayload<K>
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    try {
      win.webContents.send(channel, payload)
    } catch (error) {
      // One closing/broken window must not prevent the remaining windows from
      // receiving the event or turn a successful mutation into an IPC failure.
      console.error(`[ipc] ${channel} broadcast failed:`, error)
    }
  }
}

function screenPermissionState(access: ScreenAccess): ScreenPermissionState {
  if (access === 'granted') return 'granted'
  if (access === 'denied' || access === 'restricted') return 'denied'
  if (access === 'not-determined') return 'unknown'
  if (process.platform === 'win32') return 'granted'
  return 'unsupported'
}

export function registerHandlers(deps: RegisterHandlersDeps): IpcRouter {
  const db = getDatabase()
  const usageRepo = createUsageRepo(db)
  const setSettings = deps.setSettings ?? persistSettings
  const notifier = createSystemNotifier(getSettings)
  const desktopGrants = createDesktopGrantsRepo(db)
  const desktopAudit = createDesktopAuditRepo(db)
  const desktopRun = createDesktopRunRegistry({
    emit: (payload) => broadcast('desktopAgent:run-state', payload)
  })
  const desktopSurface = createDesktopSurface(
    createElectronDesktopDeps({
      concealOverlay: () => deps.overlay.concealForCapture()
    })
  )
  const mcpRegistry = createMcpRegistry({
    safeStorage: runtimeSafeStorage(),
    userDataPath: app.getPath('userData')
  })
  deps.overlay.setScreenPermission(
    screenPermissionState(desktopSurface.access())
  )
  const coursesRepo = createCoursesRepo({
    db,
    getDataRoot: () => getSettings().dataRoot
  })
  const onMaterialPathChanged = (change: {
    courseId: string
    fromRelPath: string
    toRelPath: string
    isDirectory: boolean
  }): void => {
    repointMaterialPath({
      ...change,
      db,
      courseFolder: coursesRepo.getFolder(change.courseId)
    })
    // Notes bypass materialsRepo, and a rewritten backlink can change more
    // than the renamed path. Invalidate before telling renderers to re-read.
    materialsRepo.invalidateTree(change.courseId)
    broadcast('materials:changed', { courseId: change.courseId })
  }
  const materialsRepo = createMaterialsRepo({
    db,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    revealItem: (absPath) => shell.showItemInFolder(absPath),
    // Trash, never unlink: these are the student's lecture materials and a
    // mis-click must stay recoverable.
    trashItem: (absPath) => shell.trashItem(absPath),
    onPathChanged: onMaterialPathChanged
  })
  const notesRepo = createNotesRepo({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    onPathChanged: onMaterialPathChanged
  })
  const courseLinksRepo = createCourseLinksRepo(db)
  const materialLinksRepo = createMaterialLinksRepo(db)
  const annotationsRepo = createAnnotationsRepo(db)
  const boardRepo = createBoardRepo(db)
  const layoutRepo = createLayoutRepo(db)
  const deadlineScheduler = createDeadlineScheduler({
    db,
    getSettings,
    setSettings,
    notifier,
    onError: (error) => console.error('[notifications] deadline scheduler failed', error)
  })
  // Plugin event producers are registered before the runtime is constructed.
  // Keeping this indirection local avoids moving the long-established course
  // and note handlers merely to satisfy initialization order.
  let emitPluginEvent: (
    name: 'note:saved' | 'course:changed',
    payload: unknown
  ) => void = () => undefined

  const materialsWatcher = createMaterialsWatcher({
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    onChange: (courseId) => {
      // 브로드캐스트보다 먼저 캐시를 비운다 — 렌더러의 조용한 재조회가
      // 반드시 새 트리를 보게 하기 위한 순서다.
      materialsRepo.invalidateTree(courseId)
      broadcast('materials:changed', { courseId })
    }
  })

  // [bandal-media] 동영상 스트리밍 프로토콜. 스킴 특권 등록은 index.ts 가
  // whenReady 전에 마쳤고, 핸들러는 materialsRepo 의 경로 가드를 재사용하므로
  // 여기(레포 생성 직후)에서 등록한다. registerHandlers 는 앱당 한 번 불린다.
  protocol.handle(
    MEDIA_SCHEME,
    createMediaProtocolHandler({
      absolutePathFor: (courseId, relPath) =>
        materialsRepo.absolutePathFor(courseId, relPath)
    })
  )

  /** Course went away (delete/archive) → release its live resources. */
  function releaseCourseRuntime(courseId: string): void {
    materialsWatcher.unwatch(courseId)
    // Sessions are conversation-keyed now: close every conversation of the
    // course on all managers (only ones with messages can hold a warm CLI).
    for (const conversation of chatRepo.listConversations(courseId)) {
      sessionManager.close(courseId, conversation.id)
      codexSessionManager.close(courseId, conversation.id)
      geminiSessionManager.close(courseId, conversation.id)
      eventBatcher.flush(conversation.id)
    }
  }

  // -- courses --------------------------------------------------------------
  handle('courses:list', (req) => coursesRepo.list(req))
  /**
   * Broadcast on every course mutation, not just the agent's.
   * Two windows can be open, and the assistant can now change the list from
   * outside whichever one the student is looking at.
   */
  function courseListChanged<T>(result: T): T {
    broadcast('courses:changed', {})
    emitPluginEvent('course:changed', {})
    return result
  }
  handle('courses:create', (req) => courseListChanged(coursesRepo.create(req)))
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
  handle('courses:addFromFolder', (req) =>
    courseListChanged(coursesRepo.addFromFolder(req))
  )
  handle('courses:relink', (req) => {
    const result = coursesRepo.relink(req)
    if (result.status === 'ok') {
      // The folder (and therefore the agent cwd) moved — drop everything that
      // was bound to the old path so the next watch/chat attaches to the new one.
      releaseCourseRuntime(req.courseId)
      return courseListChanged(result)
    }
    return result
  })
  handle('courses:rename', (req) => courseListChanged(coursesRepo.rename(req)))
  handle('courses:setColor', (req) =>
    courseListChanged(coursesRepo.setColor(req))
  )
  handle('courses:archive', (req) => {
    const course = coursesRepo.archive(req)
    if (req.archived) releaseCourseRuntime(req.courseId)
    return courseListChanged(course)
  })
  handle('courses:purge', async (req) => {
    const { folderPath } = coursesRepo.purge(req)
    // Trash, never unlink: even the tutorial's own folder stays recoverable.
    // The DB row removal above is the invariant; a trash failure only logs.
    try {
      await shell.trashItem(folderPath)
    } catch (error) {
      console.error('[courses] purge trash failed', error)
    }
    return courseListChanged(OK)
  })
  handle('courses:delete', (req) => {
    const result = coursesRepo.softDelete(req)
    releaseCourseRuntime(req.courseId)
    return courseListChanged(result)
  })
  // 한 번의 드래그 = 한 번의 원자적 호출 (소속 + 위치). 갱신된 전체 목록을
  // 돌려주고, 다른 창을 위해 courses:changed 도 쏜다.
  handle('courses:organize', (req) => courseListChanged(coursesRepo.organize(req)))

  // -- course groups (과목 그룹/학기) ----------------------------------------
  // ⚠ `courseGroups:` prefix — `groups:*` is the Phase-2 social feature.
  const courseGroupsRepo = createCourseGroupsRepo(db)
  handle('courseGroups:list', () => courseGroupsRepo.list())
  handle('courseGroups:create', (req) =>
    courseListChanged(courseGroupsRepo.create(req))
  )
  handle('courseGroups:rename', (req) =>
    courseListChanged(courseGroupsRepo.rename(req))
  )
  // 그룹 삭제는 멤버 과목의 groupId 를 NULL로 되돌릴 뿐, 과목은 지우지 않는다.
  handle('courseGroups:delete', (req) =>
    courseListChanged(courseGroupsRepo.delete(req))
  )

  // -- course links (M8) ----------------------------------------------------
  handle('courseLinks:list', (req) => courseLinksRepo.list(req))
  handle('courseLinks:create', (req) => courseLinksRepo.create(req))
  handle('courseLinks:update', (req) => courseLinksRepo.update(req))
  handle('courseLinks:delete', (req) => courseLinksRepo.delete(req))

  // -- authored material links ---------------------------------------------
  handle('links:create', (req) => {
    const result = materialLinksRepo.create({
      ...req,
      label: req.label ?? ''
    })
    broadcast('materials:changed', { courseId: req.courseId })
    return result
  })
  handle('links:remove', (req) => {
    const result = materialLinksRepo.remove(req.courseId, req.id)
    broadcast('materials:changed', { courseId: req.courseId })
    return result
  })
  handle('links:listFor', (req) =>
    materialLinksRepo.listFor(req.courseId, req.relPath)
  )
  handle('links:listForDescriptor', (req) => {
    if (!isTabDescriptor(req.descriptor)) {
      throw new ValidationError('descriptor must be a TabDescriptor')
    }
    return materialLinksRepo.listForDescriptor(req.courseId, req.descriptor)
  })
  handle('links:graph', (req) => ({
    links: materialLinksRepo.listAll(req.courseId),
    backlinks: linkIndex.allForCourse(req.courseId)
  }))

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
    const result = materialsRepo.import(req.courseId, req.paths, req.dirRelPath)
    note(req.courseId, 'material-added', `자료 ${req.paths.length}개를 가져왔습니다.`)
    return result
  })
  // 이동 후 트리 갱신은 폴더 watcher 가 materials:changed 로 밀어준다.
  handle('materials:move', (req) => materialsRepo.move(req))
  handle('materials:reveal', (req) => materialsRepo.reveal(req.courseId, req.relPath))
  handle('materials:preview', (req) => {
    // 앱이 렌더링하지 못하는 형식(.ppt 등) — macOS 는 Quick Look, 그 외는
    // 기본 앱. 경로 가드는 absolutePathFor(assertRealInside)가 담당한다.
    const abs = materialsRepo.absolutePathFor(req.courseId, req.relPath)
    if (process.platform === 'darwin') {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      win?.previewFile(abs, basename(abs))
    } else {
      void shell.openPath(abs)
    }
    return OK
  })
  handle('materials:readFile', (req) => materialsRepo.readFile(req.courseId, req.relPath))
  handle('materials:writeFile', (req) => materialsRepo.writeFile(req))
  handle('materials:rename', (req) => materialsRepo.rename(req))
  handle('materials:delete', (req) => materialsRepo.softDelete(req))
  handle('materials:duplicate', (req) => materialsRepo.duplicate(req))
  handle('materials:createFolder', (req) => materialsRepo.createFolder(req))
  // invoke 계약 밖의 fire-and-forget: startDrag 는 이벤트의 sender 가 필요하다.
  // 자료 행을 끌면 진짜 OS 파일 드래그가 되어 웹뷰 안의 업로드 폼(메일 첨부,
  // 과제 제출)이 일반 파일처럼 받는다.
  ipcMain.on('materials:startDrag', (event, req: unknown) => {
    try {
      const record = req as { courseId?: unknown; relPath?: unknown }
      if (
        typeof record?.courseId !== 'string' ||
        typeof record?.relPath !== 'string'
      ) {
        return
      }
      const abs = materialsRepo.absolutePathFor(record.courseId, record.relPath)
      // e2e 가드: 합성 dragstart 로 발동된 startDrag 는 macOS 에서 중첩
      // 런루프에 걸려 앱 종료(close)를 영영 막을 수 있다 — 테스트에서는
      // 드래그 상태 기록(renderer 쪽)만으로 충분하다.
      if (process.env['BANDAL_DISABLE_NATIVE_DRAG'] === '1') return
      // 동기 호출이 핵심 — await/then 을 거치면 드래그 제스처가 죽는다.
      const ext = extname(abs).toLowerCase()
      const icon = dragIconCache.get(ext) ?? FALLBACK_DRAG_ICON
      event.sender.startDrag({ file: abs, icon })
      // 다음 드래그를 위한 캐시 채우기 — 이번 드래그에는 관여하지 않는다.
      if (!dragIconCache.has(ext)) {
        void app
          .getFileIcon(abs, { size: 'normal' })
          .then((fileIcon) => {
            if (!fileIcon.isEmpty()) dragIconCache.set(ext, fileIcon)
          })
          .catch((error: unknown) => {
            console.error('[materials] startDrag icon cache failed', error)
          })
      }
    } catch (error) {
      console.error('[materials] startDrag failed', error)
    }
  })
  handle('materials:downloadFromUrl', async (req) => {
    const { fileName, dataBase64 } = await fetchLinkForMaterials(req.url)
    return materialsRepo.writeFile({
      courseId: req.courseId,
      dirRelPath: req.dirRelPath,
      fileName,
      encoding: 'base64',
      data: dataBase64
    })
  })
  handle('materials:watch', (req) => {
    materialsWatcher.watch(req.courseId)
    return OK
  })
  handle('materials:unwatch', (req) => {
    materialsWatcher.unwatch(req.courseId)
    return OK
  })

  // -- notes ----------------------------------------------------------------
  // 필기는 notesRepo 가 과목 폴더에 직접 쓰므로 자료 트리 캐시를 여기서
  // 무효화한다 (materialsRepo 변이는 스스로 무효화한다).
  handle('notes:read', (req) => notesRepo.read(req))
  handle('notes:write', (req) => {
    const result = notesRepo.write(req)
    materialsRepo.invalidateTree(req.courseId)
    note(req.courseId, 'note-edited', `필기를 수정했습니다: ${req.relPath}`, req.relPath)
    emitPluginEvent('note:saved', {
      courseId: req.courseId,
      relPath: req.relPath
    })
    return result
  })
  handle('notes:rename', (req) => {
    const result = notesRepo.rename(req)
    materialsRepo.invalidateTree(req.courseId)
    broadcast('materials:changed', { courseId: req.courseId })
    emitPluginEvent('note:saved', {
      courseId: req.courseId,
      relPath: result.relPath
    })
    return result
  })
  handle('notes:create', (req) => {
    const result = notesRepo.create(req)
    materialsRepo.invalidateTree(req.courseId)
    note(req.courseId, 'note-created', `필기를 만들었습니다: ${result.relPath}`, result.relPath)
    emitPluginEvent('note:saved', {
      courseId: req.courseId,
      relPath: result.relPath
    })
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

  // -- media progress (M18: 영상 이어보기) ----------------------------------
  const mediaProgressRepo = createMediaProgressRepo(db)
  const pdfViewStateRepo = createPdfViewStateRepo(db)
  handle('media:getProgress', (req) =>
    mediaProgressRepo.get(req.courseId, req.relPath)
  )
  handle('media:setProgress', (req) => mediaProgressRepo.set(req))
  handle('pdf:getViewState', (req) =>
    pdfViewStateRepo.get(req.courseId, req.relPath)
  )
  handle('pdf:setViewState', (req) => pdfViewStateRepo.set(req))

  handle('ui:consumePendingOpen', () => deps.consumePendingOpen())

  // -- picture-in-picture ---------------------------------------------------
  const miniPlayer = createMiniPlayerController({
    preloadPath: deps.preloadPath,
    userDataPath: deps.userDataPath,
    windowBackground: deps.windowBackground,
    broadcast: (channel, payload) => {
      broadcast(channel, payload)
      if (channel === 'pip:state') {
        deps.onMiniPlayerStateChanged?.(
          (payload as PushPayload<'pip:state'>).open
        )
      }
    },
    openMaterial: deps.openMaterial,
    openUrl: deps.openUrl,
    openInTab: deps.openInTab
  })
  handle('pip:open', (req) => {
    miniPlayer.open(req)
    return OK
  })
  handle('pip:close', () => {
    miniPlayer.close()
    return OK
  })
  handle('pip:restore', () => {
    miniPlayer.restore()
    return OK
  })
  handle('pip:getState', () => miniPlayer.getState())
  handle('pip:report', (req) => {
    miniPlayer.report(req)
    const state = miniPlayer.getState()
    if (state.source?.kind === 'local') {
      const previous = mediaProgressRepo.get(
        state.source.courseId,
        state.source.relPath
      )
      mediaProgressRepo.set({
        courseId: state.source.courseId,
        relPath: state.source.relPath,
        positionSec: state.positionSec,
        durationSec: previous?.durationSec ?? null,
        playbackRate: state.playbackRate
      })
    }
    return OK
  })
  handle('pip:moveBy', (req) => {
    miniPlayer.moveBy(req.dx, req.dy)
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
  // -- printing ---------------------------------------------------------------
  handle('print:pdf', async (req) => {
    const bytes = Buffer.from(req.base64, 'base64')
    if (bytes.byteLength > PRINT_PDF_MAX_BYTES) {
      throw new ValidationError('인쇄할 내용이 너무 큽니다')
    }
    const result = await printPdfBytes({
      bytes,
      jobName: req.jobName,
      parent: BrowserWindow.getFocusedWindow()
    })
    return { ok: true as const, printed: result.printed }
  })
  handle('print:savePdfAs', async (req) => {
    const result = await dialog.showSaveDialog({
      title: 'PDF로 저장',
      defaultPath: req.suggestedName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || result.filePath === undefined) {
      return { ok: true as const, canceled: true, savedPath: null }
    }
    writeFileSync(result.filePath, Buffer.from(req.base64, 'base64'))
    return { ok: true as const, canceled: false, savedPath: result.filePath }
  })
  handle('print:pdfFromUrl', async (req) => {
    // The guest is already showing this PDF, but printToPDF cannot rasterize
    // plugin content — so fetch the original bytes instead of a blank render.
    const fetched = await fetchLinkForMaterials(req.url)
    return { base64: fetched.dataBase64 }
  })
  handle('window:setPrintEnabled', (req) => {
    setPrintMenuEnabled(req.enabled)
    return OK
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
  // Backlinks: who cites this material. Derived on demand from note text and
  // clip payloads — see features/links. Declared before insights and the
  // dossier because both now answer with real citations instead of guessing
  // from filenames.
  const linkIndex = createLinkIndex({
    db,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  const insights = createInsights({
    db,
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId),
    getMaterialCitations: (courseId) =>
      linkIndex.allForCourse(courseId).map((group) => group.relPath)
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
    getStudyGaps: (courseId) => insights.gaps(courseId),
    // The AI could not see whiteboards at all — no disk representation, no
    // dossier section. `canvasRepo` is declared further down; these run at
    // rebuild time (chat:open), long after registration finishes.
    // countShapes 는 COUNT(*) 한 번이다 — 도시에가 개수만 쓰는데 보드마다
    // 도형 전체를 열어 JSON 파싱하던 것이 chat:open 을 무겁게 만들었다.
    getWhiteboards: (courseId) =>
      canvasRepo.listBoards(courseId).map((board) => ({
        title: board.title,
        shapeCount: canvasRepo.countShapes(board.id)
      })),
    getMaterialLinks: (courseId) => linkIndex.allForCourse(courseId)
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

  /**
   * chat:open 마다 rebuild 를 반복할 필요는 없다 — 같은 과목에서 이 시간 안에
   * 끝난 rebuild 가 있으면 건너뛴다. 대화를 연달아 여닫는 흔한 동선에서
   * 자료가 많은 과목의 rebuild 폭주를 막는다.
   */
  const CONTEXT_REBUILD_COALESCE_MS = 15_000
  const contextRebuiltAt = new Map<string, number>()
  function rebuildContextCoalesced(courseId: string): void {
    const last = contextRebuiltAt.get(courseId)
    if (last !== undefined && Date.now() - last < CONTEXT_REBUILD_COALESCE_MS) {
      return
    }
    contextWriter.rebuild(courseId)
    contextRebuiltAt.set(courseId, Date.now())
  }

  handle('context:rebuild', (req) => {
    // 명시적 요청은 절대 건너뛰지 않는다 — 완료 시각만 기록해 둔다.
    const result = contextWriter.rebuild(req.courseId)
    contextRebuiltAt.set(req.courseId, Date.now())
    return result
  })

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
  handle('board:reorderTasks', (req) =>
    boardRepo.reorderTasks(req.courseId, req.updates)
  )
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
  const geminiLocator = createGeminiBinaryLocator()
  const geminiAdapter = createGeminiAdapter({
    locator: geminiLocator,
    userDataPath: app.getPath('userData')
  })
  const agentLocators: Record<AgentProvider, typeof binaryLocator> = {
    'claude-code': binaryLocator,
    codex: codexLocator,
    gemini: geminiLocator
  }

  // -- assistant acting on the app -------------------------------------------
  // The agent reads third-party lecture PDFs, so these tools widen the blast
  // radius of prompt injection. Three things hold that line and all three live
  // here: destructive tools confirm, every call is journalled, and per-turn
  // caps stop a poisoned document from creating hundreds of anything.
  const agentJournal = createAgentJournal(db)
  const agentConfirmer = createAgentConfirmer({
    emit: (request) => broadcast('agentTools:confirm', request)
  })
  const packStore = createPackStore({ userDataPath: deps.userDataPath })
  // One guard is shared by every MCP server and the pack runner. Creating a
  // guard per conversation would make the runner arm an instance no tool can
  // see, silently defeating a pack's declared tool allowlist.
  const packRunGuard = createPackRunGuard()
  // -- the agent's view of the browser and the course's LMS ----------------
  // Registered for EVERY session. This used to be gated on the course having a
  // classroom linked, to save the ~1k tokens the schemas cost per turn — but
  // the gate meant a student looking at their university portal was told the
  // agent had "no tool to read the browser", which was literally true and
  // completely wrong. The schemas ride at the front of the prompt cache, so
  // the real cost is near zero; the gate cost a whole feature.
  //
  // The LMS-only tools (`lms_*`) still degrade on their own when no classroom
  // is linked — siteRecipes.ts bails on a null lmsCourseId — so keeping them
  // registered costs nothing but an honest "this course has no classroom yet".
  /**
   * The active school's LMS spec, when this URL is on its classroom host.
   * The spec carries the platform, which is what decides whether a JSON
   * endpoint exists at all.
   */
  const specForUrl = (url: string): { platform: LmsPlatform } | null => {
    const spec = resolveUniversity(getSettings().university)?.courseLink
    if (spec === undefined) return null
    try {
      return new RegExp(spec.idPattern).test(url)
        ? { platform: spec.platform }
        : null
    } catch {
      return null
    }
  }

  const browserGrants = createGrantsRepo(db)
  const browserAudit = createAuditRepo(db)
  browserAudit.prune()
  desktopAudit.prune()
  const browserSeen = createSeenRepo(db)
  /** One beat after a load ends, so the new document has committed. */
  const SETTLE_QUIET_MS = 150

  const browserToolsFor = (
    courseId: string,
    conversationId: string,
    getRunId: () => string
  ): ReturnType<typeof createBrowserTools> => {
    return createBrowserTools({
      courseId,
      getRunId,
      getAgentUse: () => getSettings().browser.agentUse,
      grants: browserGrants,
      audit: browserAudit,
      seen: browserSeen,
      courseLinks: (id) =>
        courseLinksRepo
          .list({ courseId: id })
          .map((link) => ({ url: link.url, lmsCourseId: link.lmsCourseId })),
      specFor: (url) => specForUrl(url),
      // Scoped to the course this conversation belongs to: a chat about
      // 자료구조 has no business naming the tabs open under another course.
      openTabs: () =>
        openBrowserTabs.courseId === courseId
          ? {
              tabs: openBrowserTabs.tabs,
              activeTabId: openBrowserTabs.activeTabId
            }
          : { tabs: [], activeTabId: null },
      // The app's own confirmer, not the CLI's permission flow — Codex has no
      // interactive approval at all (agentTools/confirm.ts).
      confirm: (request) =>
        agentConfirmer.confirm({ ...request, conversationId }),
      // A live run drives a VISIBLE tab: the student watches the page move and
      // can stop it. That is the mitigation for every reliability failure mode
      // here, and a hidden guest would be background-throttled anyway.
      page: createPageSurface({
        resolveGuest: (tabId) => guestRegistry.resolve(tabId),
        framesOf: (guest) => {
          const wc = guest as unknown as Electron.WebContents
          const main = wc.mainFrame
          // Every frame, not just the main one: LearningX wraps Canvas in an
          // iframe and SSO lives in one too. The existing in-page bridges are
          // main-frame only, which is why they are blind to both.
          return main.framesInSubtree.map((frame) => ({
            executeJavaScript: (code: string) => frame.executeJavaScript(code)
          }))
        },
        requestTab: (url, timeoutMs) =>
          new Promise((resolve) => {
            const requestId = randomUUID()
            // Opening a page IS the start of a run — from here on the student
            // has a strip and a 중지 button on the tab being driven.
            let runId: string | null =
              browserRuns.forCourse(courseId)?.runId ?? null
            if (runId === null) {
              runId = browserRuns.start(courseId, '', '페이지를 여는 중', url)
                .runId
            }
            pendingTabOpens.set(requestId, { resolve, runId })
            broadcast('browser:open-url', { url, requestId })
            setTimeout(() => {
              const pending = pendingTabOpens.get(requestId)
              if (pending === undefined) return
              pendingTabOpens.delete(requestId)
              // The run was started for a tab that never arrived. Ending it
              // stops a 중지 strip from outliving the attempt, bound to
              // nothing, for the rest of the session.
              if (pending.runId !== null) browserRuns.finish(pending.runId)
              resolve(null)
            }, timeoutMs)
          }),
        /**
         * Resolve once the guest has stopped moving, or the budget runs out.
         *
         * A click is synchronous; the navigation it starts is not. Without
         * this the next snapshot read the OLD document — and since the ref
         * generation only bumps on the renderer's `dom-ready` round trip, the
         * stale outline still looked valid. A confident wrong picture.
         */
        settle: (tabId, timeoutMs) =>
          new Promise<void>((resolve) => {
            const guest = guestRegistry.resolve(tabId)
            if (guest === null) {
              resolve()
              return
            }
            const contents = guest as unknown as Electron.WebContents
            let done = false
            const finish = (): void => {
              if (done) return
              done = true
              clearTimeout(budget)
              contents.off('did-stop-loading', onStop)
              resolve()
            }
            // A short beat after the load ends: the new document commits and
            // its first paint lands just after the event.
            const onStop = (): void => {
              setTimeout(finish, SETTLE_QUIET_MS)
            }
            const budget = setTimeout(finish, timeoutMs)
            try {
              if (!contents.isLoading()) {
                // Nothing navigated — give the page one beat for a JS-driven
                // DOM change, then report.
                setTimeout(finish, SETTLE_QUIET_MS)
                return
              }
            } catch {
              finish()
              return
            }
            contents.on('did-stop-loading', onStop)
          }),
        /**
         * A real key press.
         *
         * `browser_type` writes a field's value through the native setter and
         * stops there — no key ever travels. Korean portal search boxes
         * overwhelmingly submit on Enter, so without this the agent could fill
         * a box and had no way to run the search.
         */
        sendKey: async (tabId, key) => {
          const guest = guestRegistry.resolve(tabId)
          if (guest === null) return
          const contents = guest as unknown as Electron.WebContents
          contents.sendInputEvent({ type: 'keyDown', keyCode: key })
          contents.sendInputEvent({ type: 'keyUp', keyCode: key })
        },

        /** back / forward / reload / stop — the app could already do all four. */
        history: async (tabId, action) => {
          const guest = guestRegistry.resolve(tabId)
          if (guest === null) return
          const contents = guest as unknown as Electron.WebContents
          if (action === 'back') contents.navigationHistory.goBack()
          else if (action === 'forward') contents.navigationHistory.goForward()
          else if (action === 'reload') contents.reload()
          else contents.stop()
        },

        /**
         * Bringing a tab forward or closing it belongs to the RENDERER — guests
         * live in its fixed layer and the workspace owns the tab strip.
         */
        tabLifecycle: async (tabId, action) => {
          if (action === 'focus') {
            broadcast('browser:activate-tab', { tabId })
            return true
          }
          broadcast('browser:close-tab', { tabId })
          return true
        },

        findInPage: (tabId, text) =>
          new Promise<number>((resolve) => {
            const guest = guestRegistry.resolve(tabId)
            if (guest === null || text === '') {
              resolve(0)
              return
            }
            const contents = guest as unknown as Electron.WebContents
            let done = false
            const finish = (matches: number): void => {
              if (done) return
              done = true
              clearTimeout(budget)
              contents.off('found-in-page', onFound)
              // Otherwise the student is left staring at a highlight the agent
              // put there and cannot clear.
              try {
                contents.stopFindInPage('clearSelection')
              } catch {
                // The guest went away mid-search; nothing to clear.
              }
              resolve(matches)
            }
            const onFound = (
              _event: unknown,
              result: { matches?: number }
            ): void => finish(result.matches ?? 0)
            const budget = setTimeout(() => finish(0), 3_000)
            contents.on('found-in-page', onFound)
            try {
              contents.findInPage(text)
            } catch {
              finish(0)
            }
          }),

        requestActivateTab: (tabId) => {
          broadcast('browser:activate-tab', { tabId })
        },
        awaitTabRegister: (tabId, timeoutMs) =>
          new Promise((resolve) => {
            pendingTabWakes.set(tabId, resolve)
            setTimeout(() => {
              if (pendingTabWakes.delete(tabId)) resolve(false)
            }, timeoutMs)
          }),
        generations,
        // Hangul: `sendInputEvent` has no IME path, so text typed through the
        // DOM tier never fires `compositionend`. This is the gap CDP is here
        // for; it degrades silently when the debugger is unavailable.
        insertText: async (tabId, text) => {
          const guest = guestRegistry.resolve(tabId)
          if (guest === null) throw new Error('no guest')
          await insertText(
            guest as unknown as { debugger: Electron.Debugger },
            text
          )
        },
        run: {
          assertLive: () => {
            const live = browserRuns.forCourse(courseId)
            if (live !== null) browserRuns.assertLive(live.runId)
          },
          step: (action, url) => {
            const live = browserRuns.forCourse(courseId)
            if (live !== null) browserRuns.step(live.runId, action, url)
          },
          wait: (message) => {
            const live = browserRuns.forCourse(courseId)
            if (live !== null) browserRuns.wait(live.runId, message)
          },
          awaitResume: (timeoutMs) =>
            new Promise((resolve) => {
              const live = browserRuns.forCourse(courseId)
              if (live === null) {
                resolve('stopped')
                return
              }
              pendingResumes.set(live.runId, resolve)
              setTimeout(() => {
                if (pendingResumes.delete(live.runId)) resolve('stopped')
              }, timeoutMs)
            })
        }
      }),
      commit: {
        /**
         * The submit click itself. Reached only after an explicit yes that is
         * never remembered — see `browser_submit`.
         */
        submit: async (tabId, frameIndex, elementIndex) => {
          const guest = guestRegistry.resolve(tabId)
          if (guest === null) return false
          const wc = guest as unknown as Electron.WebContents
          const frame = wc.mainFrame.framesInSubtree[frameIndex]
          if (frame === undefined) return false
          // The SAME enumeration the snapshot indexed with — this was the
          // third hand-written copy of it, and the copies had drifted.
          const source = `(() => {
            ${TARGET_INDEX_SOURCE}
            const target = __bandalTargets()[${elementIndex}];
            if (!target) return false;
            target.click();
            return true;
          })()`
          try {
            return (await frame.executeJavaScript(source)) === true
          } catch {
            return false
          }
        },

        /**
         * Reuses `createLoginFiller` unchanged. The agent hands over a tab and
         * learns whether it worked — the secret never enters the agent path,
         * let alone the model's context.
         */
        useSavedLogin: async (tabId) => {
          const guest = guestRegistry.resolve(tabId)
          if (guest === null) return { filled: false, username: null }
          const result = await fillLogin({
            origin: guest.getURL(),
            guestWebContentsId: guest.id
          })
          return { filled: result.filled, username: null }
        },

        /**
         * `DOM.setFileInputFiles` — the one thing JavaScript genuinely cannot
         * do. CDP is attached for this single call and detached immediately.
         */
        attachFile: async (tabId, frameIndex, elementIndex, target, relPath) => {
          const guest = guestRegistry.resolve(tabId)
          if (guest === null) return false
          void frameIndex
          const absPath = resolveInside(coursesRepo.getFolder(target), relPath)
          try {
            return await setFileInputFiles(
              guest as unknown as { debugger: Electron.Debugger },
              `input[type=file]:nth-of-type(${elementIndex + 1}), input[type=file]`,
              [absPath]
            )
          } catch {
            // DevTools already owns the debugger, or the page went away.
            return false
          }
        }
      },
      // The student's own login — the same session they signed in to by hand.
      fetch: (url) => session.fromPartition(BROWSING_PARTITION).fetch(url),
      // Same path a link-drag takes: browsing-session fetch with the 200MB
      // cap, then materialsRepo's own guards. One download implementation,
      // not two.
      collect: async ({ courseId: target, url, dirRelPath }) => {
        const { fileName, dataBase64 } = await fetchLinkForMaterials(url)
        return materialsRepo.writeFile({
          courseId: target,
          dirRelPath,
          fileName,
          encoding: 'base64',
          data: dataBase64
        })
      }
    })
  }

  // The glass box + the tab map the agent addresses pages through.
  const browserRuns = createRunRegistry({
    emit: (state) => broadcast('browserAgent:run-state', state)
  })
  const guestRegistry = createGuestRegistry({
    fromId: (id) => webContents.fromId(id) as never,
    // A guest the agent may drive is a webview on the hardened partition and
    // nothing else — never the app's own renderer.
    isBrowsingPartition: (guest) =>
      (guest as unknown as { session?: Electron.Session }).session ===
      session.fromPartition(BROWSING_PARTITION)
  })
  const generations = new GenerationTracker()

  /**
   * Resolvers waiting for a tab the agent asked the renderer to open.
   *
   * Keyed by a request id, NOT by URL. Prefix matching could not survive a
   * host change, so a portal that redirects — 서울대's my.snu → shine.snu —
   * made `browser_open` report failure about a tab that had opened fine, and
   * left an orphan run bound to no tab. It also had a hole: a guest that
   * failed to resolve gave `url === ''`, and `pending.url.startsWith('')` is
   * always true, so ONE bad registration resolved EVERY outstanding open.
   */
  const pendingTabOpens = new Map<
    string,
    { resolve: (tabId: string | null) => void; runId: string | null }
  >()
  /** Resolvers waiting on a student who was handed the wheel. */
  const pendingResumes = new Map<
    string,
    (outcome: 'resumed' | 'stopped') => void
  >()
  /** Resolvers waiting for an evicted guest to mount again. */
  const pendingTabWakes = new Map<string, (woke: boolean) => void>()
  /**
   * The browser tabs the renderer says the student can see.
   *
   * The renderer is the authority here, not `guestRegistry`: hidden guests
   * beyond MAX_LIVE_GUESTS are destroyed while their tabs stay on screen.
   */
  /**
   * What the student is looking at in Bandal, published by the renderer.
   *
   * The browser half of this already existed; the app half did not, which is
   * why an instruction about the sidebar was resolved against the portal.
   */
  let workspaceSnapshot: {
    selectedCourseId: string | null
    tabs: { kind: string; title: string; active: boolean }[]
  } = { selectedCourseId: null, tabs: [] }

  const appStateSnapshot = (): AgentAppState => {
    const groups = courseGroupsRepo.list()
    const names = new Map(groups.map((group) => [group.id, group.name]))
    return {
      selectedCourseId: workspaceSnapshot.selectedCourseId,
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
      courses: coursesRepo.list({ includeArchived: false }).map((course) => ({
        id: course.id,
        name: course.name,
        groupId: course.groupId,
        groupName:
          course.groupId === null ? null : (names.get(course.groupId) ?? null)
      })),
      workspaceTabs: workspaceSnapshot.tabs,
      browserTabs: openBrowserTabs.tabs.map((tab) => ({
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
        active: tab.tabId === openBrowserTabs.activeTabId,
        asleep: tab.asleep
      }))
    }
  }

  let openBrowserTabs: {
    courseId: string
    tabs: { tabId: string; title: string; url: string; asleep: boolean }[]
    activeTabId: string | null
  } = { courseId: '', tabs: [], activeTabId: null }

  handle('browserAgent:registerTab', (req) => {
    guestRegistry.register(req.tabId, req.webContentsId)
    // A fresh attach means a fresh document: every outstanding ref dies.
    generations.invalidate(req.tabId)
    const openRequestId = req.openRequestId
    if (openRequestId !== undefined) {
      const pending = pendingTabOpens.get(openRequestId)
      if (pending !== undefined) {
        pendingTabOpens.delete(openRequestId)
        // The strip belongs to the tab that just appeared.
        if (pending.runId !== null) {
          browserRuns.attachTab(pending.runId, req.tabId)
        }
        pending.resolve(req.tabId)
      }
    }
    pendingTabWakes.get(req.tabId)?.(true)
    pendingTabWakes.delete(req.tabId)
    return OK
  })
  handle('agent:syncWorkspace', (req) => {
    const previousCourseId = workspaceSnapshot.selectedCourseId
    workspaceSnapshot = {
      selectedCourseId: req.selectedCourseId,
      tabs: req.tabs.map((tab) => ({ ...tab }))
    }
    if (previousCourseId !== req.selectedCourseId) {
      emitPluginEvent('course:changed', { courseId: req.selectedCourseId })
    }
    return OK
  })
  handle('browserAgent:syncTabs', (req) => {
    openBrowserTabs = {
      courseId: req.courseId,
      tabs: req.tabs.map((tab) => ({ ...tab })),
      activeTabId: req.activeTabId
    }
    return OK
  })
  handle('browserAgent:stopRun', (req) => {
    browserRuns.stop(req.runId)
    pendingResumes.get(req.runId)?.('stopped')
    pendingResumes.delete(req.runId)
    return OK
  })
  handle('browserAgent:resumeRun', (req) => {
    browserRuns.resume(req.runId)
    pendingResumes.get(req.runId)?.('resumed')
    pendingResumes.delete(req.runId)
    return OK
  })

  handle('browserAgent:grants', () => ({ grants: browserGrants.list() }))
  handle('browserAgent:revokeGrant', (req) => {
    browserGrants.revoke(req.id)
    return OK
  })
  handle('browserAgent:auditTail', (req) => ({
    entries: browserAudit
      .tail(req.courseId, req.limit)
      .map(({ id, courseId, action, url, detail, createdAt }) => ({
        id,
        courseId,
        action,
        url,
        detail,
        createdAt
      }))
  }))

  const startToolServer = async (
    courseId: string,
    sessionKey: string,
    getTurnSeq: () => number,
    surface: 'app' | 'desktop'
  ): Promise<Awaited<ReturnType<typeof startAgentToolsServer>>> =>
    startAgentToolsServer({
      sessionId: sessionKey,
      userDataPath: app.getPath('userData'),
      ...(surface === 'desktop'
        ? { userMcpServers: mcpRegistry.resolveEnabled() }
        : {}),
      deps: {
        courseId,
        // Keyed by conversation, not course: two conversations in one course
        // are separate turn streams, and all providers share this factory.
        // The number comes from `chatRepo.nextTurnSeq` via SessionManager —
        // a module-level counter here would never advance, which silently
        // froze `AGENT_TURN_LIMITS` (a spent budget stayed spent until the app
        // restarted) and lumped every action ever into one undo group.
        getTurnId: () => `${sessionKey}:${getTurnSeq()}`,
        coursesRepo,
        courseGroupsRepo,
        courseLinksRepo,
        favoritesRepo,
        searchIndex,
        linkService,
        appState: () => appStateSnapshot(),
        materialsRepo,
        materialLinksRepo,
        notesRepo,
        boardRepo,
        canvasRepo,
        packRunGuard,
        confirm: async (request) =>
          (await agentConfirmer.confirm({ ...request, conversationId: sessionKey })) !==
          false,
        browser: browserToolsFor(
          courseId,
          sessionKey,
          () => `${sessionKey}:${getTurnSeq()}`
        ),
        ...(surface === 'desktop'
          ? {
              desktop: createDesktopTools({
                courseId,
                conversationId: sessionKey,
                getTurnId: () => `${sessionKey}:${getTurnSeq()}`,
                surface: desktopSurface,
                grants: desktopGrants,
                audit: desktopAudit,
                confirm: (input) =>
                  agentConfirmer.confirm({
                    ...input,
                    courseId,
                    conversationId: sessionKey
                  }),
                run: desktopRun,
                onPermission: (payload) => {
                  broadcast('desktopAgent:permission', payload)
                  deps.overlay.setScreenPermission(payload.state)
                }
              })
            }
          : {}),
        journal: {
          record: (entry) => {
            agentJournal.record(entry)
            // Whatever the tool touched, the UI is now stale. 자료 캐시도
            // 마찬가지다 — 필기 도구는 materialsRepo 를 거치지 않고 디스크에
            // 쓰므로 여기서 무효화해야 한다.
            materialsRepo.invalidateTree(entry.courseId)
            broadcast('courses:changed', {})
            broadcast('board:changed', { courseId: entry.courseId })
            broadcast('canvas:changed', { courseId: entry.courseId })
            broadcast('materials:changed', { courseId: entry.courseId })
            broadcast('agentTools:changed', {
              courseId: entry.courseId,
              // Route to the conversation that caused it. Course-level routing
              // put the change list in every chat of that course.
              conversationId: sessionKey,
              turnId: entry.turnId
            })
          }
        }
      }
    })

  const notifyTurnComplete = (info: {
    courseId: string
    sessionId: string
  }): void => {
    try {
      let courseName = ''
      try {
        courseName = coursesRepo.getById(info.courseId).name
      } catch {
        // A deleted course can finish a turn while its process is winding down.
      }
      notifier.notify({
        kind: 'agentComplete',
        title: 'AI 응답이 도착했어요',
        body: courseName,
        courseId: info.courseId
      })
    } catch (error) {
      console.error('[notifications] agent completion failed', error)
    }
  }

  const recordUsage = (info: {
    courseId: string
    sessionId: string
    provider: AgentProvider
    model: string | null
    usage?: Usage
    durationMs?: number
  }): void => {
    try {
      usageRepo.record(info)
    } catch (error) {
      console.error('[usage] failed to record agent turn', error)
    }
  }

  const sessionManager = createSessionManager({
    adapter: claudeAdapter,
    repo: chatRepo,
    getCourse: (courseId) => ({
      folder: coursesRepo.getFolder(courseId),
      name: coursesRepo.getById(courseId).name
    }),
    emit: (courseId, sessionId, event) =>
      eventBatcher.push(courseId, sessionId, event),
    startToolServer,
    reportToolsUnavailable: (courseId, sessionId) => {
      broadcast('agentTools:unavailable', { courseId, sessionId })
    },
    onTurnComplete: notifyTurnComplete,
    onUsage: recordUsage
  })
  app.on('before-quit', () => {
    browserRuns.disposeAll()
    materialsWatcher.dispose()
    sessionManager.disposeAll()
    codexSessionManager.disposeAll()
    geminiSessionManager.disposeAll()
    eventBatcher.dispose()
  })
  process.on('exit', () => {
    killAllClaudeProcessesSync()
    killAllCodexProcessesSync()
    killAllGeminiProcessesSync()
  })

  // The session manager is per-adapter, so the
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
    emit: (courseId, sessionId, event) =>
      eventBatcher.push(courseId, sessionId, event),
    startToolServer,
    reportToolsUnavailable: (courseId, sessionId) => {
      broadcast('agentTools:unavailable', { courseId, sessionId })
    },
    onTurnComplete: notifyTurnComplete,
    onUsage: recordUsage
  })
  const geminiSessionManager = createSessionManager({
    adapter: geminiAdapter,
    repo: chatRepo,
    getCourse: (courseId) => ({
      folder: coursesRepo.getFolder(courseId),
      name: coursesRepo.getById(courseId).name
    }),
    emit: (courseId, sessionId, event) =>
      eventBatcher.push(courseId, sessionId, event),
    startToolServer,
    reportToolsUnavailable: (courseId, sessionId) => {
      broadcast('agentTools:unavailable', { courseId, sessionId })
    },
    onTurnComplete: notifyTurnComplete,
    onUsage: recordUsage
  })
  const managerFor = (provider: string): typeof sessionManager =>
    provider === 'codex'
      ? codexSessionManager
      : provider === 'gemini'
        ? geminiSessionManager
        : sessionManager
  /**
   * Provider is a per-CONVERSATION property: a persisted row routes by its own
   * provider, a warm-but-unpersisted entry stays with whichever manager holds
   * it, and only a brand-new conversation follows the settings default.
   */
  const resolveManager = (sessionId: string): typeof sessionManager => {
    const row = chatRepo.getSession(sessionId)
    if (row !== null) {
      return managerFor(row.provider)
    }
    if (sessionManager.has(sessionId)) {
      return sessionManager
    }
    if (codexSessionManager.has(sessionId)) {
      return codexSessionManager
    }
    if (geminiSessionManager.has(sessionId)) {
      return geminiSessionManager
    }
    return managerFor(getSettings().agentProvider)
  }

  // Refresh the dossier the agent reads at session start.
  // Best-effort: a context failure must not stop the student from chatting.
  // 응답한 뒤에 fire-and-forget 으로 미룬다 — 자료가 많은 과목에서 동기
  // rebuild 가 대화 열기(과목 전환)를 통째로 막고 있었다. 실제 첫 메시지가
  // 나가기 전에는 넉넉히 끝난다.
  handle('chat:open', (req) => {
    setImmediate(() => {
      try {
        rebuildContextCoalesced(req.courseId)
      } catch (error) {
        console.error('[context] rebuild failed', error)
      }
    })
    return resolveManager(req.sessionId).open(
      req.courseId,
      req.sessionId,
      req.surface ?? 'app'
    )
  })
  handle('chat:send', (req) =>
    resolveManager(req.sessionId).send(
      req.courseId,
      req.sessionId,
      req.content,
      req.attachments
    )
  )
  handle('chat:cancel', (req) => {
    resolveManager(req.sessionId).cancel(req.courseId, req.sessionId)
    return OK
  })
  handle('chat:conversations', (req) => ({
    conversations: chatRepo.listConversations(
      req.courseId,
      req.surface ?? 'app'
    )
  }))
  handle('chat:grants', (req) => ({
    grants: chatRepo.listGrantDetails(req.courseId)
  }))
  handle('chat:revokeGrant', (req) => {
    chatRepo.removeGrant(req.id)
    return OK
  })

  // -- desktop overlay -----------------------------------------------------
  handle('overlay:getState', () => deps.overlay.getState())
  handle('overlay:setCourse', (req) => deps.overlay.setCourse(req.courseId))
  handle('overlay:togglePopup', (req) => deps.overlay.togglePopup(req.open))
  handle('overlay:orbDragBegin', (req) => {
    deps.overlay.orbDragBegin(req)
    return OK
  })
  handle('overlay:orbDragEnd', () => {
    deps.overlay.orbDragEnd()
    return OK
  })
  handle('overlay:setOrbHitTest', (req) => {
    deps.overlay.setOrbHitTest(req.hit)
    return OK
  })
  handle('overlay:prompt', (req) => {
    deps.overlay.prompt(req.prompt)
    return OK
  })
  handle('overlay:openInApp', (req) => {
    deps.overlay.openInApp(req)
    return OK
  })
  handle('desktopAgent:permissionStatus', () => ({
    state: screenPermissionState(desktopSurface.access()),
    platform: process.platform
  }))
  handle('desktopAgent:openPermissionSettings', async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      )
    }
    return OK
  })

  // -- user MCP registry ---------------------------------------------------
  handle('mcp:list', () => ({
    servers: mcpRegistry.list(),
    availability: mcpRegistry.availability()
  }))
  handle('mcp:save', (req) => {
    const server = mcpRegistry.save(req)
    broadcast('mcp:changed', {})
    return { server }
  })
  handle('mcp:delete', (req) => {
    mcpRegistry.delete(req.id)
    broadcast('mcp:changed', {})
    return OK
  })
  handle('mcp:test', async (req) => {
    // Enabled entries retain their secret env/header values. A disabled entry
    // can still be probed with its public transport fields; the registry
    // intentionally never exposes its secrets through list().
    const config =
      mcpRegistry.resolveEnabled().find((server) => server.id === req.id) ??
      mcpRegistry.list().find((server) => server.id === req.id)
    if (config === undefined) {
      throw new ValidationError('테스트할 MCP 서버를 찾을 수 없습니다.')
    }
    const result = await testMcpServer(config)
    mcpRegistry.recordTest(req.id, result)
    broadcast('mcp:changed', {})
    return result
  })
  handle('chat:deleteConversation', (req) => {
    // Close any warm CLI on every manager before the row disappears.
    sessionManager.close(req.courseId, req.sessionId)
    codexSessionManager.close(req.courseId, req.sessionId)
    geminiSessionManager.close(req.courseId, req.sessionId)
    chatRepo.softDeleteSession(req.sessionId)
    return OK
  })
  handle('agentTools:changes', (req) => agentJournal.forTurn(req.turnId))
  handle('agentTools:undo', (req) =>
    agentJournal.undoTurn(req.turnId, {
      course: async ({ targetId }) => {
        coursesRepo.softDelete({ courseId: targetId })
      },
      // Notes are files, so both go to the OS trash — recoverable, unlike a
      // hard unlink.
      material: async ({ courseId, targetId }) => {
        await materialsRepo.softDelete({ courseId, relPath: targetId })
      },
      link: async ({ courseId, targetId }) => {
        materialLinksRepo.remove(courseId, targetId)
        broadcast('materials:changed', { courseId })
      },
      note: async ({ courseId, targetId }) => {
        await materialsRepo.softDelete({ courseId, relPath: targetId })
      },
      task: async ({ targetId }) => {
        boardRepo.softDelete({ id: targetId })
      },
      board: async ({ targetId }) => {
        canvasRepo.removeBoard(targetId)
      },
      shape: async ({ targetId }) => {
        const [boardId, shapeId] = targetId.split('\u0000')
        if (boardId === undefined || shapeId === undefined) return
        canvasRepo.removeShapes({ boardId, ids: [shapeId] })
      },
      // 문서 제자리 편집(edit_sheet / edit_docx_text)의 되돌리기 —
      // 편집 직전 백업을 원래 경로 위로 복사한다. 파일이 그 사이
      // 이동/개명됐어도 원래 경로에 복원한다.
      'material-edit': async ({ courseId, targetId }) => {
        const parsed = parseMaterialEditTargetId(targetId)
        if (parsed === null) return
        restoreMaterialBackup({
          courseFolder: coursesRepo.getFolder(courseId),
          relPath: parsed.relPath,
          backupAbs: parsed.backupAbs
        })
        // watcher 도 곧 알아채지만, 즉시성을 위해 직접 무효화·브로드캐스트.
        materialsRepo.invalidateTree(courseId)
        broadcast('materials:changed', { courseId })
      }
    })
  )
  handle('agentTools:respondConfirm', (req) => {
    agentConfirmer.resolve(req)
    return OK
  })

  handle('chat:respondPermission', (req) => {
    resolveManager(req.sessionId).respondPermission(
      req.courseId,
      req.sessionId,
      req.requestId,
      req.response
    )
    return OK
  })
  handle('chat:close', (req) => {
    resolveManager(req.sessionId).close(req.courseId, req.sessionId)
    eventBatcher.flush(req.sessionId)
    return OK
  })
  handle('chat:setModel', (req) => {
    resolveManager(req.sessionId).setModel(req.courseId, req.sessionId, req.model)
    return OK
  })
  handle('chat:setProvider', (req) => {
    const row = chatRepo.getSession(req.sessionId)
    if (row?.status === 'running') {
      throw new Error('답변이 끝난 뒤에 바꿀 수 있어요.')
    }
    // Both managers: the old one would keep an orphaned CLI process, and the
    // new one must hydrate its entry from the updated row on the next send.
    sessionManager.close(req.courseId, req.sessionId)
    codexSessionManager.close(req.courseId, req.sessionId)
    geminiSessionManager.close(req.courseId, req.sessionId)
    eventBatcher.flush(req.sessionId)
    if (row === null || row.provider === req.provider) {
      return { sessionInfo: row, carried: null }
    }
    const { text: _text, ...carried } = serializeTranscript(
      chatRepo.historyTail(req.sessionId, CARRYOVER_HISTORY_LIMIT)
    )
    const sessionInfo = chatRepo.switchProvider(req.sessionId, req.provider)
    chatRepo.appendNotice(req.courseId, req.sessionId, {
      kind: 'provider-switch',
      from: row.provider,
      to: req.provider,
      carried
    })
    return { sessionInfo, carried }
  })

  // -- agent (M4-H) ---------------------------------------------------------
  handle('agent:availability', async (req) =>
    agentLocators[req.provider].availability()
  )

  // Installers mutate the machine outside the app sandbox, so `agent:install`
  // is only ever reached from an explicit click after the UI has shown the
  // exact command from `agent:installCommand`. The SAME locator singletons
  // that serve `agent:availability` are passed in so post-install
  // verification resets the caches the renderer actually queries.
  const agentInstaller = createAgentInstaller({
    broadcast: (progress) => broadcast('agent:install-progress', progress),
    locators: agentLocators
  })
  const loginLauncher = createLoginLauncher({
    locators: agentLocators
  })
  // -- AI study tools --------------------------------------------------------
  // The recipes run through the course's normal agent session and write their
  // answer into the course folder, so a result is editable, survives the
  // session, and becomes context for later questions.
  const workflowSessionIds = new Map<string, string>()
  const workflowSessionIdFor = (courseId: string): string => {
    const active = workflowSessionIds.get(courseId)
    if (active !== undefined) return active
    const sessionId = chatRepo.listConversations(courseId)[0]?.id ?? randomUUID()
    workflowSessionIds.set(courseId, sessionId)
    return sessionId
  }
  const releaseWorkflowSession = (
    courseId: string,
    sessionId: string
  ): void => {
    if (workflowSessionIds.get(courseId) === sessionId) {
      workflowSessionIds.delete(courseId)
    }
  }
  const packRunner = createPackRunner({
    store: packStore,
    runGuard: packRunGuard,
    getCourse: (courseId) => ({
      name: coursesRepo.getById(courseId).name,
      folder: coursesRepo.getFolder(courseId)
    }),
    ask: async (courseId, prompt) => {
      // Study tools ride the course's newest conversation so their answer
      // lands where the student is already talking; a course with no
      // conversations yet gets a fresh one.
      const sessionId = workflowSessionIdFor(courseId)
      try {
        await resolveManager(sessionId).send(courseId, sessionId, prompt)
      } finally {
        releaseWorkflowSession(courseId, sessionId)
      }
    },
    confirm: async (request) => {
      const sessionId = workflowSessionIdFor(request.courseId)
      try {
        const result = await agentConfirmer.confirm({
          ...request,
          conversationId: sessionId
        })
        if (result === false) {
          releaseWorkflowSession(request.courseId, sessionId)
        }
        return result
      } catch (error) {
        releaseWorkflowSession(request.courseId, sessionId)
        throw error
      }
    },
    recordActivity: (courseId, summary, relPath) => {
      note(courseId, 'study-tool-run', summary, relPath)
    },
    getPlanningContext: (courseId) => ({
      asOf: new Date().toISOString(),
      upcomingDeadlines: boardRepo
        .upcoming({ courseId, withinDays: 30, limit: 8 })
        .flatMap(({ task, daysLeft }) =>
          task.dueAt === null
            ? []
            : [{ title: task.title, dueAt: task.dueAt, daysLeft }]
        ),
      studyGaps: insights.gaps(courseId)
    })
  })

  handle('packs:list', () => ({ packs: packStore.list() }))
  handle('packs:importText', (req) => packStore.importText(req.json))
  handle('packs:remove', (req) => {
    packStore.remove(req.id)
    return OK
  })
  handle('packs:setEnabled', (req) => {
    packStore.setEnabled(req.id, req.enabled)
    return OK
  })
  handle('study:tools', () => ({
    tools: packStore.list().map(({ pack, source, enabled }) => ({
      id: pack.id,
      label: pack.name,
      description: pack.description,
      worksOnCourse: pack.worksOn.includes('course'),
      source,
      enabled,
      usesWeb: pack.usesWeb,
      outputs: { ...pack.outputs },
      ...(pack.followUp === undefined
        ? {}
        : { followUp: { ...pack.followUp } })
    }))
  }))
  handle('study:run', (req) =>
    packRunner.run({
      courseId: req.courseId,
      packId: req.tool,
      ...(req.relPath === null ? {} : { targetRelPath: req.relPath }),
      ...(req.selection === undefined
        ? {}
        : { selectionText: req.selection }),
      ...(req.followUpOf === undefined
        ? {}
        : { followUpOf: req.followUpOf })
    })
  )

  handle('agent:installCommand', (req) => agentInstaller.commandFor(req.provider))
  handle('agent:install', (req) => agentInstaller.install(req.provider))
  handle('agent:login', (req) => loginLauncher.login(req.provider))
  handle('agent:models', (req) => getAgentModels(req.provider))

  // -- saved logins ----------------------------------------------------------
  // `resolve()` deliberately has no channel. The password is read here, put
  // straight into the guest page, and never travels back to the renderer.
  const credentialStore = createCredentialStore()
  const fillLogin = createLoginFiller(credentialStore)
  const captureLogin = createLoginCapturer(credentialStore)
  handle('credentials:availability', () => credentialStore.availability())
  handle('credentials:list', () => credentialStore.list())
  handle('credentials:save', (req) => credentialStore.save(req))
  handle('credentials:capture', (req) => captureLogin(req))
  handle('credentials:forget', (req) => credentialStore.forget(req.origin))
  handle('credentials:fill', (req) => fillLogin(req))

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

  handle('browser:controlDownload', (req) => {
    if (req.action === 'cancel') downloadControls.cancel(req.id)
    else if (req.action === 'pause') downloadControls.pause(req.id)
    else downloadControls.resume(req.id)
    return OK
  })
  /**
   * Clearing cookies was never enough.
   *
   * An LMS keeps its JWT in localStorage and a Canvas-style SPA restores from
   * IndexedDB, so "로그아웃" left the student logged in. And a stale service
   * worker registered by a 학사 포털 serves an old bundle forever — the
   * classic "저만 깨져요, 크롬에선 되는데요" with no button that fixes it.
   */
  handle('browser:clearStorage', async (req) => {
    const browsing = session.fromPartition(BROWSING_PARTITION)
    await browsing.clearStorageData(
      req.origin === null ? {} : { origin: req.origin }
    )
    if (req.cache) await browsing.clearCache()
    return OK
  })

  // -- site permissions -----------------------------------------------------
  // The session's permission handlers are installed before any window exists,
  // so they take the repo by injection rather than importing the database.
  const permissionsRepo = createPermissionsRepo(db)
  useSitePermissions(permissionsRepo)
  handle('browser:sitePermissions', () => ({
    permissions: permissionsRepo.list()
  }))
  handle('browser:forgetPermission', (req) => {
    if (req.id === null) permissionsRepo.forgetAll()
    else permissionsRepo.forget(req.id)
    return OK
  })

  // -- browser downloads ----------------------------------------------------
  // `will-download` only sees the guest, so the renderer tells us which course
  // a download belongs to. null = no course selected → the OS default folder.
  let downloadCourseId: string | null = null
  handle('browser:setDownloadTarget', (req) => {
    downloadCourseId = req.courseId
    return OK
  })
  // -- browser history ------------------------------------------------------
  const historyRepo = createHistoryRepo(db)
  // Pruning on boot rather than per write keeps the visit path a single upsert.
  historyRepo.prune()
  handle('browser:recordVisit', (req) => {
    historyRepo.recordVisit(req)
    return OK
  })
  handle('browser:searchHistory', (req) => ({
    entries: historyRepo
      .search(req.query, req.limit)
      .map(({ url, title, host, visitCount, lastVisitedAt }) => ({
        url,
        title,
        host,
        visitCount,
        lastVisitedAt
      }))
  }))
  handle('browser:clearHistory', (req) => {
    historyRepo.clear(req.courseId)
    return OK
  })
  const faviconFor = createFaviconFetcher()
  handle('browser:favicon', async (req) => ({
    dataUrl: await faviconFor(req.url)
  }))
  handle('browser:courseForUrl', (req) => ({
    courseId: matchCourseByUrl(
      req.url,
      coursesRepo
        .list({ includeArchived: false })
        .flatMap((course) =>
          courseLinksRepo.list({ courseId: course.id }).map((link) => ({
            courseId: course.id,
            url: link.url,
            lmsCourseId: link.lmsCourseId ?? null
          }))
        )
    )
  }))

  attachDownloadHandler(session.fromPartition(BROWSING_PARTITION), {
    stagingRoot: join(app.getPath('temp'), 'bandal-downloads'),
    getTargetCourseId: () => downloadCourseId,
    adoptFile: (input) => materialsRepo.adoptFile(input),
    emit: (update) => {
      broadcast('browser:download', update)
      // The watcher also fires, but announcing the course explicitly keeps the
      // tree honest when the file lands while another course is on screen.
      if (update.state === 'completed' && update.courseId !== null) {
        broadcast('materials:changed', { courseId: update.courseId })
      }
    },
    onCompleted: (fileName) => {
      try {
        notifier.notify({
          kind: 'download',
          title: '다운로드 완료',
          body: fileName,
          courseId: null
        })
      } catch (error) {
        console.error('[notifications] download completion failed', error)
      }
    }
  })
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
  handle('canvas:setBackground', (req) => canvasRepo.setBackground(req))
  handle('canvas:setPageCount', (req) => canvasRepo.setPageCount(req))
  const boardPdfExporter = createBoardPdfExporter({
    openBoard: (boardId) => canvasRepo.open(boardId),
    getCourseFolder: (courseId) => coursesRepo.getFolder(courseId)
  })
  handle('canvas:exportPdf', async (req) => {
    const result = await boardPdfExporter.exportBoard(req.boardId)
    const board = canvasRepo.open(req.boardId).board
    // 내보내기는 과목 폴더에 PDF 를 직접 떨어뜨린다 — 트리 캐시 무효화.
    materialsRepo.invalidateTree(board.courseId)
    // The export really does drop a new PDF into the course folder, so this is
    // a material appearing — no new activity kind needed.
    note(
      board.courseId,
      'material-added',
      `화이트보드를 PDF로 내보냈습니다: ${board.title}`,
      result.relPath
    )
    return result
  })
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
  handle('links:forMaterial', (req) =>
    linkIndex.forMaterial(req.courseId, req.relPath)
  )

  handle('link:sendHighlightToNote', (req) => {
    const result = linkService.sendHighlightToNote(req)
    // 필기 파일이 과목 폴더에 새로 생기거나 바뀔 수 있다.
    materialsRepo.invalidateTree(req.courseId)
    note(
      req.courseId,
      'note-edited',
      `하이라이트를 필기로 보냈습니다: ${result.relPath}`,
      result.relPath
    )
    return result
  })

  handle('link:sendWebClipToNote', (req) => {
    const result = linkService.sendWebClipToNote(req)
    materialsRepo.invalidateTree(req.courseId)
    note(
      req.courseId,
      'note-edited',
      `웹 페이지를 필기로 보냈습니다: ${result.relPath}`,
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
    return { hits: searchIndex.query(req.courseId, req.query, req.limit) }
  })
  handle('search:indexPdfPages', (req) => {
    searchIndex.indexPdfPages(req)
    return OK
  })

  // -- third-party plugins -------------------------------------------------
  const pluginStore = createPluginStore({ userDataDir: deps.userDataPath })
  const pluginCatalog = createCatalogService({
    userDataDir: deps.userDataPath,
    getPluginSources: () => getSettings().pluginSources,
    fetch: (url, init) => net.fetch(url, init)
  })
  const catalogInstaller = createCatalogInstaller({
    catalog: pluginCatalog,
    pluginStore,
    packStore,
    fetch: (url, init) => net.fetch(url, init),
    appVersion: () => app.getVersion()
  })
  const pluginData = createPluginDataStore({ userDataDir: deps.userDataPath })
  const pluginLog = createPluginLog()
  const pluginLimiter = createPluginRateLimiter()
  const pluginChanged = (): void => {
    broadcast('plugins:changed', { plugins: pluginStore.list() })
  }
  const pluginApi = createPluginApi({
    courses: coursesRepo,
    notes: notesRepo,
    materials: materialsRepo,
    data: pluginData,
    currentCourseId: () => workspaceSnapshot.selectedCourseId,
    onNoteSaved: (courseId, relPath) => {
      emitPluginEvent('note:saved', { courseId, relPath })
      broadcast('materials:changed', { courseId })
    },
    showNotice: (pluginId, message, tone) => {
      const pluginName =
        pluginStore.get(pluginId)?.manifest.name ?? pluginId
      broadcast('plugins:notice', { pluginId, pluginName, message, tone })
      try {
        notifier.notify({
          kind: 'plugin',
          title: pluginName,
          body: message,
          courseId: null
        })
      } catch (error) {
        console.error('[notifications] plugin notice failed', error)
      }
    },
    openPanel: (pluginId, panelId) => {
      broadcast('plugins:openPanel', { pluginId, panelId })
    },
    postPanel: postPluginPanelMessage,
    panelExists: (pluginId, panelId) =>
      pluginStore
        .manifestFor(pluginId)
        ?.contributes.panels.some((panel) => panel.id === panelId) ?? false,
    networkAllowed: (pluginId, url) => {
      const plugin = pluginStore.get(pluginId)
      return (
        plugin?.approvedPermissions !== null &&
        plugin?.approvedPermissions !== undefined &&
        isMethodAllowed(plugin.approvedPermissions, 'net.fetch', url)
      )
    }
  })
  const pluginRuntime = createPluginRuntime({
    store: pluginStore,
    api: pluginApi,
    limiter: pluginLimiter,
    log: pluginLog,
    hostEntry: join(__dirname, 'pluginHost.js'),
    appVersion: resolveAppVersion(
      app.isPackaged,
      app.getVersion(),
      __APP_VERSION__
    ),
    changed: pluginChanged
  })
  emitPluginEvent = (name, payload) => pluginRuntime.sendEvent(name, payload)
  const stopPluginPanels = configurePluginPanels({
    store: pluginStore,
    preloadPath: deps.pluginPanelPreloadPath,
    onPanelMessage: (pluginId, panelId, payload) => {
      pluginRuntime.sendPanelMessage(pluginId, panelId, payload)
    },
    log: (pluginId, message) => {
      pluginLog.push({ pluginId, level: 'denied', message })
    }
  })

  const syncEnabledPlugins = (): void => {
    if (!getSettings().experimental.extensionRuntime) return
    void pluginRuntime.syncEnabled().catch((error: unknown) => {
      console.error('[plugins] enabled-plugin startup failed', error)
    })
  }
  const stopEnabledPlugins = (): void => {
    for (const plugin of pluginStore.list()) {
      pluginRuntime.unload(plugin.manifest.id)
      pluginStore.setState(plugin.manifest.id, 'disabled')
    }
    pluginChanged()
  }
  syncEnabledPlugins()

  app.on('before-quit', () => {
    stopPluginPanels()
    pluginRuntime.dispose()
  })

  handle('plugins:list', () => ({ plugins: pluginStore.list() }))
  handle('plugins:catalog', (req) => pluginCatalog.get(req.refresh))
  handle('plugins:installFromCatalog', async (req) => {
    const installed = await catalogInstaller.install(req.sourceUrl, req.id)
    if (installed.kind === 'extension') {
      pluginRuntime.unload(installed.plugin.manifest.id)
      pluginChanged()
    }
    return installed
  })
  handle('plugins:pickFolder', async () => {
    const parent =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = {
      title: '플러그인 폴더 선택',
      buttonLabel: '이 폴더 설치',
      properties: ['openDirectory']
    }
    const result =
      parent === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(parent, options)
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
  handle('plugins:installFromFolder', async (req) => {
    const installed = await pluginStore.installFromFolder(req.path)
    // A re-install replaces files underneath a possibly active old instance.
    // Stop that instance even though the new registry entry is disabled.
    pluginRuntime.unload(installed.plugin.manifest.id)
    pluginChanged()
    return installed
  })
  handle('plugins:uninstall', async (req) => {
    pluginRuntime.unload(req.id)
    await pluginStore.uninstall(req.id)
    pluginData.remove(req.id)
    pluginLimiter.reset(req.id)
    pluginChanged()
    return OK
  })
  handle('plugins:setEnabled', async (req) => {
    let plugin = pluginStore.setEnabled(req.id, req.enabled)
    if (!req.enabled) {
      pluginRuntime.unload(req.id)
      pluginChanged()
      return { plugin }
    }
    pluginChanged()
    if (plugin.state === 'needs-approval') return { plugin }
    if (!getSettings().experimental.extensionRuntime) return { plugin }
    try {
      plugin = await pluginRuntime.load(req.id)
    } catch (error) {
      pluginLog.push({
        pluginId: req.id,
        level: 'error',
        message: `activation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
      plugin = pluginStore.get(req.id) ?? plugin
    }
    return { plugin }
  })
  handle('plugins:approve', (req) => {
    const plugin = pluginStore.approve(req.id)
    pluginChanged()
    return { plugin }
  })
  handle('plugins:reload', async (req) => {
    let plugin = pluginStore.get(req.id)
    if (plugin === null) throw new ValidationError(`unknown plugin "${req.id}"`)
    if (!getSettings().experimental.extensionRuntime) return { plugin }
    try {
      plugin = await pluginRuntime.reload(req.id)
    } catch (error) {
      pluginLog.push({
        pluginId: req.id,
        level: 'error',
        message: `reload failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
      plugin = pluginStore.get(req.id) ?? plugin
    }
    return { plugin }
  })
  handle('plugins:runCommand', async (req) => {
    if (!getSettings().experimental.extensionRuntime) {
      throw new ValidationError('확장 플러그인 런타임이 설정에서 꺼져 있어요')
    }
    await pluginRuntime.runCommand(req.pluginId, req.commandId)
    return OK
  })
  handle('plugins:logs', (req) => ({
    entries: pluginLog.list(req.id)
  }))


  // -- settings (real implementation, settingsStore-owned) ------------------
  handle('settings:get', () => getSettings())
  const applyExtensionRuntimeChange = (
    previous: Settings,
    next: Settings
  ): void => {
    if (
      previous.experimental.extensionRuntime ===
      next.experimental.extensionRuntime
    ) {
      return
    }
    if (next.experimental.extensionRuntime) syncEnabledPlugins()
    else stopEnabledPlugins()
  }
  handle('settings:set', (req) => {
    const previous = getSettings()
    const next = setSettings(req)
    applyExtensionRuntimeChange(previous, next)
    return next
  })
  // [R3] dataRoot 변경. 새 과목만 새 위치에 생긴다 — 기존 과목 폴더는 절대
  // 경로로 저장되어 있으므로 옮기지 않고 그대로 동작한다.
  handle('settings:pickDataRoot', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = {
      title: '과목 데이터 폴더 선택',
      buttonLabel: '이 폴더 사용',
      defaultPath: getSettings().dataRoot,
      properties: ['openDirectory', 'createDirectory']
    }
    const result =
      parent === undefined
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(parent, options)
    const picked = result.filePaths[0]
    if (result.canceled || picked === undefined) return null
    const dataRoot = normalizeFolderPath(picked)
    try {
      accessSync(dataRoot, fsConstants.W_OK)
    } catch {
      throw new ValidationError(
        '선택한 폴더에 쓸 수 없습니다. 다른 폴더를 골라 주세요.'
      )
    }
    // setSettings 가 저장 + settings:changed 브로드캐스트까지 처리한다.
    setSettings({ dataRoot })
    return { dataRoot }
  })
  handle('settings:reset', () => {
    const previous = getSettings()
    const next = resetSettings(setSettings)
    applyExtensionRuntimeChange(previous, next)
    return next
  })
  handle('notifications:test', () => notifier.test())
  handle('app:openLogs', async () => {
    const logsPath = app.getPath('logs')
    mkdirSync(logsPath, { recursive: true })
    const error = await shell.openPath(logsPath)
    if (error !== '') throw new Error(error)
    return OK
  })
  handle('app:clearCache', async () => {
    await Promise.all([
      session.fromPartition(BROWSING_PARTITION).clearCache(),
      session.defaultSession.clearCache()
    ])
    return OK
  })
  handle('usage:summary', (req) => {
    if (!isUsageWindowDays(req.windowDays)) {
      throw new ValidationError('사용량 조회 기간이 올바르지 않습니다.')
    }
    return usageRepo.summary(req.windowDays)
  })

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
  const stopWhiteboardAuthReset = groupRuntime.onAuthChanged(() => {
    whiteboardService.resetForAuthChange()
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
    stopWhiteboardAuthReset()
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

  // -- feedback -------------------------------------------------------------
  // Uses the group runtime's lazy client so boot stays offline and feedback
  // remains available before sign-in when the Supabase project is configured.
  const feedback = createFeedbackService({
    getClient: () => groupRuntime.getClient(),
    rateGuard: createFeedbackRateGuard(),
    appVersion: resolveAppVersion(
      app.isPackaged,
      app.getVersion(),
      __APP_VERSION__
    ),
    platform: process.platform,
    getPalette: () => getSettings().palette
  })
  handle('feedback:send', (req) => feedback.send(req))

  assertEveryChannelHandled()
  try {
    deadlineScheduler.start()
  } catch (error) {
    console.error('[notifications] deadline scheduler startup failed', error)
  }
  app.on('before-quit', () => deadlineScheduler.dispose())

  return {
    miniPlayer,
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
