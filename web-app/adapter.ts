/**
 * IPC adapter for the logged-in web app. It plugs into the renderer's own
 * seam (`src/renderer/src/lib/ipc.ts`), the same way `web-demo/` does, so
 * every visible component is the production desktop UI.
 *
 * Content (courses, PDFs, notes, drawings) comes from the person's Google
 * Drive sync root through `workspace.ts`, and is read-only in this phase.
 * Only per-browser UI state (settings, layouts, PDF scroll positions) is kept,
 * in localStorage. That state is never written to Drive.
 */
import { importInkObject } from '../src/main/features/sync/adapter'
import type { IpcChannel, IpcRequest, IpcResponse } from '../src/shared/ipc/contract'
import type { PushChannel, PushPayload } from '../src/shared/ipc/events'
import type { IpcAdapter } from '../src/renderer/src/lib/ipc'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types/settings'
import type { Drawing } from '../src/shared/types/drawing'
import type { MaterialNode } from '../src/shared/types/materials'
import type { PdfViewState } from '../src/shared/types/pdfViewState'
import type { Drive } from './drive'
import { mimeFor } from './media'
import { docKey, type WebDoc, type Workspace } from './workspace'

export const ko = !navigator.language.toLowerCase().startsWith('en') || new URLSearchParams(location.search).get('lang') === 'ko'
const READ_ONLY = ko
  ? '웹 반달은 지금 보기 전용이에요. 편집과 이 기능은 설치한 반달 앱에서 사용할 수 있어요.'
  : 'Bandal on the web is view-only for now. Edit in the desktop app.'
/** IPAD_ANNOUNCEMENT_ID in features/announcements/IpadAnnouncement.tsx. Not imported: that module loads stores before the adapter is installed. */
const IPAD_ANNOUNCEMENT_ID = 'ipad-launch-2026-10'
const NOTE_ASSET = /\.\.\/\.\.\/assets\/([0-9a-f]{64})\.([a-z0-9]{1,16})/g
const ASSET_PATH = /^assets\/([0-9a-f]{64})\.([a-z0-9]{1,16})$/
/** PDFs and images downloaded this session, oldest first; dropped past this many bytes. */
const MEDIA_BUDGET = 512 * 1024 * 1024

interface Session { workspace: Workspace; drive: Drive; cache: Map<string, { md5: string; bytes: Uint8Array }> }
let current: Session | null = null
const media = new Map<string, Promise<Uint8Array>>()
const mediaSizes = new Map<string, number>()
const pdfPages = new Map<string, { page: number; text: string }[]>()
/** Text-box heights the renderer measured for this browser's fonts (InkLayer auto-fit); display only, never written. */
const fittedBoxes = new Map<string, Drawing['data']['box']>()

export function attachWorkspace(session: Session): void {
  const previous = current?.workspace.rootId
  current = session
  if (previous !== session.workspace.rootId) { media.clear(); mediaSizes.clear(); pdfPages.clear(); fittedBoxes.clear() }
  emit('courses:changed', {})
  for (const course of session.workspace.courses) emit('materials:changed', { courseId: course.id })
}

export function detachWorkspace(): void {
  current = null; media.clear(); mediaSizes.clear(); pdfPages.clear(); fittedBoxes.clear()
}

const session = (): Session => {
  if (!current) throw new Error(ko ? 'Google Drive에 연결되지 않았어요.' : 'Google Drive is not connected.')
  return current
}

// --- per-browser UI state ---------------------------------------------------

const localKey = (name: string): string => `bandal:web:${current?.workspace.rootId ?? 'none'}:${name}`
function readLocal<T>(name: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(localKey(name)) ?? 'null') as T | null) ?? fallback } catch { return fallback }
}
function writeLocal(name: string, value: unknown): void {
  try { localStorage.setItem(localKey(name), JSON.stringify(value)) } catch { /* UI state is optional. */ }
}

