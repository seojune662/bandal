import React from 'react'
import { describe, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MaterialNode } from '../../../src/shared/types/materials'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(() => Promise.resolve([]))
}))

import {
  Composer,
  mentionHitsFromTree
} from '../../../src/renderer/src/features/chat/Composer'

function dir(relPath: string, children: MaterialNode[]): MaterialNode {
  return {
    relPath,
    name: relPath.split('/').at(-1) ?? relPath,
    kind: 'dir',
    children
  }
}

function file(relPath: string, kind: 'pdf' | 'note' = 'pdf'): MaterialNode {
  return { relPath, name: relPath.split('/').at(-1) ?? relPath, kind }
}

describe('mentionHitsFromTree', () => {
  test('flattens directories recursively and sorts by relPath', () => {
    const hits = mentionHitsFromTree([
      dir('주차2', [file('주차2/강의.pdf')]),
      file('개요.md', 'note'),
      dir('주차1', [dir('주차1/실습', [file('주차1/실습/자료.pdf')])])
    ])
    expect(hits.map((hit) => hit.relPath)).toEqual([
      '개요.md',
      '주차1/실습/자료.pdf',
      '주차2/강의.pdf'
    ])
    expect(hits.every((hit) => hit.kind !== ('dir' as never))).toBe(true)
  })

  test('returns an empty list for an empty course', () => {
    expect(mentionHitsFromTree([])).toEqual([])
  })
})

describe('Composer quote chips', () => {
  const baseProps = {
    courseId: 'c1',
    value: '',
    onChange: vi.fn(),
    onSend: vi.fn(),
    onCancel: vi.fn(),
    isStreaming: false,
    isWaitingPermission: false,
    limit: null,
    disabled: false
  }

  test('renders one removable chip per pending quote', () => {
    const markup = renderToStaticMarkup(
      <Composer
        {...baseProps}
        quotes={[
          { text: '양력', source: '공기역학 3쪽' },
          { text: '항력', source: '공기역학 4쪽' }
        ]}
        onRemoveQuote={vi.fn()}
      />
    )
    expect(markup).toContain('chat-quote-chip')
    expect(markup).toContain('인용 · 공기역학 3쪽')
    expect(markup).toContain('인용 · 공기역학 4쪽')
    expect(markup).toContain('인용 1 제거')
    expect(markup).toContain('인용 2 제거')
  })

  test('a quote alone enables the send button', () => {
    const withQuote = renderToStaticMarkup(
      <Composer
        {...baseProps}
        quotes={[{ text: '양력', source: '3쪽' }]}
        onRemoveQuote={vi.fn()}
      />
    )
    const without = renderToStaticMarkup(<Composer {...baseProps} quotes={[]} />)
    expect(withQuote).not.toMatch(/메시지 보내기"[^>]*disabled/)
    expect(without).toMatch(/disabled/)
  })
})
