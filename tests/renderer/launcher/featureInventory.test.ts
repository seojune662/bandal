import { expect, test } from 'vitest'
import type { PluginSummary } from '../../../src/shared/types/plugin'
import type { WorkflowPackSummary } from '../../../src/shared/types/workflowPack'
import { BUILTIN_PACKS } from '../../../src/shared/workflowPacks/builtins'
import { buildFeatureInventory } from '../../../src/renderer/src/features/launcher/featureInventory'

const packs: WorkflowPackSummary[] = BUILTIN_PACKS.map(pack => ({ pack, enabled: true, source: 'builtin', approvedAt: null }))
const plugin: PluginSummary = {
  manifest: { manifestVersion: 2, id: 'study.tools', name: 'Study Tools', description: 'Tools for studying', author: 'Student', version: '1.0.0', minAppVersion: '0.35.0', main: 'main.js', styles: null,
    permissions: ['commands', 'panel'], contributes: { commands: [{ id: 'quiz', title: 'Custom quiz', defaultChord: null }], panels: [{ id: 'dashboard', title: 'Dashboard', entry: 'index.html' }], menus: [{ command: 'quiz', location: 'materials' }] } },
  enabled: true, state: 'active', approvedPermissions: ['commands', 'panel'], installedAt: 'now', lastError: null
}

test('keeps v1 Markdown, v2 native and same-title extension features distinct with full source contracts', () => {
  const entries = buildFeatureInventory(packs, [plugin], true)
  expect(entries).toHaveLength(10)
  expect(new Set(entries.map(entry => entry.id)).size).toBe(10)
  expect(entries.find(entry => entry.id === 'pack:summary')).toMatchObject({ kind: 'pack', schemaVersion: 1, packId: 'summary', unavailableReason: null })
  expect(entries.find(entry => entry.id === 'pack:quiz')).toMatchObject({ kind: 'pack', schemaVersion: 2, experience: 'quiz', worksOn: ['course', 'material', 'selection'] })
  expect(entries.find(entry => entry.id === 'plugin:study.tools:quiz')).toMatchObject({ kind: 'plugin-command', commandId: 'quiz', menuLocations: ['materials'], pluginName: 'Study Tools' })
  expect(entries.find(entry => entry.id === 'plugin-panel:study.tools:dashboard')).toMatchObject({ kind: 'plugin-panel', panelId: 'dashboard', unavailableReason: null })
})

test('preserves custom selection-only v2 packs and lets the existing host request execution approval', () => {
  const native = packs.find(entry => entry.pack.id === 'quiz')!
  const custom: WorkflowPackSummary = { ...native, source: 'user', pack: { ...native.pack, id: 'custom:selection', worksOn: ['selection'] } }
  expect(buildFeatureInventory([custom], [], false)[0]).toMatchObject({ id: 'pack:custom:selection', source: 'user', worksOn: ['selection'], experience: 'quiz', unavailableReason: null })
  expect(buildFeatureInventory([{ ...custom, enabled: false }], [], true)[0]?.unavailableReason).toContain('비활성화')
})

test('runtime, approval, disabled, starting and failure states explain why commands or panels cannot run', () => {
  expect(buildFeatureInventory([], [plugin], false).every(entry => entry.unavailableReason?.includes('실행이 꺼져'))).toBe(true)
  expect(buildFeatureInventory([], [{ ...plugin, enabled: false, state: 'disabled' }], true).every(entry => entry.unavailableReason?.includes('비활성화'))).toBe(true)
  expect(buildFeatureInventory([], [{ ...plugin, state: 'needs-approval', approvedPermissions: null }], true).every(entry => entry.unavailableReason?.includes('권한 승인'))).toBe(true)
  expect(buildFeatureInventory([], [{ ...plugin, state: 'starting' }], true).every(entry => entry.unavailableReason?.includes('시작하는 중'))).toBe(true)
  expect(buildFeatureInventory([], [{ ...plugin, state: 'errored', lastError: 'Host failed' }], true).every(entry => entry.unavailableReason === 'Host failed')).toBe(true)
  const permissions = buildFeatureInventory([], [{ ...plugin, approvedPermissions: ['commands'] }], true)
  expect(permissions[0]?.unavailableReason).toBeNull()
  expect(permissions[1]?.unavailableReason).toContain('권한 승인')
})