const baseSettings = (): Settings => ({
  ...structuredClone(DEFAULT_SETTINGS), locale: ko ? 'ko-KR' : 'en-US', restoreLastCourse: true,
  // Opens in the website's light or dark (main.tsx); a choice made in the app's settings is kept per browser.
  theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  onboarding: { flowVersion: 2, closedAt: new Date(0).toISOString(), lastCompletedStep: 3 },
  tutorial: { seenVersion: 1, activeCourseId: null },
  // The iPad launch card advertises a native download; not shown in the browser.
  dismissedAnnouncements: [...DEFAULT_SETTINGS.dismissedAnnouncements, IPAD_ANNOUNCEMENT_ID]
})
let settings: Settings = baseSettings()
export function loadSettings(): Settings {
  const stored = readLocal<Partial<Settings>>('settings', {})
  const base = baseSettings()
  settings = { ...base, ...stored, onboarding: base.onboarding, tutorial: base.tutorial, dismissedAnnouncements: [...new Set([...base.dismissedAnnouncements, ...(stored.dismissedAnnouncements ?? [])])] }
  if (settings.lastActiveCourseId && !current?.workspace.courses.some(course => course.id === settings.lastActiveCourseId)) settings.lastActiveCourseId = current?.workspace.courses[0]?.id ?? null
  if (!settings.lastActiveCourseId) settings.lastActiveCourseId = current?.workspace.courses[0]?.id ?? null
  return settings
}

// --- push events ---------------------------------------------------------------

const listeners = new Map<string, Set<(value: never) => void>>()
export function emit<K extends PushChannel>(channel: K, value: PushPayload<K>): void {
  for (const callback of listeners.get(channel) ?? []) callback(structuredClone(value) as never)
}

// --- content -------------------------------------------------------------------

function docAt(courseId: string, relPath: string): WebDoc {
  const doc = session().workspace.docs.get(docKey(courseId, relPath))
  if (!doc) throw new Error(ko ? '자료를 찾을 수 없어요. Google Drive와 다시 맞춰 보세요.' : 'Material not found.')
  return doc
}

async function rootBytes(path: string): Promise<Uint8Array> {
  const { workspace, drive, cache } = session()
  const cached = cache.get(path)
  if (cached) return cached.bytes
  const file = workspace.files.get(path)
  if (!file) throw Object.assign(new Error('not_found'), { status: 404 })
  return drive.download(file)
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

const hex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** A `pdf/` or `assets/` file, checked against the hash in its name (spec 원격 입력 검증). */
function contentBytes(path: string, sha: string): Promise<Uint8Array> {
  let pending = media.get(path)
  if (!pending) {
    pending = rootBytes(path).then(async bytes => {
      if (hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)) !== sha) throw Object.assign(new Error('hash_mismatch'), { status: 404 })
      mediaSizes.set(path, bytes.byteLength)
      let total = [...mediaSizes.values()].reduce((sum, size) => sum + size, 0)
      for (const old of mediaSizes.keys()) {
        if (total <= MEDIA_BUDGET || old === path) continue
        total -= mediaSizes.get(old) ?? 0
        mediaSizes.delete(old); media.delete(old)
      }
      return bytes
    })
    pending.catch(() => { media.delete(path) })
    media.set(path, pending)
  }
  return pending
}

function noteMarkdown(doc: WebDoc): string {
  const bytes = doc.noteFile ? session().cache.get(doc.noteFile)?.bytes : undefined
  if (!bytes) throw new Error(ko ? '필기를 불러오지 못했어요.' : 'Could not load the note.')
  // The renderer resolves a note's images in the course's assets/ folder, as the desktop stores them.
  return new TextDecoder('utf-8').decode(bytes).replace(NOTE_ASSET, 'assets/$1.$2')
}

/** Bytes for `/app/media/<course>/<path>`: a PDF, a note, or an image a note or drawing links to. */
export async function resolveMedia(courseId: string, relPath: string): Promise<{ bytes: Uint8Array; type: string }> {
  const asset = ASSET_PATH.exec(relPath)
  if (asset) return { bytes: await contentBytes(relPath, asset[1]!), type: mimeFor(relPath) }
  const doc = docAt(courseId, relPath)
  if (doc.type === 'pdf' && doc.pdf) return { bytes: await contentBytes(`pdf/${doc.pdf}.pdf`, doc.pdf), type: 'application/pdf' }
  return { bytes: new TextEncoder().encode(noteMarkdown(doc)), type: 'text/markdown; charset=utf-8' }
}

function tree(courseId: string): MaterialNode[] {
  const roots: MaterialNode[] = [], dirs = new Map<string, MaterialNode>()
  const dir = (path: string): MaterialNode[] => {
    if (path === '') return roots
    const known = dirs.get(path)
    if (known) return known.children!
    const slash = path.lastIndexOf('/')
    const node: MaterialNode = { relPath: path, name: path.slice(slash + 1), kind: 'dir', children: [] }
    dirs.set(path, node)
    dir(slash < 0 ? '' : path.slice(0, slash)).push(node)
    return node.children!
  }
  const docs = [...session().workspace.docs.values()].filter(doc => doc.courseId === courseId)
  for (const doc of docs) {
    const slash = doc.relPath.lastIndexOf('/')
    dir(slash < 0 ? '' : doc.relPath.slice(0, slash)).push({
      relPath: doc.relPath, name: doc.relPath.slice(slash + 1), kind: doc.type === 'pdf' ? 'pdf' : 'note', size: doc.size, mtime: doc.mtime, addedAt: doc.addedAt
    })
  }
  const sort = (nodes: MaterialNode[]): MaterialNode[] => {
    nodes.sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name, ko ? 'ko' : 'en', { numeric: true }))
    for (const node of nodes) if (node.children) sort(node.children)
    return nodes
  }
  return sort(roots)
}

