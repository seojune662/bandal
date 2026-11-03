import type { McpServerSummary } from '../../../../shared/types/mcp'
import type { PluginSummary } from '../../../../shared/types/plugin'
import type { WorkflowPackSummary } from '../../../../shared/types/workflowPack'
import type { Locale } from '../../i18n'
import { translate } from '../../i18n/translate'
import { MCP_PRESETS, presetForServer, type McpPreset } from './mcpPresets'

export type PluginCenterFilter = 'all' | 'study' | 'plugin' | 'external'
interface RowBase { id: string; name: string; outcome: string; status: string; checked: boolean }
export type PluginCenterRow = RowBase & (
  | { kind: 'study'; summary: WorkflowPackSummary }
  | { kind: 'plugin'; plugin: PluginSummary }
  | { kind: 'external'; server: McpServerSummary }
  | { kind: 'preset'; preset: McpPreset }
)

const PACK_OUTCOMES = new Set(['summary', 'mindmap', 'structured-notes', 'exam-predictions', 'explain'])
const EXTERNAL_OUTCOMES = new Set(['notion', 'github', 'google-drive', 'slack', 'filesystem', 'fetch'])

export function packOutcome(summary: WorkflowPackSummary, locale: Locale): string {
  const { pack } = summary
  if (pack.schemaVersion === 2) {
    if (pack.experience === 'quiz') return translate(locale, 'settings.pluginCenter.outcome.quiz')
    if (pack.experience === 'flashcards') return translate(locale, 'settings.pluginCenter.outcome.flashcards')
    return translate(locale, 'settings.pluginCenter.outcome.article')
  }
  return PACK_OUTCOMES.has(pack.id) ? translate(locale, `settings.pluginCenter.outcome.${pack.id}`) : pack.description
}

export function externalOutcome(server: McpServerSummary, locale: Locale): string {
  const preset = presetForServer(server)
  if (preset && EXTERNAL_OUTCOMES.has(preset.id)) return translate(locale, `settings.pluginCenter.externalOutcome.${preset.id}`)
  return server.description || translate(locale, 'settings.pluginCenter.externalOutcome.default')
}

export function pluginStatus(plugin: PluginSummary, runtime: boolean, locale: Locale): string {
  const status = (key: string): string => translate(locale, `settings.pluginCenter.status.${key}`)
  if (plugin.state === 'needs-approval' || !plugin.approvedPermissions || !plugin.manifest.permissions.every(p => plugin.approvedPermissions?.includes(p))) return status('approval')
  if (!plugin.enabled) return status('off')
  if (!runtime) return status('runtimeOff')
  if (plugin.state === 'errored') return status('errored')
  if (plugin.state === 'starting') return status('starting')
  return plugin.state === 'active' ? status('active') : status('off')
}

function externalStatus(server: McpServerSummary, locale: Locale): string {
  const result = server.lastTest?.ok === true ? 'checked' : server.lastTest?.ok === false ? 'failed' : 'unchecked'
  return translate(locale, `settings.pluginCenter.status.${result}${server.enabled ? '' : 'Off'}`)
}

export function buildPluginCenterRows(packs: readonly WorkflowPackSummary[], plugins: readonly PluginSummary[], servers: readonly McpServerSummary[], runtime: boolean, locale: Locale): PluginCenterRow[] {
  const t = (key: string): string => translate(locale, key)
  const compareName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, locale === 'ko-KR' ? 'ko' : 'en')
  const packRows = packs.map(summary => ({ kind: 'study' as const, id: `pack:${summary.pack.id}`, name: summary.pack.schemaVersion === 2 && summary.pack.experience === 'article-vocabulary' ? t('settings.pluginCenter.articleName') : summary.pack.name, outcome: packOutcome(summary, locale), status: t(summary.enabled ? 'settings.pluginCenter.status.active' : 'settings.pluginCenter.status.off'), checked: summary.enabled, summary }))
  const builtin = packRows.filter(row => row.summary.source === 'builtin')
  const custom = packRows.filter(row => row.summary.source === 'user').sort(compareName)
  const extensions = plugins.map(plugin => ({ kind: 'plugin' as const, id: `plugin:${plugin.manifest.id}`, name: plugin.manifest.name, outcome: plugin.manifest.description || t('settings.pluginCenter.pluginDefaultOutcome'), status: pluginStatus(plugin, runtime, locale), checked: runtime && plugin.enabled && plugin.state === 'active', plugin })).sort(compareName)
  const external = servers.map(server => ({ kind: 'external' as const, id: `mcp:${server.id}`, name: presetForServer(server)?.name ?? server.name, outcome: externalOutcome(server, locale), status: externalStatus(server, locale), checked: server.enabled, server })).sort(compareName)
  const configured = new Set(servers.map(server => presetForServer(server)?.id).filter(Boolean))
  const presets = MCP_PRESETS.filter(preset => !configured.has(preset.id)).map(preset => {
    const input = preset.input('', {})
    const temporary: McpServerSummary = { ...input, id: preset.id, envKeys: [], headerKeys: [], createdAt: '', updatedAt: '' }
    return { kind: 'preset' as const, id: `preset:${preset.id}`, name: preset.id === 'filesystem' ? t('settings.pluginCenter.filesystemName') : preset.name, outcome: externalOutcome(temporary, locale), status: t('settings.pluginCenter.status.setupNeeded'), checked: false, preset }
  })
  return [...builtin, ...custom, ...extensions, ...external, ...presets]
}

export function filterPluginCenterRows(rows: readonly PluginCenterRow[], query: string, filter: PluginCenterFilter): PluginCenterRow[] {
  const needle = query.trim().toLocaleLowerCase()
  return rows.filter(row => (filter === 'all' || (filter === 'external' ? row.kind === 'external' || row.kind === 'preset' : row.kind === filter)) && (!needle || `${row.name} ${row.outcome} ${row.kind === 'external' ? row.server.name : ''}`.toLocaleLowerCase().includes(needle)))
}
