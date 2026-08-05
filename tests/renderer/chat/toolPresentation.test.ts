import { describe, expect, test } from 'vitest'
import type { ToolBlockView } from '../../../src/renderer/src/features/chat/chatModel'
import {
  presentTool,
  summarizeInput,
  toolChange
} from '../../../src/renderer/src/features/chat/toolPresentation'

function tool(overrides: Partial<ToolBlockView>): ToolBlockView {
  return {
    kind: 'tool',
    id: 'tc1',
    toolName: 'Read',
    label: '',
    status: 'running',
    ...overrides
  }
}

describe('presentTool', () => {
  test('Read shows 파일 읽는 중 with the file basename', () => {
    const presentation = presentTool(
      tool({ toolName: 'Read', input: { file_path: '/course/week3/lec.pdf' } })
    )
    expect(presentation.title).toBe('파일 읽는 중')
    expect(presentation.detail).toBe('lec.pdf')
  })

  test('done status switches to the completed form', () => {
    const presentation = presentTool(tool({ toolName: 'Read', status: 'ok' }))
    expect(presentation.title).toBe('파일 읽음')
  })

  test('Grep shows 검색 중 with the pattern', () => {
    const presentation = presentTool(
      tool({ toolName: 'Grep', input: { pattern: 'entropy' } })
    )
    expect(presentation.title).toBe('검색 중')
    expect(presentation.detail).toBe('entropy')
  })

  test('Edit shows 필기 수정 중', () => {
    const presentation = presentTool(
      tool({ toolName: 'Edit', input: { file_path: 'notes.md' } })
    )
    expect(presentation.title).toBe('필기 수정 중')
    expect(presentation.detail).toBe('notes.md')
  })

  test('unknown tools fall back to the CLI label', () => {
    const presentation = presentTool(
      tool({ toolName: 'mcp__figma__whoami', label: 'Checking Figma account' })
    )
    expect(presentation.title).toBe('Checking Figma account')
  })
})

describe('toolChange', () => {
  test('Edit input yields a before/after change', () => {
    const change = toolChange(
      tool({
        toolName: 'Edit',
        input: {
          file_path: 'notes.md',
          old_string: 'old text',
          new_string: 'new text'
        }
      })
    )
    expect(change).toEqual({
      path: 'notes.md',
      before: 'old text',
      after: 'new text'
    })
  })

  test('Write input yields content as after with empty before', () => {
    const change = toolChange(
      tool({
        toolName: 'Write',
        input: { file_path: 'summary.md', content: '# 정리' }
      })
    )
    expect(change).toEqual({ path: 'summary.md', before: '', after: '# 정리' })
  })

  test('Read input yields no change view', () => {
    expect(toolChange(tool({ toolName: 'Read', input: {} }))).toBeNull()
  })
})

describe('summarizeInput', () => {
  test('truncates long JSON with an ellipsis', () => {
    const summary = summarizeInput({ text: 'x'.repeat(500) }, 40)
    expect(summary.length).toBe(40)
    expect(summary.endsWith('…')).toBe(true)
  })

  test('handles null and undefined', () => {
    expect(summarizeInput(undefined)).toBe('')
    expect(summarizeInput(null)).toBe('')
  })
})
