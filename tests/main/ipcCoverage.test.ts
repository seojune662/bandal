/**
 * Guards the gap that shipped `favorites:*` half-wired.
 *
 * `favorites:list|add|…` were declared in IpcContract and called from the
 * renderer with full type safety while `registerHandlers.ts` had no handlers
 * for them. `tsc` passed, `vitest` passed, and the app failed at runtime with
 * "No handler registered for 'favorites:add'".
 *
 * IPC_CHANNELS is the runtime witness for the contract's keys. These tests
 * keep it honest; `assertEveryChannelHandled()` in registerHandlers does the
 * other half at boot.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/ipc/contract'

const CONTRACT_SRC = join(process.cwd(), 'src/shared/ipc/contract.ts')
const HANDLERS_SRC = join(process.cwd(), 'src/main/ipc/registerHandlers.ts')

function mainRouterSource(): string {
  return readFileSync(HANDLERS_SRC, 'utf8')
}

/** Channel keys as literally declared in the IpcContract interface body. */
function declaredChannels(): string[] {
  const source = readFileSync(CONTRACT_SRC, 'utf8')
  const body = source.slice(
    source.indexOf('export interface IpcContract'),
    source.indexOf('export const IPC_CHANNELS')
  )
  return [...body.matchAll(/^ {2}'([a-z][A-Za-z]*:[A-Za-z]+)': \{/gm)].map(
    (match) => match[1] as string
  )
}

/** Channels registered via `handle('...')` in the main process. */
function handledChannels(): string[] {
  const source = mainRouterSource()
  return [...source.matchAll(/\bhandle\(\s*'([^']+)'/g)].map(
    (match) => match[1] as string
  )
}

describe('IPC channel coverage', () => {
  test('IPC_CHANNELS lists exactly what IpcContract declares', () => {
    expect([...IPC_CHANNELS].sort()).toEqual(declaredChannels().sort())
  })

  test('every declared channel has a handler in the main process', () => {
    const handled = new Set(handledChannels())
    const missing = IPC_CHANNELS.filter((channel) => !handled.has(channel))
    expect(missing).toEqual([])
  })

  test('no handler is registered for a channel that is not in the contract', () => {
    const declared = new Set<string>(IPC_CHANNELS)
    const stray = handledChannels().filter((channel) => !declared.has(channel))
    expect(stray).toEqual([])
  })

  test('no channel is registered twice', () => {
    const handled = handledChannels()
    expect(handled.length).toBe(new Set(handled).size)
  })

  test('the favorites channels specifically are wired', () => {
    // The regression that motivated this file.
    const handled = new Set(handledChannels())
    for (const channel of [
      'favorites:list',
      'favorites:add',
      'favorites:rename',
      'favorites:remove',
      'favorites:reorder'
    ]) {
      expect(handled).toContain(channel)
    }
  })

  test('batch 2 handlers delegate to their repositories', () => {
    const source = mainRouterSource()
    expect(source).toContain(
      "handle('board:reorderTasks', (req) =>\n    boardRepo.reorderTasks(req.courseId, req.updates)"
    )
    expect(source).toContain(
      'grants: chatRepo.listGrantDetails(req.courseId)'
    )
    expect(source).toContain('chatRepo.removeGrant(req.id)')
  })

  test('startup prunes both browser and desktop audit histories', () => {
    const source = mainRouterSource()
    expect(source).toMatch(
      /browserAudit\.prune\(\)\s*desktopAudit\.prune\(\)/
    )
  })

  test('notes rename returns the repository response without narrowing it', () => {
    const source = mainRouterSource()
    const rename = source.slice(
      source.indexOf("handle('notes:rename'"),
      source.indexOf("handle('notes:create'")
    )
    expect(rename).toMatch(
      /const result = notesRepo\.rename\(req\)[\s\S]*return result/
    )
  })

  test('undo awaits recoverable file deletion and returns the journal result', () => {
    const source = mainRouterSource()
    const undo = source.slice(
      source.indexOf("handle('agentTools:undo'"),
      source.indexOf("handle('agentTools:respondConfirm'")
    )
    expect(undo).toMatch(
      /handle\('agentTools:undo', \(req\) =>\s*agentJournal\.undoTurn\(req\.turnId/
    )
    expect(undo).toContain(
      'await materialsRepo.softDelete({ courseId, relPath: targetId })'
    )
    expect(undo.match(/await materialsRepo\.softDelete/g)).toHaveLength(2)
    expect(undo).not.toContain('.catch(() => undefined)')
    for (const target of [
      'course',
      'material',
      'note',
      'task',
      'board',
      'shape',
      "'material-edit'"
    ]) {
      expect(undo).toContain(`${target}: async (`)
    }
  })

  test('broadcast isolates destroyed windows and individual send failures', () => {
    const source = mainRouterSource()
    const body = source.slice(
      source.indexOf('export function broadcast'),
      source.indexOf('function screenPermissionState')
    )
    expect(body).toContain(
      'if (win.isDestroyed() || win.webContents.isDestroyed()) continue'
    )
    expect(body).toMatch(/try \{[\s\S]*webContents\.send\(channel, payload\)[\s\S]*catch \(error\)/)
    expect(body).toContain('console.error(`[ipc] ${channel} broadcast failed:`, error)')
  })

  test('successful course relinks broadcast the shared course change event', () => {
    const source = mainRouterSource()
    const relink = source.slice(
      source.indexOf("handle('courses:relink'"),
      source.indexOf("handle('courses:rename'")
    )
    expect(relink).toContain("if (result.status === 'ok')")
    expect(relink).toContain('return courseListChanged(result)')
  })

  test('group auth transitions reset whiteboard realtime state', () => {
    const source = mainRouterSource()
    expect(source).toMatch(
      /groupRuntime\.onAuthChanged\(\(\) => \{\s*whiteboardService\.resetForAuthChange\(\)/
    )
    expect(source).toMatch(
      /app\.on\('before-quit', \(\) => \{\s*stopWhiteboardAuthReset\(\)\s*whiteboardService\.dispose\(\)/
    )
  })
})