function drawings(courseId: string, relPath: string, page?: number): Drawing[] {
  const doc = docAt(courseId, relPath)
  const { workspace } = session()
  const result: Drawing[] = []
  for (const object of workspace.ink.get(doc.id) ?? []) {
    if (page !== undefined && object.page !== page) continue
    try {
      const imported = importInkObject(object, image => {
        const path = `assets/${image.sha256}.${image.ext}`
        return workspace.files.has(path) ? path : null
      })
      if (imported.action !== 'upsert') continue
      const { fields } = imported
      const box = fittedBoxes.get(object.id)
      result.push({ id: object.id, courseId, relPath, page: fields.page, kind: fields.kind, data: box ? { ...fields.data, box } : fields.data, style: fields.style, createdAt: fields.created_at, updatedAt: fields.updated_at })
    } catch {
      // A drawing the desktop would also reject (ValidationError) is left out, as there.
    }
  }
  return result
}

function pdfRevision(courseId: string, relPath: string): string {
  const doc = docAt(courseId, relPath)
  if (doc.type !== 'pdf' || !doc.pdf) throw new Error(ko ? 'PDF 자료가 아니에요.' : 'Not a PDF.')
  return doc.pdf
}

function search(courseId: string, query: string, rootRelPath: string, limit: number) {
  const needle = query.normalize('NFC').trim().toLocaleLowerCase()
  const inside = (path: string) => !rootRelPath || path === rootRelPath || path.startsWith(rootRelPath + '/')
  const docs = [...session().workspace.docs.values()].filter(doc => doc.courseId === courseId && inside(doc.relPath))
  type Searchable = { kind: 'note' | 'pdf'; relPath: string; page: number | null; text: string }
  const documents = docs.flatMap((doc): Searchable[] => {
    if (doc.type === 'md') { try { return [{ kind: 'note' as const, relPath: doc.relPath, page: null, text: noteMarkdown(doc) }] } catch { return [] } }
    return (pdfPages.get(docKey(courseId, doc.relPath)) ?? []).map(page => ({ kind: 'pdf' as const, relPath: doc.relPath, page: page.page, text: page.text }))
  })
  const hits = needle ? documents.flatMap(document => {
    const text = document.text.normalize('NFC'), index = text.toLocaleLowerCase().indexOf(needle)
    return index < 0 ? [] : [{ kind: document.kind, relPath: document.relPath, page: document.page, snippet: text.slice(Math.max(0, index - 50), index + needle.length + 110), score: 1 }]
  }).sort((a, b) => a.relPath.localeCompare(b.relPath, 'ko') || (a.page ?? 0) - (b.page ?? 0)).slice(0, Math.min(Math.max(1, limit), 100)) : []
  const pdfs = docs.filter(doc => doc.type === 'pdf')
  const indexed = pdfs.filter(doc => pdfPages.has(docKey(courseId, doc.relPath)))
  return { hits, indexing: { phase: 'ready' as const, processedFiles: docs.length - pdfs.length + indexed.length, totalFiles: docs.length, indexedPages: indexed.reduce((sum, doc) => sum + (pdfPages.get(docKey(courseId, doc.relPath))?.length ?? 0), 0), failures: [] } }
}

/** Channels the shell calls on its own at start-up; the desktop features behind them simply are not here. */
const QUIET = new Set<string>(['sync:status'])

type Handlers = { [K in IpcChannel]?: (req: IpcRequest<K>) => IpcResponse<K> | Promise<IpcResponse<K>> }
const ok = { ok: true } as const

