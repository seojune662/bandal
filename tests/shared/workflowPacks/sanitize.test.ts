import { describe, expect, test } from 'vitest'
import { sanitizeWorkflowPack } from '../../../src/shared/workflowPacks/sanitize'

function validPack(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'custom:test-pack',
    name: '시험 복습',
    description: '시험 전에 자료를 정리해요.',
    author: '학생',
    version: '1.0.0',
    locale: 'ko-KR',
    worksOn: ['course', 'material'],
    recipe: '자료를 읽고 요약하라.',
    allowedTools: ['list_materials', 'read_material', 'write_file'],
    usesWeb: false,
    outputs: { dir: 'AI 학습자료/복습', primary: '시험 복습' }
  }
}

describe('sanitizeWorkflowPack', () => {
  test('accepts a valid pack without warnings', () => {
    const result = sanitizeWorkflowPack(validPack())

    expect(result.warnings).toEqual([])
    expect(result.pack).toEqual(validPack())
  })

  test('rejects non-objects and unsupported schema versions', () => {
    for (const raw of [null, undefined, 42, 'pack', []]) {
      expect(sanitizeWorkflowPack(raw).pack).toBeNull()
    }
    const wrongVersion = { ...validPack(), schemaVersion: 2 }
    expect(sanitizeWorkflowPack(wrongVersion).pack).toBeNull()
  })

  test('drops each unknown tool and preserves known agent and browser tools', () => {
    const result = sanitizeWorkflowPack({
      ...validPack(),
      allowedTools: ['write_file', 'browser_read', 'WebFetch', 7, 'shell']
    })

    expect(result.pack?.allowedTools).toEqual(['write_file', 'browser_read'])
    expect(result.warnings.filter((warning) => warning.includes('allowedTools')))
      .toHaveLength(3)
    expect(result.warnings.join('\n')).toContain('WebFetch')
    expect(result.warnings.join('\n')).toContain('shell')
  })

  test('truncates recipes to 8 KiB without splitting a Unicode character', () => {
    const result = sanitizeWorkflowPack({
      ...validPack(),
      recipe: '가'.repeat(3_000)
    })

    expect(result.pack).not.toBeNull()
    expect(new TextEncoder().encode(result.pack?.recipe).byteLength).toBe(8_190)
    expect(result.pack?.recipe.endsWith('가')).toBe(true)
    expect(result.warnings.join('\n')).toContain('8192 bytes')
  })

  test('truncates a name to 40 Unicode characters', () => {
    const result = sanitizeWorkflowPack({
      ...validPack(),
      name: `🙂${'가'.repeat(45)}`
    })

    expect(Array.from(result.pack?.name ?? '')).toHaveLength(40)
    expect(result.warnings.join('\n')).toContain('40 characters')
  })

  test.each([
    '../밖',
    '/절대경로',
    'C:/절대경로',
    '.숨김',
    '정상/.숨김',
    '정상/../밖',
    '정상\\하위',
    '정상//하위'
  ])('rejects unsafe output directory %s', (dir) => {
    const result = sanitizeWorkflowPack({
      ...validPack(),
      outputs: { dir, primary: '결과' }
    })

    expect(result.pack).toBeNull()
    expect(result.warnings.join('\n')).toContain('outputs.dir')
  })

  test('drops unknown and duplicate scopes while retaining known scopes', () => {
    const result = sanitizeWorkflowPack({
      ...validPack(),
      worksOn: ['material', 'future-scope', 'material', null]
    })

    expect(result.pack?.worksOn).toEqual(['material'])
    expect(result.warnings.filter((warning) => warning.includes('unknown scope')))
      .toHaveLength(2)
  })

  test('rejects a pack with no known scope', () => {
    const result = sanitizeWorkflowPack({
      ...validPack(),
      worksOn: ['future-scope']
    })

    expect(result.pack).toBeNull()
    expect(result.warnings.join('\n')).toContain('at least one known scope')
  })

  test('rejects invalid required scalar fields', () => {
    for (const patch of [
      { id: ' ' },
      { description: null },
      { locale: 'ja-JP' },
      { usesWeb: 'false' },
      { outputs: { dir: '결과', primary: '' } }
    ]) {
      expect(sanitizeWorkflowPack({ ...validPack(), ...patch }).pack).toBeNull()
    }
  })

  test('drops a malformed optional follow-up without rejecting the pack', () => {
    const result = sanitizeWorkflowPack({
      ...validPack(),
      followUp: { label: '', recipe: 7 }
    })

    expect(result.pack).not.toBeNull()
    expect(result.pack?.followUp).toBeUndefined()
    expect(result.warnings.join('\n')).toContain('followUp was dropped')
  })

  test('keeps and bounds a valid follow-up recipe', () => {
    const result = sanitizeWorkflowPack({
      ...validPack(),
      followUp: { label: '다음 회차', recipe: 'a'.repeat(8_300) }
    })

    expect(result.pack?.followUp?.label).toBe('다음 회차')
    expect(result.pack?.followUp?.recipe).toHaveLength(8_192)
    expect(result.warnings.join('\n')).toContain('followUp.recipe')
  })
})
