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
  const source = readFileSync(HANDLERS_SRC, 'utf8')
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
})
