import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { MaterialLinkRecord } from '../../../src/shared/types/link'
import type { MaterialConnectionsState } from '../../../src/renderer/src/features/links/useMaterialConnections'

const harness = vi.hoisted(() => ({
  state: null as MaterialConnectionsState | null
}))

vi.mock(
  '../../../src/renderer/src/features/links/useMaterialConnections',
  () => ({
    useMaterialConnections: () => {
      if (harness.state === null) throw new Error('connection state not set')
      return harness.state
    }
  })
)

import { MaterialConnectionsSection } from '../../../src/renderer/src/features/links/MaterialConnectionsSection'

function record(
  id: string,
  sourceRelPath: string,
  targetRelPath: string,
  label: string
): MaterialLinkRecord {
  return {
    id,
    courseId: 'course-1',
    source: {
      kind: sourceRelPath.endsWith('.md') ? 'note' : 'image',
      payload: { courseId: 'course-1', relPath: sourceRelPath }
    },
    target: {
      kind: targetRelPath.endsWith('.pdf') ? 'pdf' : 'note',
      payload: { courseId: 'course-1', relPath: targetRelPath }
    },
    label,
    createdAt: '2026-08-27T00:00:00.000Z'
  }
}

function setConnections(
  overrides: Partial<MaterialConnectionsState> = {}
): void {
  harness.state = {
    backlinks: { notes: [], boards: [] },
    outgoing: [],
    incoming: [],
    loading: false,
    error: null,
    remove: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...overrides
  }
}

function renderSection(): string {
  return renderToStaticMarkup(
    <MaterialConnectionsSection courseId="course-1" relPath="현재.md" />
  )
}

beforeEach(() => setConnections())

describe('MaterialConnectionsSection', () => {
  test('renders outgoing connected materials', () => {
    setConnections({
      outgoing: [record('out-1', '현재.md', '강의/자료.pdf', '시험 범위')]
    })

    const html = renderSection()

    expect(html).toContain('data-direction="outgoing"')
    expect(html).toContain('자료.pdf')
    expect(html).toContain('시험 범위')
    expect(html).toContain('열기')
    expect(html).toContain('해제')
  })

  test('renders incoming connected materials', () => {
    setConnections({
      incoming: [record('in-1', '그림/개념.png', '현재.md', '개념 그림')]
    })

    const html = renderSection()

    expect(html).toContain('data-direction="incoming"')
    expect(html).toContain('개념.png')
    expect(html).toContain('개념 그림')
  })

  test('renders neutral empty labels for both groups', () => {
    const html = renderSection()

    expect(html).toContain('이 자료를 인용한 곳이 없어요.')
    expect(html).toContain('연결한 자료가 없어요.')
    expect(html).not.toContain('role="alert"')
  })
})
