import { expect, test } from 'vitest'
import type { PluginSummary } from '../../../src/shared/types/plugin'
import type { McpServerSummary } from '../../../src/shared/types/mcp'
import { BUILTIN_PACKS } from '../../../src/shared/workflowPacks/builtins'
import { buildPluginCenterRows, filterPluginCenterRows } from '../../../src/renderer/src/features/settings/pluginCenterModel'
import { MCP_PRESETS, presetForServer } from '../../../src/renderer/src/features/settings/mcpPresets'

const packs = BUILTIN_PACKS.map(pack => ({ pack, enabled: true, source: 'builtin' as const, approvedAt: null }))
const plugin: PluginSummary = { manifest: { manifestVersion: 2, id: 'example.tools', name: 'Tools', description: 'Clean up notes', author: 'Example', version: '1.0.0', minAppVersion: '0.42.0', main: 'main.js', styles: null, permissions: ['commands', 'panel'], contributes: { commands: [{ id: 'clean', title: 'Clean notes', defaultChord: null }], panels: [{ id: 'report', title: 'Report', entry: 'index.html' }] } }, enabled: true, state: 'active', approvedPermissions: ['commands', 'panel'], installedAt: '', lastError: null }
function server(presetId: string): McpServerSummary {
  const input = MCP_PRESETS.find(preset => preset.id === presetId)!.input('', { folder: '/chosen/folder' })
  return { ...input, id: `saved-${presetId}`, name: 'renamed-service', envKeys: [], headerKeys: [], createdAt: '', updatedAt: '' }
}

test('one stable row per managed entity and only unconfigured presets remain', () => {
  const rows = buildPluginCenterRows(packs, [plugin], [server('notion')], true, true)
  expect(rows).toHaveLength(packs.length + 1 + 1 + 5)
  expect(rows.filter(row => row.kind === 'plugin')).toHaveLength(1)
  expect(rows.some(row => row.id === 'preset:notion')).toBe(false)
  expect(rows.some(row => row.id === 'mcp:saved-notion')).toBe(true)
  expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
  expect(buildPluginCenterRows(packs.map(pack => ({ ...pack, enabled: false })), [{ ...plugin, enabled: false }], [server('notion')], false, true).map(row => row.id)).toEqual(rows.map(row => row.id))
})

test('filesystem identity excludes the selected folder and names alone never identify a preset', () => {
  expect(presetForServer(server('filesystem'))?.id).toBe('filesystem')
  expect(presetForServer({ ...server('filesystem'), name: 'notion', command: 'node', args: ['custom-server.js'] })).toBeUndefined()
  expect(buildPluginCenterRows([], [], [server('filesystem')], false, true).some(row => row.id === 'preset:filesystem')).toBe(false)
})

test('runtime/approval/failure states do not claim an extension is running', () => {
  expect(buildPluginCenterRows([], [plugin], [], false, true)[0]).toMatchObject({ checked: false, status: '실행 꺼짐' })
  expect(buildPluginCenterRows([], [{ ...plugin, state: 'errored' }], [], true, true)[0]).toMatchObject({ checked: false, status: '실행 오류' })
  expect(buildPluginCenterRows([], [{ ...plugin, state: 'needs-approval', approvedPermissions: null }], [], true, true)[0]).toMatchObject({ checked: false, status: '승인 필요' })
})

test('native results describe interactive study, legacy tools describe saved notes, and filters include setup rows', () => {
  const rows = buildPluginCenterRows(packs, [], [], false, true)
  expect(rows.find(row => row.id === 'pack:quiz')?.outcome).toContain('풀면서')
  expect(rows.find(row => row.id === 'pack:flashcards')?.outcome).toContain('카드')
  expect(rows.find(row => row.id === 'pack:summary')?.outcome).toContain('필기를 저장')
  expect(rows.find(row => row.id === 'pack:vocab-chain-en')?.name).toBe('영어 글 읽기')
  expect(filterPluginCenterRows(rows, 'notion', 'external')).toHaveLength(1)
  expect(filterPluginCenterRows(rows, 'notion', 'study')).toHaveLength(0)
  expect(filterPluginCenterRows(rows, '', 'external')).toHaveLength(6)
})


test('disabled external tools keep the distinction between not checked, checked and failed', () => {
  const base = { ...server('notion'), enabled: false }
  expect(buildPluginCenterRows([], [], [base], false, true)[0]?.status).toBe('확인 전 · 꺼짐')
  expect(buildPluginCenterRows([], [], [{ ...base, lastTest: { at: '', ok: true, tools: ['search'] } }], false, true)[0]?.status).toBe('연결 확인됨 · 꺼짐')
  expect(buildPluginCenterRows([], [], [{ ...base, lastTest: { at: '', ok: false, tools: [] } }], false, true)[0]?.status).toBe('확인 실패 · 꺼짐')
})
