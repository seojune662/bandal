import { describe, expect, test } from 'vitest'
import { sanitizePluginManifest } from '../../../src/shared/plugins/sanitize'

function validManifest(): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: 'bandal.example-plugin',
    name: '예제 플러그인',
    version: '1.2.3',
    minAppVersion: '0.36.0',
    description: '매니페스트 정규화 테스트용 플러그인',
    author: 'Bandal',
    main: 'main.js',
    permissions: ['courses.read', 'commands'],
    contributes: {
      commands: [
        { id: 'run-example', title: '예제 실행', defaultChord: null }
      ],
      panels: [{ id: 'result', title: '결과', entry: 'index.html' }]
    },
    styles: 'styles.css'
  }
}

describe('sanitizePluginManifest', () => {
  test('accepts and normalizes a valid v1 manifest', () => {
    const result = sanitizePluginManifest(validManifest())

    expect(result.warnings).toEqual([])
    expect(result.manifest).toEqual(validManifest())
  })

  test('rejects unsupported manifest versions and malformed plugin ids', () => {
    expect(
      sanitizePluginManifest({ ...validManifest(), manifestVersion: 3 }).manifest
    ).toBeNull()
    expect(
      sanitizePluginManifest({ ...validManifest(), id: 'Bad Plugin!' }).manifest
    ).toBeNull()
    expect(
      sanitizePluginManifest({ ...validManifest(), id: `a.${'b'.repeat(129)}` })
        .manifest
    ).toBeNull()
  })

  test('rejects invalid semver and truncates strings to their public limits', () => {
    expect(
      sanitizePluginManifest({ ...validManifest(), version: '1.2' }).manifest
    ).toBeNull()
    expect(
      sanitizePluginManifest({ ...validManifest(), minAppVersion: 'next' })
        .manifest
    ).toBeNull()

    const result = sanitizePluginManifest({
      ...validManifest(),
      name: '가'.repeat(41),
      description: '나'.repeat(301),
      author: 'a'.repeat(81)
    })
    expect(result.manifest?.name).toHaveLength(40)
    expect(result.manifest?.description).toHaveLength(300)
    expect(result.manifest?.author).toHaveLength(80)
    expect(result.warnings).toHaveLength(3)
  })

  test('drops unknown permissions and canonicalizes valid network hosts', () => {
    const result = sanitizePluginManifest({
      ...validManifest(),
      permissions: [
        'courses.read',
        'future.power',
        'net:API.Example.COM',
        'net:api.example.com:443',
        'net:https://example.com/path',
        'net:*.example.com'
      ]
    })

    expect(result.manifest?.permissions).toEqual([
      'courses.read',
      'net:api.example.com'
    ])
    expect(result.warnings.length).toBeGreaterThanOrEqual(4)
  })

  test('caps contributions and drops entries with invalid ids', () => {
    const commands = Array.from({ length: 35 }, (_, index) => ({
      id: `command-${index}`,
      title: `명령 ${index}`,
      defaultChord: null
    }))
    commands.splice(1, 0, {
      id: 'Invalid command',
      title: '잘못된 명령',
      defaultChord: null
    })
    const panels = Array.from({ length: 6 }, (_, index) => ({
      id: `panel-${index}`,
      title: `패널 ${index}`,
      entry: `${index}.html`
    }))
    panels.splice(1, 0, {
      id: 'BAD_PANEL',
      title: '잘못된 패널',
      entry: 'bad.html'
    })

    const result = sanitizePluginManifest({
      ...validManifest(),
      contributes: { commands, panels }
    })

    expect(result.manifest?.contributes.commands).toHaveLength(32)
    expect(result.manifest?.contributes.panels).toHaveLength(4)
    expect(
      result.manifest?.contributes.commands.some(({ id }) => id === 'Invalid command')
    ).toBe(false)
    expect(
      result.manifest?.contributes.panels.some(({ id }) => id === 'BAD_PANEL')
    ).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  test.each(['../index.html', '/index.html', String.raw`folder\index.html`, 'a\0b']) (
    'drops an unsafe panel entry: %s',
    (entry) => {
      const result = sanitizePluginManifest({
        ...validManifest(),
        contributes: {
          commands: [],
          panels: [{ id: 'unsafe', title: '안전하지 않음', entry }]
        }
      })

      expect(result.manifest?.contributes.panels).toEqual([])
      expect(result.warnings.length).toBeGreaterThan(0)
    }
  )

  test.each(['../main.js', '/main.js', String.raw`folder\main.js`, 'a\0b']) (
    'rejects an unsafe main entry: %s',
    (main) => {
      expect(sanitizePluginManifest({ ...validManifest(), main }).manifest).toBeNull()
    }
  )

  test('only preserves the v1 styles filename and ignores future contribution keys', () => {
    const result = sanitizePluginManifest({
      ...validManifest(),
      styles: 'theme.css',
      contributes: {
        commands: [],
        panels: []
      },
      menus: [{ command: 'run-example' }],
      themes: [{ id: 'night' }]
    })

    expect(result.manifest?.styles).toBeNull()
    expect(result.manifest?.contributes).toEqual({ commands: [], panels: [] })
    expect(result.warnings.length).toBeGreaterThanOrEqual(3)
  })

  test('the deliberately bad fixture is never loadable', async () => {
    const raw = await import(
      '../../../examples/plugins/_fixtures/bad-manifest/manifest.json'
    )
    const result = sanitizePluginManifest(raw.default)

    expect(result.manifest).toBeNull()
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