const handlers: Handlers = {
  'settings:get': () => structuredClone(settings),
  'settings:set': patch => {
    // Nested groups (tabs, university, …) arrive partial, as the main process merges them.
    const next: Record<string, unknown> = { ...settings }
    for (const [key, value] of Object.entries(patch)) {
      const before = next[key]
      next[key] = value && typeof value === 'object' && !Array.isArray(value) && before && typeof before === 'object' && !Array.isArray(before) ? { ...before, ...value } : value
    }
    settings = next as unknown as Settings
    const { onboarding: _onboarding, tutorial: _tutorial, ...kept } = settings
    writeLocal('settings', kept)
    emit('settings:changed', { settings })
    return structuredClone(settings)
  },
  'courses:list': ({ includeArchived }) => session().workspace.courses.filter(course => includeArchived || !course.archived),
  'courseGroups:list': () => [],
  'courseLinks:list': () => [],
  'layout:get': ({ courseId }) => ({ layout: readLocal<Record<string, unknown>>('layouts', {})[courseId] ?? null }),
  'layout:save': ({ courseId, layout }) => { writeLocal('layouts', { ...readLocal<Record<string, unknown>>('layouts', {}), [courseId]: layout }); return ok },
  'layout:saveMany': ({ layouts }) => {
    const next = readLocal<Record<string, unknown>>('layouts', {})
    for (const { courseId, layout } of layouts) next[courseId] = layout
    writeLocal('layouts', next)
    return ok
  },
  'materials:snapshot': ({ courseId }) => ({ tree: tree(courseId) }),
  'materials:tree': ({ courseId }) => tree(courseId),
  'materials:search': ({ courseId, query }) => [...session().workspace.docs.values()]
    .filter(doc => doc.courseId === courseId && doc.relPath.toLowerCase().includes(query.toLowerCase()))
    .map(doc => ({ relPath: doc.relPath, name: doc.relPath.slice(doc.relPath.lastIndexOf('/') + 1), kind: doc.type === 'pdf' ? 'pdf' as const : 'note' as const, score: 1, addedAt: doc.addedAt })),
  'materials:watch': () => ok,
  'materials:unwatch': () => ok,
  'share:list': () => [],
  'materials:readFile': async ({ courseId, relPath }) => {
    // Images placed on a PDF or in a note are read as base64 (ImageShape, note images).
    const asset = ASSET_PATH.exec(relPath)
    if (asset) return { encoding: 'base64', data: base64(await contentBytes(relPath, asset[1]!)) }
    return { encoding: 'utf8', data: noteMarkdown(docAt(courseId, relPath)) }
  },
  'materials:hoverPreview': ({ courseId, relPath }) => {
    const doc = docAt(courseId, relPath), name = relPath.slice(relPath.lastIndexOf('/') + 1)
    if (doc.type === 'pdf') return { name, relPath, size: doc.size, mtime: doc.mtime, content: { kind: 'pdf' } }
    const markdown = noteMarkdown(doc)
    return { name, relPath, size: doc.size, mtime: doc.mtime, content: { kind: 'markdown', text: markdown.slice(0, 1200), truncated: markdown.length > 1200 } }
  },
  'notes:read': ({ courseId, relPath }) => { const doc = docAt(courseId, relPath); return { courseId, relPath, markdown: noteMarkdown(doc), mtime: doc.mtime } },
  'pdfNotes:info': ({ courseId, relPath }) => ({ documentRevision: pdfRevision(courseId, relPath), paper: null, surface: 'light', orientation: 'portrait' }),
  'pdfNotes:migrateLegacy': () => ({ migrated: [], failed: [] }),
  'pdf:previewSnapshot': ({ courseId, relPath }) => ({ documentRevision: pdfRevision(courseId, relPath), drawings: drawings(courseId, relPath, 1), annotations: [] }),
  'pdf:getViewState': ({ courseId, relPath }) => readLocal<Record<string, PdfViewState>>('views', {})[docKey(courseId, relPath)] ?? null,
  'pdf:setViewState': req => {
    const view = { ...req, updatedAt: new Date().toISOString() } as PdfViewState
    writeLocal('views', { ...readLocal<Record<string, PdfViewState>>('views', {}), [docKey(req.courseId, req.relPath)]: view })
    return view
  },
  // The sync format carries highlights as ink (spec 필기), so annotations are always empty here.
  'annotations:listForFile': () => [],
  'drawings:listForFile': ({ courseId, relPath }) => drawings(courseId, relPath),
  // Only the renderer's own geometry fit on display is accepted, in memory: a text box's height for this
  // browser's fonts (InkLayer) or an image box fitted to its aspect ratio. Same horizontal extent, same content.
  'drawings:update': input => {
    const found = [...session().workspace.docs.values()].flatMap(doc => session().workspace.ink.has(doc.id) ? drawings(doc.courseId, doc.relPath) : []).find(drawing => drawing.id === input.id)
    const { id: _id, documentRevision: _revision, data, ...rest } = input as typeof input & { documentRevision?: string }
    const before = found?.data.box, after = data?.box
    const onlyFit = (found?.kind === 'textbox' || found?.kind === 'image') && data && before && after && Object.keys(rest).length === 0 &&
      after.x === before.x && after.width === before.width &&
      JSON.stringify({ ...data, box: undefined }) === JSON.stringify({ ...found.data, box: undefined })
    if (!found || !onlyFit) {
      window.dispatchEvent(new CustomEvent('bandal-web-unavailable', { detail: 'drawings:update' }))
      throw new Error(READ_ONLY)
    }
    fittedBoxes.set(found.id, after)
    return { ...found, data: { ...found.data, box: after } }
  },
  'agent:installCommand': () => ({ command: '', supported: false }),
  // Page links, boards, tasks and chats are not part of the sync format: the shell shows them empty.
  'links:listFor': () => ({ outgoing: [], incoming: [] }),
  'links:listForDescriptor': () => ({ outgoing: [], incoming: [] }),
  'links:forMaterial': () => ({ notes: [], boards: [] }),
  'links:graph': () => ({ links: [], backlinks: [] }),
  'board:listTasks': () => [],
  'calendar:range': () => [],
  'calendar:upcoming': () => [],
  'appleCalendar:state': () => ({ supported: false, connected: false, authorization: 'not-determined', calendars: [], selectedCalendarIds: [], destinationCalendarId: null }),
  'appleCalendar:events': () => [],
  'window:getState': () => ({ fullscreen: false }),
  'window:setPrintEnabled': () => ok,
  'browser:setHostOccluded': () => ok,
  'auth:getState': () => ({ phase: 'unconfigured', profile: null, email: null, avatarUrl: null, online: navigator.onLine, errorCode: null }),
  'community:takeIntent': () => null,
  'community:request': ({ action }) => {
    if (action === 'context') return { configured: false, signedIn: false, operator: false, campaign: null }
    throw new Error(READ_ONLY)
  },
  'plugins:list': () => ({ plugins: [] }),
  'plugins:devFolders': () => ({ folders: [] }),
  'packs:list': () => ({ packs: [] }),
  'study:tools': () => ({ tools: [] }),
  'canvas:list': () => [],
  'favorites:list': () => [],
  'activity:recent': () => [],
  'activity:record': () => ok,
  'browser:setDownloadTarget': () => ok,
  'browserAgent:syncTabs': () => ok,
  'agent:syncWorkspace': () => ok,
  'ui:consumePendingOpen': () => null,
  'agent:availability': () => ({ installed: false, loggedIn: false }),
  'agent:skills': () => [],
  'agentTools:confirmations': () => [],
  'chat:grants': () => ({ grants: [] }),
  'chat:conversations': () => ({ conversations: [] }),
  // AI runs through the desktop's local agents; the panel shows its not-installed state here.
  'chat:open': () => ({ history: [], sessionInfo: null, availability: { installed: false, loggedIn: false } }),
  'shell:openExternal': ({ url }) => {
    const target = new URL(url)
    if (target.protocol !== 'https:') throw new Error(READ_ONLY)
    window.open(target.href, '_blank', 'noopener,noreferrer')
    return ok
  },
  'mcp:list': () => ({ servers: [], availability: { available: false, reason: READ_ONLY } }),
  'search:indexPdfPages': ({ courseId, relPath, pages }) => {
    const key = docKey(courseId, relPath)
    if (session().workspace.docs.has(key)) pdfPages.set(key, pages.map(page => ({ page: page.page, text: page.text })))
    return ok
  },
  'search:query': ({ courseId, query, rootRelPath = '', limit = 30 }) => search(courseId, query, rootRelPath, Number.isInteger(limit) ? limit : 30)
}

export const adapter: IpcAdapter = {
  async invoke<K extends IpcChannel>(channel: K, req: IpcRequest<K>): Promise<IpcResponse<K>> {
    const handler = handlers[channel] as ((input: IpcRequest<K>) => IpcResponse<K> | Promise<IpcResponse<K>>) | undefined
    if (handler) return structuredClone(await handler(req))
    if (channel === 'update:status') return { phase: 'unsupported', currentVersion: __APP_VERSION__ } as IpcResponse<K>
    // Background status checks fail quietly; only something the person asked for gets the notice.
    if (!QUIET.has(channel)) window.dispatchEvent(new CustomEvent('bandal-web-unavailable', { detail: channel }))
    throw new Error(READ_ONLY)
  },
  on(channel, callback) {
    let set = listeners.get(channel)
    if (!set) { set = new Set(); listeners.set(channel, set) }
    set.add(callback as (value: never) => void)
    return () => { set.delete(callback as (value: never) => void) }
  }
}
