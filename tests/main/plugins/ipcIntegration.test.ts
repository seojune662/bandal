import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const HANDLERS_SOURCE = join(process.cwd(), 'src/main/ipc/registerHandlers.ts')

const PLUGIN_CHANNELS = [
  'plugins:list',
  'plugins:pickFolder',
  'plugins:installFromFolder',
  'plugins:uninstall',
  'plugins:setEnabled',
  'plugins:approve',
  'plugins:reload',
  'plugins:runCommand',
  'plugins:logs',

  'plugins:catalog',

  'plugins:installFromCatalog'
] as const

describe('plugin IPC integration', () => {
  test('registers one handler for every plugins:* request channel', () => {
    const source = readFileSync(HANDLERS_SOURCE, 'utf8')

    for (const channel of PLUGIN_CHANNELS) {
      expect(source).toContain(`handle('${channel}'`)
    }

    const registered = [...source.matchAll(/handle\('(plugins:[^']+)'/g)].map(
      (match) => match[1]
    )
    expect(registered.sort()).toEqual([...PLUGIN_CHANNELS].sort())
  })
})
