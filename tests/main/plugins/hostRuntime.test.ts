import { describe, expect, test, vi } from 'vitest'
import type { PluginManifest } from '../../../src/shared/types/plugin'
import type {
  HostToMain,
  MainToHost,
  PluginApiMethod
} from '../../../src/shared/types/pluginRpc'
import { createHostRuntime } from '../../../src/main/pluginHost/runtime'

const manifest: PluginManifest = {
  manifestVersion: 1,
  id: 'bandal.runtime-test',
  name: '런타임 테스트',
  version: '1.0.0',
  minAppVersion: '0.36.0',
  description: '호스트 런타임 테스트 플러그인',
  author: 'Bandal',
  main: 'main.js',
  permissions: ['commands', 'notes.read', 'notices', 'panel', 'events'],
  contributes: {
    commands: [{ id: 'run', title: '실행', defaultChord: null }],
    panels: [{ id: 'test', title: '테스트', entry: 'index.html' }]
  },
  styles: null
}

const API_CASES: ReadonlyArray<
  readonly [expression: string, method: PluginApiMethod, args: readonly unknown[]]
> = [
  ['bandal.courses.list()', 'courses.list', []],
  ['bandal.courses.current()', 'courses.current', []],
  ["bandal.notes.list('course-1')", 'notes.list', ['course-1']],
  ["bandal.notes.read('note-1')", 'notes.read', ['note-1']],
  [
    "bandal.notes.write('note-1', { content: 'changed' })",
    'notes.write',
    ['note-1', { content: 'changed' }]
  ],
  [
    "bandal.notes.create('course-1', { title: 'new' })",
    'notes.create',
    ['course-1', { title: 'new' }]
  ],
  ["bandal.materials.list('course-1')", 'materials.list', ['course-1']],
  [
    "bandal.materials.readText('course-1', 'week-1.txt')",
    'materials.readText',
    ['course-1', 'week-1.txt']
  ],
  ["bandal.notices.show('hello')", 'notices.show', ['hello']],
  ["bandal.settings.get('color')", 'settings.get', ['color']],
  [
    "bandal.settings.set('color', 'violet')",
    'settings.set',
    ['color', 'violet']
  ],
  [
    "bandal.panel.post('test', { ready: true })",
    'panel.post',
    ['test', { ready: true }]
  ],
  ["bandal.panel.open('test')", 'panel.open', ['test']],
  [
    "bandal.fetch('https://api.example.com/data', { method: 'GET' })",
    'net.fetch',
    ['https://api.example.com/data', { method: 'GET' }]
  ]
]

function createHarness(source: string) {
  const posted: HostToMain[] = []
  let receive: ((message: MainToHost) => void) | null = null
  const readFile = vi.fn((_path: string) => source)
  const runtime = createHostRuntime(
    {
      post: (message) => posted.push(message),
      onMessage: (callback) => {
        receive = callback
      }
    },
    { readFile, now: () => 1234 }
  )

  function send(message: MainToHost): void {
    if (receive === null) throw new Error('transport callback not registered')
    receive(message)
  }

  return { posted, readFile, runtime, send }
}

