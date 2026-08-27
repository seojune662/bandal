import { describe, expect, test } from 'vitest'
import { parsePackImportText } from '../../../src/renderer/src/features/settings/packImport'

function validPack(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'custom:review-pack',
    name: '시험 복습',
    description: '시험 전에 자료를 정리합니다.',
    author: '학생',
    version: '1.0.0',
    locale: 'ko-KR',
    worksOn: ['course', 'material'],
    recipe: '자료를 읽고 핵심 내용을 정리하라.',
    allowedTools: ['list_materials', 'read_material', 'write_file'],
    usesWeb: false,
    outputs: { dir: 'AI 학습자료/복습', primary: '시험 복습' }
  }
}

describe('parsePackImportText', () => {
  test('keeps an empty editor neutral', () => {
    expect(parsePackImportText('   ')).toEqual({ errors: [] })
  })

  test('reports malformed JSON', () => {
    const result = parsePackImportText('{ nope')

    expect(result.pack).toBeUndefined()
    expect(result.errors[0]).toContain('Invalid JSON')
  })

  test('rejects a non-object JSON value', () => {
    const result = parsePackImportText('null')

    expect(result.pack).toBeUndefined()
    expect(result.errors).toContain('workflow pack must be an object.')
  })

  test('rejects an unsupported schema version', () => {
    const result = parsePackImportText(JSON.stringify({
      ...validPack(),
      schemaVersion: 2
    }))

    expect(result.pack).toBeUndefined()
    expect(result.errors.join('\n')).toContain('schemaVersion must be 1')
  })

  test('returns a sanitized valid pack for preview', () => {
    const result = parsePackImportText(JSON.stringify(validPack()))

    expect(result.errors).toEqual([])
    expect(result.pack?.name).toBe('시험 복습')
    expect(result.pack?.outputs.dir).toBe('AI 학습자료/복습')
  })

  test('keeps a usable preview and reports sanitizer adjustments', () => {
    const result = parsePackImportText(JSON.stringify({
      ...validPack(),
      allowedTools: ['read_material', 'shell']
    }))

    expect(result.pack?.allowedTools).toEqual(['read_material'])
    expect(result.errors.join('\n')).toContain('dropped unknown tool')
  })

  test('rejects an unsafe output directory through the shared sanitizer', () => {
    const result = parsePackImportText(JSON.stringify({
      ...validPack(),
      outputs: { dir: '../밖', primary: '결과' }
    }))

    expect(result.pack).toBeUndefined()
    expect(result.errors.join('\n')).toContain('outputs.dir')
  })
})
