import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { ContentSearchIndexStatus } from '../../../shared/types/search'
import { emptySearchIndexStatus, type PdfSearchMessage, type PdfSearchRequest } from './pdfSearchProtocol'
import { searchRootPath } from './searchIndex'

/** Dedicated extraction process: a long PDF never occupies BackgroundClient's
 * interactive queue. Its watchdog measures inactivity, not document length. */
export function createPdfSearchClient(changed: (courseId: string) => void) {
  type Job = { id: number; key: string; request: PdfSearchRequest }
  const states = new Map<string, { status: ContentSearchIndexStatus; checkedAt: number }>()
  const requested = new Map<string, { request: PdfSearchRequest; requestedAt: number }>()
  const dirty = new Set<string>()
  const queued: Job[] = []
  let running: Job | undefined, child: UtilityProcess | undefined
  let timer: NodeJS.Timeout | undefined, sequence = 0, stopped = false
  let lastNotification = 0
  const keyFor = (request: PdfSearchRequest): string => JSON.stringify([request.courseId, request.folder, request.rootRelPath])
  const notify = (courseId: string, force = false): void => {
    if (force || Date.now() - lastNotification >= 250) { lastNotification = Date.now(); changed(courseId) }
  }
  const stopChild = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const previous = child; child = undefined; previous?.kill()
  }
  const fail = (reason: string): void => {
    const job = running
    stopChild(); running = undefined
    if (job) {
      const previous = states.get(job.key)?.status ?? emptySearchIndexStatus()
      states.set(job.key, { checkedAt: Date.now(), status: { ...previous, phase: 'partial', failures: [...previous.failures, { relPath: previous.currentRelPath ?? job.request.rootRelPath, reason }] } })
      notify(job.request.courseId, true)
    }
    pump()
  }
  const watch = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fail('PDF 검색 준비가 응답하지 않아 중지했어요. 다음 검색에서 다시 시도합니다.'), 60_000)
  }
  const pump = (): void => {
    if (stopped || running || !queued.length) return
    running = queued.shift()!
    try {
      if (!child) {
        const process = utilityProcess.fork(join(__dirname, 'pdfSearchHost.js'), [], { serviceName: 'Bandal PDF Search', stdio: 'pipe' })
        child = process
        process.stdout?.on('data', () => undefined)
        process.stderr?.on('data', () => undefined)
        process.on('exit', () => { if (child === process) fail('PDF 검색 준비 프로세스가 종료됐어요. 다음 검색에서 다시 시도합니다.') })
        process.on('message', (message: PdfSearchMessage) => {
          if (child !== process || running?.id !== message.id) return
          const job = running
          const previous = states.get(job.key)?.status
          states.set(job.key, { status: message.status, checkedAt: message.done ? Date.now() : 0 })
          watch()
          if (JSON.stringify(previous) !== JSON.stringify(message.status)) notify(job.request.courseId, message.done || message.status.phase !== 'indexing')
          if (message.done) {
            if (timer) clearTimeout(timer)
            timer = undefined; running = undefined
            if (dirty.delete(job.key)) {
              states.get(job.key)!.checkedAt = 0
              queued.push({ ...job, id: ++sequence })
            }
            pump()
          }
        })
      }
      watch()
      child.postMessage({ id: running.id, request: running.request })
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }
  const dispose = (): void => { stopped = true; queued.length = 0; requested.clear(); dirty.clear(); running = undefined; stopChild() }
  app.once('will-quit', dispose)
  return {
    refresh(request: PdfSearchRequest): ContentSearchIndexStatus {
      const rootRelPath = searchRootPath(request.rootRelPath)
      request = { ...request, rootRelPath }
      const key = keyFor(request)
      requested.set(key, { request, requestedAt: Date.now() })
      // A relinked course cannot let the old process write into the new cache.
      if (running?.request.courseId === request.courseId && running.request.folder !== request.folder) {
        running = undefined; stopChild()
      }
      for (let i = queued.length - 1; i >= 0; i--) if (queued[i]!.request.courseId === request.courseId && queued[i]!.request.folder !== request.folder) queued.splice(i, 1)
      for (const [oldKey, entry] of requested) {
        if (entry.request.courseId === request.courseId && entry.request.folder !== request.folder) {
          requested.delete(oldKey); states.delete(oldKey); dirty.delete(oldKey)
        }
      }
      const previous = states.get(key)
      if (!stopped && running?.key !== key && !queued.some(job => job.key === key) && (!previous || Date.now() - previous.checkedAt >= 10_000)) {
        // Retain a completed status while quietly checking unchanged files;
        // don't bounce the UI into indexing on every search query.
        if (!previous) states.set(key, { checkedAt: 0, status: { ...emptySearchIndexStatus(), phase: 'indexing' } })
        queued.push({ id: ++sequence, key, request }); pump()
      }
      return states.get(key)?.status ?? emptySearchIndexStatus()
    },
    invalidate(courseId: string): void {
      if (stopped) return
      for (const [key, entry] of requested) {
        const { request } = entry
        if (request.courseId !== courseId) continue
        const state = states.get(key)
        if (state) state.checkedAt = 0
        if (running?.key === key) dirty.add(key)
        else if (Date.now() - entry.requestedAt < 30_000 && !queued.some(job => job.key === key)) queued.push({ id: ++sequence, key, request })
      }
      pump()
    },
    dispose
  }
}