async function waitForMessage(
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

function loadMessage(): MainToHost {
  return {
    t: 'load',
    pluginId: manifest.id,
    dir: '/plugins/bandal.runtime-test',
    manifest,
    appVersion: '0.36.0'
  }
}

describe('createHostRuntime', () => {
  test('loads CommonJS in the requested directory and reports registered commands', async () => {
    const harness = createHarness(`
      module.exports = {
        activate(bandal) {
          bandal.commands.register('run', async () => {})
        }
      }
    `)

    harness.send(loadMessage())

    await expect(
      waitForMessage(
        harness.posted,
        (message) => message.t === 'activated' && message.ok
      )
    ).resolves.toMatchObject({
      t: 'activated',
      pluginId: manifest.id,
      ok: true,
      commands: ['run']
    })
    expect(harness.readFile).toHaveBeenCalledWith(
      '/plugins/bandal.runtime-test/main.js'
    )
    harness.runtime.dispose()
  })

  test('reports activation failures instead of crashing the host', async () => {
    const harness = createHarness(`
      module.exports = { activate() { throw new Error('broken activate') } }
    `)

    harness.send(loadMessage())

    await expect(
      waitForMessage(
        harness.posted,
        (message) => message.t === 'activated' && !message.ok
      )
    ).resolves.toMatchObject({
      t: 'activated',
      ok: false,
      error: expect.stringContaining('broken activate')
    })
    harness.runtime.dispose()
  })

  test('turns bandal API calls into increasing-id RPC messages', async () => {
    const harness = createHarness(`
      module.exports = {
        activate(bandal) {
          bandal.commands.register('run', async () => {
            const note = await bandal.notes.read('note-1')
            await bandal.notices.show(note.content)
          })
        }
      }
    `)
    harness.send(loadMessage())
    await waitForMessage(harness.posted, (message) => message.t === 'activated')

    harness.send({
      t: 'command',
      id: 90,
      pluginId: manifest.id,
      commandId: 'run'
    })
    const read = await waitForMessage(
      harness.posted,
      (message) => message.t === 'api' && message.method === 'notes.read'
    )
    expect(read).toMatchObject({
      t: 'api',
      pluginId: manifest.id,
      method: 'notes.read',
      args: ['note-1']
    })
    if (read.t !== 'api') throw new Error('expected API request')
    harness.send({
      t: 'apiResult',
      id: read.id,
      ok: true,
      value: { content: '세 단어 노트' }
    })

    const notice = await waitForMessage(
      harness.posted,
      (message) => message.t === 'api' && message.method === 'notices.show'
    )
    expect(notice).toMatchObject({ args: ['세 단어 노트'] })
    if (notice.t !== 'api') throw new Error('expected API request')
    expect(notice.id).toBeGreaterThan(read.id)
    harness.send({ t: 'apiResult', id: notice.id, ok: true, value: null })

    await expect(
      waitForMessage(
        harness.posted,
        (message) => message.t === 'commandResult' && message.id === 90
      )
    ).resolves.toMatchObject({ t: 'commandResult', id: 90, ok: true })
    harness.runtime.dispose()
  })

  test.each(API_CASES)('maps %s to the %s broker method', async (expression, method, args) => {
    const harness = createHarness(`
      module.exports = {
        activate(bandal) {
          bandal.commands.register('run', () => ${expression})
        }
      }
    `)
    harness.send(loadMessage())
    await waitForMessage(harness.posted, (message) => message.t === 'activated')
    harness.send({
      t: 'command',
      id: 1,
      pluginId: manifest.id,
      commandId: 'run'
    })

    await expect(
      waitForMessage(
        harness.posted,
        (message) => message.t === 'api' && message.method === method
      )
    ).resolves.toMatchObject({ t: 'api', method, args })
    harness.runtime.dispose()
  })

  test('keeps the exposed bandal capability object frozen', async () => {
    const harness = createHarness(`
      module.exports = {
        activate(bandal) {
          bandal.commands.register('run', () =>
            bandal.notices.show(String(Object.isFrozen(bandal))))
        }
      }
    `)
    harness.send(loadMessage())
    await waitForMessage(harness.posted, (message) => message.t === 'activated')
    harness.send({
      t: 'command',
      id: 1,
      pluginId: manifest.id,
      commandId: 'run'
    })

    const notice = await waitForMessage(
      harness.posted,
      (message) => message.t === 'api' && message.method === 'notices.show'
    )
    expect(notice).toMatchObject({ args: ['true'] })
    harness.runtime.dispose()
  })

  test('dispatches event and panel messages to local subscriptions', async () => {
    const harness = createHarness(`
      module.exports = {
        activate(bandal) {
          bandal.events.on('note:saved', payload =>
            bandal.panel.post('test', { source: 'event', payload }))
          bandal.panel.onMessage('test', payload =>
            bandal.panel.post('test', { source: 'panel', payload }))
        }
      }
    `)
    harness.send(loadMessage())
    await waitForMessage(harness.posted, (message) => message.t === 'activated')

    harness.send({
      t: 'event',
      pluginId: manifest.id,
      name: 'note:saved',
      payload: { noteId: 'note-1' }
    })
    harness.send({
      t: 'panelMessage',
      pluginId: manifest.id,
      panelId: 'test',
      payload: { type: 'refresh' }
    })

    const posts: Extract<HostToMain, { t: 'api' }>[] = []
    await vi.waitFor(() => {
      posts.splice(
        0,
        posts.length,
        ...harness.posted.filter(
          (message): message is Extract<HostToMain, { t: 'api' }> =>
            message.t === 'api' && message.method === 'panel.post'
        )
      )
      expect(posts).toHaveLength(2)
    })
    expect(posts.map(({ args }) => args)).toEqual([
      ['test', { source: 'event', payload: { noteId: 'note-1' } }],
      ['test', { source: 'panel', payload: { type: 'refresh' } }]
    ])
    harness.runtime.dispose()
  })

  test('returns an error for an unregistered command', async () => {
    const harness = createHarness(
      'module.exports = { activate() {} }'
    )
    harness.send(loadMessage())
    await waitForMessage(harness.posted, (message) => message.t === 'activated')

    harness.send({
      t: 'command',
      id: 55,
      pluginId: manifest.id,
      commandId: 'missing'
    })

    await expect(
      waitForMessage(
        harness.posted,
        (message) => message.t === 'commandResult' && message.id === 55
      )
    ).resolves.toMatchObject({
      t: 'commandResult',
      id: 55,
      ok: false,
      error: expect.any(String)
    })
    harness.runtime.dispose()
  })
})
