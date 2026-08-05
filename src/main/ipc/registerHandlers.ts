/**
 * Registers a handler for EVERY channel in IpcContract (M0: typed stubs
 * returning empty data so renderer calls never throw).
 *
 * M1+ workstreams replace individual stubs with real implementations in
 * src/main/features/* — the `handle` helper keeps them contract-typed.
 */

import { ipcMain } from 'electron'
import type { IpcChannel, IpcRequest, IpcResponse } from '../../shared/ipc/contract'
import { getSettings, setSettings } from '../settingsStore'

/** Contract-typed wrapper around ipcMain.handle. */
function handle<K extends IpcChannel>(
  channel: K,
  fn: (req: IpcRequest<K>) => Promise<IpcResponse<K>> | IpcResponse<K>
): void {
  ipcMain.handle(channel, (_event, req: IpcRequest<K>) => fn(req))
}

const OK = { ok: true } as const

function nowIso(): string {
  return new Date().toISOString()
}

export function registerHandlers(): void {
  // -- courses --------------------------------------------------------------
  handle('courses:list', () => [])
  handle('courses:create', (req) => ({
    id: 'stub-course',
    name: req.name,
    slug: 'stub-course',
    color: req.color,
    folderPath: '',
    archived: false,
    sortOrder: 0,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }))
  handle('courses:rename', (req) => ({
    id: req.courseId,
    name: req.name,
    slug: 'stub-course',
    color: '#000000',
    folderPath: '',
    archived: false,
    sortOrder: 0,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }))
  handle('courses:archive', (req) => ({
    id: req.courseId,
    name: '',
    slug: 'stub-course',
    color: '#000000',
    folderPath: '',
    archived: req.archived,
    sortOrder: 0,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }))
  handle('courses:delete', () => OK)

  // -- materials ------------------------------------------------------------
  handle('materials:tree', () => [])
  handle('materials:search', () => [])
  handle('materials:import', () => ({ imported: [], failed: [] }))
  handle('materials:reveal', () => OK)
  handle('materials:readFile', () => ({ encoding: 'utf8', data: '' }))

  // -- notes ----------------------------------------------------------------
  handle('notes:read', (req) => ({
    courseId: req.courseId,
    relPath: req.relPath,
    markdown: '',
    mtime: 0
  }))
  handle('notes:write', () => ({ mtime: 0 }))
  handle('notes:create', (req) => ({
    courseId: req.courseId,
    relPath: `${req.dirRelPath === '' ? '' : `${req.dirRelPath}/`}${req.title}.md`
  }))

  // -- annotations ----------------------------------------------------------
  handle('annotations:listForFile', () => [])
  handle('annotations:create', (req) => ({
    id: 'stub-annotation',
    courseId: req.courseId,
    relPath: req.relPath,
    page: req.page,
    color: req.color,
    rects: req.rects,
    anchor: req.anchor,
    comment: req.comment ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }))
  handle('annotations:update', (req) => ({
    id: req.id,
    courseId: '',
    relPath: '',
    page: 1,
    color: req.color ?? 'yellow',
    rects: [],
    anchor: { quote: '', prefix: '', suffix: '' },
    comment: req.comment ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }))
  handle('annotations:delete', () => OK)

  // -- board ----------------------------------------------------------------
  handle('board:listTasks', () => [])
  handle('board:createTask', (req) => ({
    id: 'stub-task',
    courseId: req.courseId,
    title: req.title,
    notes: req.notes ?? '',
    status: req.status ?? 'todo',
    dueAt: req.dueAt ?? null,
    sortOrder: 0,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }))
  handle('board:updateTask', (req) => ({
    id: req.id,
    courseId: null,
    title: req.title ?? '',
    notes: req.notes ?? '',
    status: req.status ?? 'todo',
    dueAt: req.dueAt ?? null,
    sortOrder: req.sortOrder ?? 0,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }))
  handle('board:deleteTask', () => OK)

  // -- chat -----------------------------------------------------------------
  handle('chat:open', () => ({
    history: [],
    sessionInfo: null,
    availability: { installed: false, loggedIn: false }
  }))
  handle('chat:send', () => ({ turnSeq: 0 }))
  handle('chat:cancel', () => OK)
  handle('chat:respondPermission', () => OK)
  handle('chat:close', () => OK)

  // -- agent ----------------------------------------------------------------
  handle('agent:availability', () => ({ installed: false, loggedIn: false }))

  // -- browser --------------------------------------------------------------
  handle('browser:createView', () => OK)
  handle('browser:destroyView', () => OK)
  handle('browser:setBounds', () => OK)
  handle('browser:setVisible', () => OK)
  handle('browser:navigate', () => OK)
  handle('browser:back', () => OK)
  handle('browser:forward', () => OK)
  handle('browser:reload', () => OK)

  // -- settings (real implementation) ---------------------------------------
  handle('settings:get', () => getSettings())
  handle('settings:set', (req) => setSettings(req))

  // -- layout ---------------------------------------------------------------
  handle('layout:get', () => ({ layout: null }))
  handle('layout:save', () => OK)
}
