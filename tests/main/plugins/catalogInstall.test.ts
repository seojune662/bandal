import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createCatalogInstaller } from '../../../src/main/features/plugins/catalog/catalogInstall'
import { createPluginStore } from '../../../src/main/features/plugins/pluginStore'
import type { CatalogEntry, PluginCatalog } from '../../../src/shared/types/pluginCatalog'
import type { WorkflowPack } from '../../../src/shared/types/workflowPack'

const SOURCE = 'https://catalog.example/index.json'

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'bandal.catalog-test',
    kind: 'extension',
    name: '카탈로그 테스트',
    publisher: 'bandal',
    description: '',
    tags: [],
    version: '1.0.0',
    minAppVersion: '0.36.0',
    url: 'https://catalog.example/plugin.zip',
    sha256: 'a'.repeat(64),
    sourceUrl: SOURCE,
    verified: false,
    ...overrides
  }
}

function catalog(entry: CatalogEntry): PluginCatalog {
  return { sources: [], entries: [entry], fetchedAt: '2026-09-05T00:00:00.000Z' }
}

function installer(entry: CatalogEntry, bytes: Buffer, tempDir: string) {
  const fetch = vi.fn(async () => new Response(bytes))
  const installFromFolder = vi.fn(async () => {
    throw new Error('plugin install must not be reached')
  })
  return {
    fetch,
    installFromFolder,
    value: createCatalogInstaller({
      catalog: { current: () => catalog(entry) },
      pluginStore: { installFromFolder },
      packStore: {
        list: () => [],
        importText: () => {
          throw new Error('pack import must not be reached')
        }
      },
      fetch,
      appVersion: () => '0.40.0',
      tempDir,
      makeId: () => 'test'
    })
  }
}

describe('createCatalogInstaller', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test('rejects a zip-slip entry before installing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bandal-catalog-install-'))
    roots.push(root)
    const zip = new JSZip()
    zip.file('../evil.txt', 'escaped')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const subject = installer(makeEntry({ sha256: sha256(bytes) }), bytes, root)

    await expect(subject.value.install(SOURCE, 'bandal.catalog-test')).rejects.toThrow(
      '안전하지 않은 경로'
    )
    expect(subject.installFromFolder).not.toHaveBeenCalled()
  })

  test('rejects a sha256 mismatch before creating install files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bandal-catalog-install-'))
    roots.push(root)
    const subject = installer(makeEntry({ sha256: '0'.repeat(64) }), Buffer.from('{}'), root)

    await expect(subject.value.install(SOURCE, 'bandal.catalog-test')).rejects.toThrow(
      '파일이 카탈로그와 달라요'
    )
    expect(subject.installFromFolder).not.toHaveBeenCalled()
  })

  test('rejects an unsupported minAppVersion before fetching', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bandal-catalog-install-'))
    roots.push(root)
    const subject = installer(
      makeEntry({ minAppVersion: '0.41.0' }),
      Buffer.from('{}'),
      root
    )

    await expect(subject.value.install(SOURCE, 'bandal.catalog-test')).rejects.toThrow(
      '반달 0.41.0 이상이 필요해요'
    )
    expect(subject.fetch).not.toHaveBeenCalled()
  })

  test('extracts a single top-level folder and installs through pluginStore', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bandal-catalog-install-'))
    roots.push(root)
    const temporary = join(root, 'temporary')
    mkdirSync(temporary)
    const zip = new JSZip()
    zip.file(
      'plugin/manifest.json',
      JSON.stringify({
        manifestVersion: 1,
        id: 'bandal.catalog-test',
        name: '카탈로그 테스트',
        version: '1.0.0',
        minAppVersion: '0.36.0',
        description: '설명',
        author: 'Bandal',
        main: 'main.js',
        permissions: [],
        contributes: { commands: [], panels: [] },
        styles: null
      })
    )
    zip.file('plugin/main.js', 'module.exports = { activate() {} }\n')
    zip.file('plugin/main-link', 'main.js', { unixPermissions: 0o120777 })
    const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
    const entry = makeEntry({ sha256: sha256(bytes) })
    const store = createPluginStore({ userDataDir: join(root, 'user-data') })
    const install = createCatalogInstaller({
      catalog: { current: () => catalog(entry) },
      pluginStore: store,
      packStore: {
        list: () => [],
        importText: () => {
          throw new Error('pack import must not be reached')
        }
      },
      fetch: async () => new Response(bytes),
      appVersion: () => '0.40.0',
      tempDir: temporary,
      makeId: () => 'success'
    })

    await expect(install.install(SOURCE, entry.id)).resolves.toMatchObject({
      kind: 'extension',
      plugin: { manifest: { id: entry.id } }
    })
    expect(existsSync(join(store.dirFor(entry.id), 'main.js'))).toBe(true)
    expect(existsSync(join(temporary, 'bandal-catalog-success'))).toBe(false)
  })

  test.each(['1.0.0', '1.1.0'])('deduplicates or updates an existing pack at version %s', async (version) => {
    const root = mkdtempSync(join(tmpdir(), 'bandal-catalog-install-'))
    roots.push(root)
    const pack: WorkflowPack = {
      schemaVersion: 1,
      id: 'custom:existing',
      name: '중복 팩',
      description: '설명',
      author: 'Bandal',
      version: '1.0.0',
      locale: 'ko-KR',
      worksOn: ['course'],
      recipe: '정리해 줘.',
      allowedTools: [],
      usesWeb: false,
      outputs: { dir: '결과', primary: '요약' }
    }
    const bytes = Buffer.from(JSON.stringify({ ...pack, id: 'catalog-pack', version }))
    const entry = makeEntry({
      id: 'catalog-pack',
      kind: 'pack',
      url: 'https://catalog.example/pack.json',
      sha256: sha256(bytes)
    })
    const importText = vi.fn(() => ({ pack: { ...pack, version }, warnings: [] }))
    const install = createCatalogInstaller({
      catalog: { current: () => catalog(entry) },
      pluginStore: {
        installFromFolder: async () => {
          throw new Error('plugin install must not be reached')
        }
      },
      packStore: {
        list: () => [{ pack, source: 'user', enabled: true, approvedAt: null }],
        importText
      },
      fetch: async () => new Response(bytes),
      appVersion: () => '0.40.0'
    })

    await expect(install.install(SOURCE, entry.id)).resolves.toEqual({
      kind: 'pack',
      pack: { ...pack, version },
      warnings: []
    })
    if (version === '1.0.0') expect(importText).not.toHaveBeenCalled()
    else expect(importText).toHaveBeenCalledWith(bytes.toString('utf8'), pack.id)
  })
})
