import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  McpAvailability,
  McpServerSummary
} from '../../../src/shared/types/mcp'

vi.mock('../../../src/renderer/src/i18n', () => {
  const messages: Record<string, string> = {
    'settings.mcp.title': 'MCP 서버',
    'settings.mcp.description': '등록한 도구 서버와 연결 상태입니다.',
    'settings.mcp.loading': 'MCP 서버를 불러오는 중입니다…',
    'settings.mcp.unavailable': 'MCP 서버를 사용할 수 없습니다.',
    'settings.mcp.empty': '등록된 MCP 서버가 없습니다.',
    'settings.mcp.listLabel': '등록된 MCP 서버',
    'settings.mcp.enabledLabel': '{name} 서버 사용',
    'settings.mcp.status.untested': '미확인',
    'settings.mcp.status.error': '✗ 오류',
    'settings.mcp.status.tools': '도구 {count}개',
    'settings.mcp.action.add': '서버 추가',
    'settings.mcp.action.retry': '다시 불러오기',
    'settings.mcp.action.cancel': '취소',
    'settings.mcp.action.save': '저장',
    'settings.mcp.action.saving': '저장 중…',
    'settings.mcp.action.test': '연결 확인',
    'settings.mcp.action.testing': '확인 중…',
    'settings.mcp.action.edit': '편집',
    'settings.mcp.action.delete': '삭제',
    'settings.mcp.action.deleting': '삭제 중…',
    'settings.mcp.action.confirmDelete': '삭제 확인',
    'settings.mcp.manual.title': '직접 입력',
    'settings.mcp.manual.description': '상세 연결 정보를 직접 설정합니다.',
    'settings.mcp.form.addTitle': 'MCP 서버 추가',
    'settings.mcp.form.editTitle': 'MCP 서버 편집',
    'settings.mcp.form.description': '연결 정보와 비밀값을 관리합니다.',
    'settings.mcp.form.name': '이름',
    'settings.mcp.form.serverDescription': '설명',
    'settings.mcp.form.transport': '전송 방식',
    'settings.mcp.form.command': '명령',
    'settings.mcp.form.args': '인수 · 줄바꿈 구분',
    'settings.mcp.form.url': 'URL',
    'settings.mcp.form.env': '환경 변수',
    'settings.mcp.form.headers': '헤더',
    'settings.mcp.form.secretKey': '{kind} 키',
    'settings.mcp.form.secretKeyPlaceholder': '키',
    'settings.mcp.form.secretHidden': '저장된 비밀값',
    'settings.mcp.form.secretValue': '{key} 값',
    'settings.mcp.form.secretValuePlaceholder': '새 값',
    'settings.mcp.form.replace': '바꾸기',
    'settings.mcp.form.removeSecret': '{key} 삭제',
    'settings.mcp.form.remove': '삭제',
    'settings.mcp.form.addSecret': '행 추가',
    'settings.mcp.notice.stdio': 'stdio 서버 실행 고지',
    'settings.mcp.notice.codex': 'Codex 읽기 전용 고지'
  }

  return {
    useT: () => (
      key: string,
      vars?: Record<string, string | number>
    ): string => {
      const message = messages[key] ?? key
      return message.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
        vars?.[name] === undefined ? placeholder : String(vars[name])
      )
    }
  }
})

import {
  loadMcpServers,
  McpServersPanel,
  resetMcpServersPanelForTests
} from '../../../src/renderer/src/features/settings/McpServersPanel'
import {
  setIpcAdapter,
  type IpcAdapter
} from '../../../src/renderer/src/lib/ipc'

const available: McpAvailability = { available: true, reason: null }

const servers: McpServerSummary[] = [
  {
    id: 'stdio-server',
    name: 'notion-search',
    description: '노션 자료를 검색합니다.',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    enabled: true,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    lastTest: {
      at: '2026-08-21T01:00:00.000Z',
      ok: true,
      tools: ['search', 'fetch']
    },
    envKeys: ['NOTION_TOKEN'],
    headerKeys: []
  },
  {
    id: 'http-server',
    name: 'campus-tools',
    description: '학교 도구 서버입니다.',
    transport: 'http',
    url: 'https://tools.example.test/mcp',
    enabled: false,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    lastTest: {
      at: '2026-08-21T01:00:00.000Z',
      ok: false,
      tools: [],
      error: 'connection refused'
    },
    envKeys: [],
    headerKeys: ['Authorization']
  }
]

function installListFake(
  nextServers: McpServerSummary[],
  availability: McpAvailability = available
): void {
  setIpcAdapter({
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'mcp:list') {
        return { servers: nextServers, availability }
      }
      throw new Error(`Unexpected IPC channel: ${channel}`)
    }),
    on: vi.fn(() => () => undefined)
  } as unknown as IpcAdapter)
}

afterEach(() => {
  setIpcAdapter(null)
  resetMcpServersPanelForTests()
})

describe('McpServersPanel', () => {
  test('puts paste import and six recommended presets before manual entry', async () => {
    installListFake([])
    await loadMcpServers()

    const html = renderToStaticMarkup(<McpServersPanel />)

    expect(html.match(/class="settings-mcp-preset"/g)).toHaveLength(6)
    expect(html).toContain('@notionhq/notion-mcp-server')
    expect(html).toContain('@modelcontextprotocol/server-github')
    expect(html).toContain('@modelcontextprotocol/server-gdrive')
    expect(html).toContain('@modelcontextprotocol/server-slack')
    expect(html).toContain('@modelcontextprotocol/server-filesystem')
    expect(html).toContain('mcp-server-fetch (Python)')
    expect(html.indexOf('settings-mcp-import')).toBeLessThan(
      html.indexOf('settings-mcp-gallery')
    )
    expect(html).toContain('<summary><span>직접 입력</span>')
  })

  test('renders an empty registry', async () => {
    installListFake([])
    await loadMcpServers()

    const html = renderToStaticMarkup(<McpServersPanel />)

    expect(html).toContain('등록된 MCP 서버가 없습니다.')
    expect(html).toContain('>직접 입력</button>')
  })

  test('renders transport badges and the last connection result', async () => {
    installListFake(servers)
    await loadMcpServers()

    const html = renderToStaticMarkup(<McpServersPanel />)

    expect(html).toContain('notion-search')
    expect(html).toContain('campus-tools')
    expect(html).toContain('>stdio</span>')
    expect(html).toContain('>http</span>')
    expect(html).toContain('도구 2개')
    expect(html).toContain('✗ 오류')
  })

  test('shows the availability reason instead of the registry', async () => {
    installListFake(servers, {
      available: false,
      reason: '현재 엔진에서는 MCP를 사용할 수 없습니다.'
    })
    await loadMcpServers()

    const html = renderToStaticMarkup(<McpServersPanel />)

    expect(html).toContain('현재 엔진에서는 MCP를 사용할 수 없습니다.')
    expect(html).not.toContain('notion-search')
    expect(html).toContain('disabled=""')
  })

  test('renders existing env keys with a mask and no secret value', async () => {
    installListFake([servers[0]!])
    await loadMcpServers()

    const html = renderToStaticMarkup(
      <McpServersPanel initialEditingServerId="stdio-server" />
    )
    const editorHtml = html.slice(html.indexOf('<form class="settings-mcp-card'))

    expect(editorHtml).toContain('NOTION_TOKEN')
    expect(editorHtml).toContain('••••')
    expect(editorHtml).toContain('>바꾸기</button>')
    expect(editorHtml).not.toContain('type="password"')
    expect(editorHtml).not.toContain('notion-secret-value')
    expect(editorHtml).not.toContain('value="••••"')
  })
})
