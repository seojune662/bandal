import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { sanitizePluginManifest } from '../../../src/shared/plugins/sanitize'
import { inspectPluginArchive } from '../../../src/shared/plugins/archive'
import {
  parseSettingsSchema,
  resolvePluginSettings,
} from '../../../src/shared/plugins/configuration'

describe('plugin v2 contracts', () => {
  test('all shipped v1 and v2 examples validate without dropped contributions', () => {
    for (const example of [
      'word-count',
      'selection-tools',
      'material-summary',
      'study-theme',
    ]) {
      const input = JSON.parse(
        readFileSync(
          resolve('examples/plugins', example, 'manifest.json'),
          'utf8',
        ),
      )
      const result = sanitizePluginManifest(input)
      expect(result.manifest, result.warnings.join('\n')).not.toBeNull()
      expect(result.manifest?.manifestVersion).toBe(input.manifestVersion)
      expect(result.warnings).toEqual([])
    }
  })
  test('validates field defaults, bounds, unique safe keys and stored values', () => {
    const fields = [
      {
        key: 'size',
        title: 'Size',
        type: 'number',
        min: 1,
        max: 10,
        default: 3,
      },
    ]
    const schema = parseSettingsSchema(fields)
    expect(resolvePluginSettings(schema, { size: 11 })).toEqual({ size: 3 })
    expect(resolvePluginSettings(schema, { size: 5 })).toEqual({ size: 5 })
    expect(() => parseSettingsSchema([...fields, ...fields])).toThrow()
    expect(() => parseSettingsSchema([{ ...fields[0], default: 99 }])).toThrow()
    expect(() =>
      parseSettingsSchema([{ ...fields[0], key: 'constructor' }]),
    ).toThrow()
    expect(() =>
      parseSettingsSchema([
        {
          key: 'mode',
          title: 'Mode',
          type: 'select',
          default: 'missing',
          options: ['one'],
        },
      ]),
    ).toThrow()
  })
  test('rejects menu references, injected styles and inaccessible themes', () => {
    const input = JSON.parse(
      readFileSync(
        resolve('examples/plugins/study-theme/manifest.json'),
        'utf8',
      ),
    )
    input.contributes.themes[0].tokens['--accent'] = 'url(https://example.com)'
    expect(sanitizePluginManifest(input).manifest).toBeNull()
    input.contributes.themes[0].tokens['--accent'] = '#18202b'
    expect(sanitizePluginManifest(input).manifest).toBeNull()
    input.contributes = {
      menus: [{ command: 'undeclared', location: 'editor' }],
    }
    expect(sanitizePluginManifest(input).manifest).toBeNull()
  })
  test('rejects path traversal and caps expansion before buffering a ZIP bomb', async () => {
    const unsafe = await new JSZip()
      .file('../escape.js', 'x')
      .generateAsync({ type: 'uint8array' })
    await expect(inspectPluginArchive(unsafe)).rejects.toThrow('Unsafe')
    const bomb = await new JSZip()
      .file('large.txt', 'x'.repeat(21 * 1024 * 1024))
      .generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    await expect(inspectPluginArchive(bomb)).rejects.toThrow(
      'Expanded plugin exceeds size limit',
    )
  })
})
