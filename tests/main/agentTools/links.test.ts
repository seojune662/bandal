import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  createAgentTools,
  type AgentJournalEntry,
  type AgentTools,
  type AgentToolsDeps
} from '../../../src/main/features/agentTools/tools'
import {
  createMaterialLinksRepo,
  type MaterialLinksRepo
} from '../../../src/main/features/links/materialLinksRepo'
import { createTestDb, type TestDb } from '../helpers/testDb'

const COURSE_ID = 'agent-link-course'

interface Harness {
  ctx: TestDb
  folder: string
  repo: MaterialLinksRepo
  tools: AgentTools
  actions: AgentJournalEntry[]
}

function message(result: CallToolResult): string {
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected a text tool result')
  return block.text
}

function makeHarness(): Harness {
  const ctx = createTestDb()
  const folder = join(ctx.dir, 'course')
  mkdirSync(folder)
  const now = new Date().toISOString()
  ctx.db.prepare(
    `INSERT INTO courses
       (id, name, slug, color, folder_path, archived, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(COURSE_ID, '도구 링크 테스트', COURSE_ID, 'blue', folder, now, now)

  const repo = createMaterialLinksRepo(ctx.db)
  const actions: AgentJournalEntry[] = []
  const deps = {
    courseId: COURSE_ID,
    getTurnId: () => 'turn-links',
    coursesRepo: { getFolder: () => folder },
    journal: { record: (entry: AgentJournalEntry) => actions.push(entry) }
  } as unknown as AgentToolsDeps
  // registerHandlers의 통합 워커가 같은 포트를 실제 세션 의존성에 연결한다.
  Object.assign(deps, { materialLinksRepo: repo })

  return {
    ctx,
    folder,
    repo,
    tools: createAgentTools(deps),
    actions
  }
}

describe('material link agent tools', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  afterEach(() => {
    harness.ctx.cleanup()
  })

  test('rejects a missing source or target before creating a link', async () => {
    writeFileSync(join(harness.folder, 'present.pdf'), '%PDF-1.4', 'utf8')

    const missingSource = await harness.tools.call('link_materials', {
      courseId: COURSE_ID,
      fromRelPath: 'missing.pdf',
      toRelPath: 'present.pdf'
    })
    const missingTarget = await harness.tools.call('link_materials', {
      courseId: COURSE_ID,
      fromRelPath: 'present.pdf',
      toRelPath: 'missing.md'
    })

    expect(missingSource.isError).toBe(true)
    expect(message(missingSource)).toContain('material "missing.pdf" does not exist')
    expect(missingTarget.isError).toBe(true)
    expect(message(missingTarget)).toContain('material "missing.md" does not exist')
    expect(harness.actions).toEqual([])
    expect(harness.repo.listFor(COURSE_ID, 'present.pdf').outgoing).toEqual([])
  })

  test('derives descriptors, creates the link, and journals an undoable link target', async () => {
    writeFileSync(join(harness.folder, 'lecture.pdf'), '%PDF-1.4', 'utf8')
    writeFileSync(join(harness.folder, 'summary.md'), '# 요약', 'utf8')

    const result = await harness.tools.call('link_materials', {
      courseId: COURSE_ID,
      fromRelPath: 'lecture.pdf',
      toRelPath: 'summary.md',
      label: '시험 범위'
    })

    expect(result.isError).not.toBe(true)
    const payload = JSON.parse(message(result)) as {
      id: string
      fromRelPath: string
      toRelPath: string
      label: string
    }
    expect(payload).toMatchObject({
      fromRelPath: 'lecture.pdf',
      toRelPath: 'summary.md',
      label: '시험 범위'
    })
    expect(harness.repo.listFor(COURSE_ID, 'lecture.pdf').outgoing[0]).toMatchObject({
      id: payload.id,
      source: { kind: 'pdf' },
      target: { kind: 'note' }
    })
    expect(harness.actions).toEqual([
      expect.objectContaining({
        courseId: COURSE_ID,
        turnId: 'turn-links',
        tool: 'link_materials',
        targetKind: 'link',
        targetId: payload.id,
        undoable: true
      })
    ])
  })

  test('lists links as concise directional JSON', async () => {
    writeFileSync(join(harness.folder, 'source.txt'), 'source', 'utf8')
    writeFileSync(join(harness.folder, 'target.png'), 'image', 'utf8')
    await harness.tools.call('link_materials', {
      courseId: COURSE_ID,
      fromRelPath: 'source.txt',
      toRelPath: 'target.png'
    })

    const result = await harness.tools.call('list_links', {
      courseId: COURSE_ID,
      relPath: 'target.png'
    })

    expect(result.isError).not.toBe(true)
    const payload = JSON.parse(message(result)) as {
      outgoing: unknown[]
      incoming: Array<Record<string, unknown>>
    }
    expect(payload.outgoing).toEqual([])
    expect(payload.incoming).toEqual([
      {
        id: expect.any(String),
        fromRelPath: 'source.txt',
        toRelPath: 'target.png',
        label: ''
      }
    ])
    expect(Object.keys(payload.incoming[0] ?? {})).toEqual([
      'id',
      'fromRelPath',
      'toRelPath',
      'label'
    ])
  })
})
