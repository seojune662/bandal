import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type {
  PluginLogEntry,
  PluginManifest,
  PluginPermission
} from '../../../src/shared/types/plugin'
import type {
  HostToMain,
  MainToHost
} from '../../../src/shared/types/pluginRpc'
import { createPluginBroker, type PluginApiImpl } from '../../../src/main/features/plugins/rpcBroker'
import { createHostRuntime } from '../../../src/main/pluginHost/runtime'

function readManifest(directory: string): PluginManifest {
  return JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as PluginManifest
}

async function waitForHostMessage(
  messages: HostToMain[],
  predicate: (message: HostToMain) => boolean
): Promise<HostToMain> {
  let found: HostToMain | undefined
  await vi.waitFor(() => {
    found = messages.find(predicate)
    expect(found).toBeDefined()
  })
  return found!
}

function integratedRuntime(options: {
  manifest: PluginManifest
  directory: string
  permissions: readonly PluginPermission[]
  api: PluginApiImpl
}) {
  const messages: HostToMain[] = []
  const logs: Array<Omit<PluginLogEntry, 'at'>> = []
  let deliverToHost: ((message: MainToHost) => void) | null = null
  const broker = createPluginBroker({
    api: options.api,
    permissionsFor: (pluginId) =>
      pluginId === options.manifest.id ? options.permissions : null,
    limiter: { take: () => true },
    log: (entry) => logs.push(entry)
  })
  const runtime = createHostRuntime(
    {
      post: (message) => {
        messages.push(message)
        void broker.handle(message).then((response) => {
          if (response !== null) deliverToHost?.(response)
        })
      },
      onMessage: (callback) => {
        deliverToHost = callback
      }
    },
    { readFile: (path) => readFileSync(path, 'utf8'), now: Date.now }
  )

  function send(message: MainToHost): void {
    if (deliverToHost === null) throw new Error('host transport is not ready')
    deliverToHost(message)
  }

  send({
    t: 'load',
    pluginId: options.manifest.id,
    dir: options.directory,
    manifest: options.manifest,
    appVersion: '0.36.0'
  })

  return { logs, messages, runtime, send }
}

function fakeApi(overrides: Partial<PluginApiImpl> = {}): PluginApiImpl {
  const empty = async () => null
  return {
    'courses.list': empty,
    'courses.current': empty,
    'notes.list': empty,
    'notes.read': empty,
    'notes.write': empty,
    'notes.create': empty,
    'materials.list': empty,
    'materials.readText': empty,
    'notices.show': empty,
    'settings.get': empty,
    'settings.set': empty,
    'panel.post': empty,
    'panel.open': empty,
    'net.fetch': empty,
    ...overrides
  }
}

describe('plugin host + broker integration', () => {
  test('loads word-count and sends calculated rows to its notice and panel', async () => {
    const directory = join(process.cwd(), 'examples/plugins/word-count')
    const manifest = readManifest(directory)
    const notice = vi.fn(async () => null)
    const panelPost = vi.fn(async () => null)
    const notes = new Map([
      ['note-1', { content: '하나 둘  셋' }],
      ['note-2', { content: 'four five\n여섯' }]
    ])
    const api = fakeApi({
      'courses.current': async () => ({ id: 'course-1', name: '알고리즘' }),
      'notes.list': async () => [
        { id: 'note-1', title: '첫 노트' },
        { id: 'note-2', title: '둘째 노트' }
      ],
      'notes.read': async (_pluginId, noteId) => notes.get(String(noteId)),
      'notices.show': notice,
      'panel.post': panelPost
    })
    const harness = integratedRuntime({
      directory,
      manifest,
      permissions: manifest.permissions,
      api
    })
    await waitForHostMessage(
      harness.messages,
      (message) => message.t === 'activated' && message.ok
    )

    harness.send({
      t: 'command',
      id: 1,
      pluginId: manifest.id,
      commandId: 'count-current'
    })

    await waitForHostMessage(
      harness.messages,
      (message) => message.t === 'commandResult' && message.id === 1 && message.ok
    )
    expect(notice).toHaveBeenCalledWith(
      manifest.id,
      expect.stringContaining('6')
    )
    expect(panelPost).toHaveBeenCalledWith(
      manifest.id,
      'stats',
      expect.objectContaining({
        rows: [
          expect.objectContaining({ title: '첫 노트', words: 3 }),
          expect.objectContaining({ title: '둘째 노트', words: 3 })
        ]
      })
    )
    harness.runtime.dispose()
  })

  test('denies overreach when a plugin calls notes.write without its grant', async () => {
    const directory = join(process.cwd(), 'examples/plugins/_fixtures/overreach')
    const manifest = readManifest(directory)
    const notesWrite = vi.fn(async () => null)
    const harness = integratedRuntime({
      directory,
      manifest,
      permissions: manifest.permissions,
      api: fakeApi({ 'notes.write': notesWrite })
    })
    await waitForHostMessage(
      harness.messages,
      (message) => message.t === 'activated' && message.ok
    )

    harness.send({
      t: 'command',
      id: 2,
      pluginId: manifest.id,
      commandId: 'overwrite-note'
    })

    await waitForHostMessage(
      harness.messages,
      (message) => message.t === 'commandResult' && message.id === 2
    )
    expect(notesWrite).not.toHaveBeenCalled()
    expect(harness.logs).toEqual([
      expect.objectContaining({
        pluginId: manifest.id,
        level: 'denied'
      })
    ])
    harness.runtime.dispose()
  })
})
