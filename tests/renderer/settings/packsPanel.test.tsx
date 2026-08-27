import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorkflowPackSummary } from '../../../src/shared/types/workflowPack'
import { BUILTIN_PACKS } from '../../../src/shared/workflowPacks/builtins'

vi.mock('../../../src/renderer/src/i18n', () => {
  const messages: Record<string, string> = {
    'settings.packs.notice': '팩은 코드가 아니라 AI에게 주는 지시서입니다. 실행 전 내용을 확인할 수 있습니다.',
    'settings.packs.loading': '팩을 불러오는 중입니다…',
    'settings.packs.retry': '다시 불러오기',
    'settings.packs.builtin': '기본 제공',
    'settings.packs.builtin.empty': '기본 제공 팩이 없습니다.',
    'settings.packs.installed': '설치한 팩',
    'settings.packs.installed.empty': '설치한 팩이 없습니다.',
    'settings.packs.enabledLabel': '{name} 팩 사용',
    'settings.packs.tools': '허용된 도구',
    'settings.packs.web': '웹 검색 사용',
    'settings.packs.outputDir': '결과 폴더',
    'settings.packs.followUp': '후속 작업',
    'settings.packs.recipe': '레시피 전문',
    'settings.packs.export': 'JSON 내보내기',
    'settings.packs.remove': '삭제',
    'settings.packs.import.button': 'JSON으로 가져오기'
  }
  return {
    useT: () => (key: string, vars?: Record<string, string | number>) =>
      (messages[key] ?? key).replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
        vars?.[name] === undefined ? placeholder : String(vars[name])
      )
  }
})

import {
  loadPacks,
  PacksPanel,
  resetPacksPanelForTests
} from '../../../src/renderer/src/features/settings/PacksPanel'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

const builtinSummary: WorkflowPackSummary = {
  pack: BUILTIN_PACKS[0]!,
  source: 'builtin',
  enabled: true,
  approvedAt: null
}

const userSummary: WorkflowPackSummary = {
  pack: {
    ...BUILTIN_PACKS[BUILTIN_PACKS.length - 1]!,
    id: 'custom:vocab-chain',
    name: '나의 단어 사슬',
    author: '학생'
  },
  source: 'user',
  enabled: false,
  approvedAt: '2026-08-27T00:00:00.000Z'
}

function installListFake(packs: WorkflowPackSummary[]): void {
  setIpcAdapter({
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'packs:list') return { packs }
      throw new Error(`Unexpected IPC channel: ${channel}`)
    }),
    on: vi.fn(() => () => undefined)
  } as unknown as IpcAdapter)
}

afterEach(() => {
  setIpcAdapter(null)
  resetPacksPanelForTests()
})

describe('PacksPanel', () => {
  test('renders the built-in section, metadata, toggle, and auditable recipe', async () => {
    installListFake([builtinSummary])
    await loadPacks()

    const html = renderToStaticMarkup(
      <PacksPanel initialExpandedIds={[builtinSummary.pack.id]} />
    )

    expect(html).toContain('기본 제공')
    expect(html).toContain('요약')
    expect(html).toContain('v1.0.0 · Bandal')
    expect(html).toContain('role="switch"')
    expect(html).toContain('<pre>')
    expect(html).toContain('AI 학습자료')
  })

  test('renders installed-pack controls and web/follow-up badges', async () => {
    installListFake([userSummary])
    await loadPacks()

    const html = renderToStaticMarkup(
      <PacksPanel initialExpandedIds={[userSummary.pack.id]} />
    )

    expect(html).toContain('설치한 팩')
    expect(html).toContain('나의 단어 사슬')
    expect(html).toContain('JSON 내보내기')
    expect(html).toContain('>삭제</button>')
    expect(html).toContain('웹 검색 사용')
    expect(html).toContain('이 기사로 이어가기')
  })

  test('renders stable empty messages for both sections', async () => {
    installListFake([])
    await loadPacks()

    const html = renderToStaticMarkup(<PacksPanel />)

    expect(html).toContain('기본 제공 팩이 없습니다.')
    expect(html).toContain('설치한 팩이 없습니다.')
    expect(html).toContain('JSON으로 가져오기')
  })
})
