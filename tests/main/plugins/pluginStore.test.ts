import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createPluginStore } from '../../../src/main/features/plugins/pluginStore'

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    manifestVersion: 1,
    id: 'bandal.store-test',
    name: '스토어 테스트',
    version: '1.0.0',
    minAppVersion: '0.36.0',
    description: '플러그인 스토어 테스트 픽스처',
    author: 'Bandal',
    main: 'main.js',
    permissions: ['commands'],
    contributes: {
      commands: [{ id: 'run', title: '실행', defaultChord: null }],
      panels: []
    },
    styles: null,
    ...overrides
  }
}

function makeSource(parent: string, options: {
  manifest?: Record<string, unknown>
  main?: string
} = {}): string {
  const source = join(parent, `source-${Math.random().toString(36).slice(2)}`)
  mkdirSync(source, { recursive: true })
  writeFileSync(
    join(source, 'manifest.json'),
    JSON.stringify(options.manifest ?? manifest(), null, 2)
  )
  writeFileSync(
    join(source, 'main.js'),
    options.main ?? 'module.exports = { activate() {} }\n'
  )
  return source
}

describe('createPluginStore', () => {
  let root: string
  let userDataDir: string
  let sourcesDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bandal-plugin-store-'))
    userDataDir = join(root, 'user-data')
    sourcesDir = join(root, 'sources')
    mkdirSync(userDataDir)
    mkdirSync(sourcesDir)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('installs a sanitized plugin disabled and awaiting approval', async () => {
    const source = makeSource(sourcesDir)
    const store = createPluginStore({
      userDataDir,
      now: () => '2026-09-02T00:00:00.000Z'
    })

    const result = await store.installFromFolder(source)

    expect(result.warnings).toEqual([])
    expect(result.plugin).toMatchObject({
      manifest: { id: 'bandal.store-test' },
      enabled: false,
      state: 'needs-approval',
      approvedPermissions: null,
      installedAt: '2026-09-02T00:00:00.000Z',
      lastError: null
    })
    expect(store.needsApproval('bandal.store-test')).toBe(true)
    expect(store.manifestFor('bandal.store-test')?.id).toBe('bandal.store-test')
    expect(readFileSync(join(store.dirFor('bandal.store-test'), 'main.js'), 'utf8'))
      .toContain('activate')
  })

  test('writes and reloads the versioned plugins.json envelope', async () => {
    const source = makeSource(sourcesDir)
    const store = createPluginStore({ userDataDir })
    await store.installFromFolder(source)
    store.approve('bandal.store-test')
    store.setEnabled('bandal.store-test', true)

    const envelope = JSON.parse(
      readFileSync(join(userDataDir, 'plugins.json'), 'utf8')
    ) as Record<string, unknown>
    expect(envelope).toMatchObject({
      format: 'bandal-plugins',
      version: 1,
      plugins: [expect.objectContaining({ id: 'bandal.store-test' })]
    })

    const reloaded = createPluginStore({ userDataDir })
    expect(reloaded.list()).toEqual(store.list())
    expect(reloaded.needsApproval('bandal.store-test')).toBe(false)
  })

  test('stores the sha256 of manifest.json concatenated with main.js', async () => {
    const source = makeSource(sourcesDir)
    const store = createPluginStore({ userDataDir })
    await store.installFromFolder(source)
    store.approve('bandal.store-test')

    const installed = store.dirFor('bandal.store-test')
    const expectedHash = createHash('sha256')
      .update(readFileSync(join(installed, 'manifest.json')))
      .update(readFileSync(join(installed, 'main.js')))
      .digest('hex')
    const envelopeText = readFileSync(join(userDataDir, 'plugins.json'), 'utf8')

    expect(envelopeText).toContain(expectedHash)
  })

  test('requires re-approval when approved executable content changes', async () => {
    const store = createPluginStore({ userDataDir })
    await store.installFromFolder(makeSource(sourcesDir))
    store.approve('bandal.store-test')
    expect(store.needsApproval('bandal.store-test')).toBe(false)

    writeFileSync(
      join(store.dirFor('bandal.store-test'), 'main.js'),
      'module.exports = { activate() { throw new Error("changed") } }\n'
    )

    const reloaded = createPluginStore({ userDataDir })
    expect(reloaded.needsApproval('bandal.store-test')).toBe(true)
  })

  test('does not enable a plugin before approval, then tracks runtime state', async () => {
    const store = createPluginStore({ userDataDir })
    await store.installFromFolder(makeSource(sourcesDir))

    expect(store.setEnabled('bandal.store-test', true)).toMatchObject({
      enabled: true,
      state: 'needs-approval'
    })
    expect(store.approve('bandal.store-test')).toMatchObject({
      approvedPermissions: ['commands']
    })
    expect(store.setEnabled('bandal.store-test', true)).toMatchObject({
      enabled: true
    })
    expect(
      store.setState('bandal.store-test', 'errored', 'activation failed')
    ).toMatchObject({ state: 'errored', lastError: 'activation failed' })
  })

  test('uninstall removes both registry state and copied files', async () => {
    const store = createPluginStore({ userDataDir })
    await store.installFromFolder(makeSource(sourcesDir))
    const installed = store.dirFor('bandal.store-test')

    await store.uninstall('bandal.store-test')

    expect(store.list()).toEqual([])
    expect(store.manifestFor('bandal.store-test')).toBeNull()
    expect(existsSync(installed)).toBe(false)
  })

  test.each([
    ['dotfile', (source: string) => writeFileSync(join(source, '.secret'), 'x')],
    ['unknown extension', (source: string) => writeFileSync(join(source, 'run.exe'), 'x')],
    [
      'symlink',
      (source: string) =>
        symlinkSync(join(source, 'main.js'), join(source, 'linked.js'))
    ]
  ])('rejects a folder containing a %s', async (_label, addBadFile) => {
    const source = makeSource(sourcesDir)
    addBadFile(source)
    const store = createPluginStore({ userDataDir })

    await expect(store.installFromFolder(source)).rejects.toThrow()
    expect(store.list()).toEqual([])
  })

  test('rejects a manifest larger than its byte budget', async () => {
    const source = makeSource(sourcesDir, {
      manifest: manifest({ padding: 'x'.repeat(33 * 1024) })
    })
    const store = createPluginStore({ userDataDir })

    await expect(store.installFromFolder(source)).rejects.toThrow()
  })

  test('rejects folders over the file-count limit', async () => {
    const source = makeSource(sourcesDir)
    const ui = join(source, 'ui')
    mkdirSync(ui)
    for (let index = 0; index < 199; index += 1) {
      writeFileSync(join(ui, `${index}.js`), '')
    }
    const store = createPluginStore({ userDataDir })

    await expect(store.installFromFolder(source)).rejects.toThrow()
  })

  test('rejects folders over the total byte budget', async () => {
    const source = makeSource(sourcesDir)
    const assets = join(source, 'assets')
    mkdirSync(assets)
    const twoMiB = Buffer.alloc(2 * 1024 * 1024, 1)
    for (let index = 0; index < 11; index += 1) {
      writeFileSync(join(assets, `${index}.txt`), twoMiB)
    }
    const store = createPluginStore({ userDataDir })

    await expect(store.installFromFolder(source)).rejects.toThrow()
  })

  test('rejects main.js over its byte limit', async () => {
    const source = makeSource(sourcesDir, { main: 'x'.repeat(2 * 1024 * 1024 + 1) })
    const store = createPluginStore({ userDataDir })

    await expect(store.installFromFolder(source)).rejects.toThrow()
  })
})
