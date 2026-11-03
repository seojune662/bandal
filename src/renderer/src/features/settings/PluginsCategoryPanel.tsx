import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, PackageSearch, Search } from 'lucide-react'
import type { McpServerSummary } from '../../../../shared/types/mcp'
import type { PluginLogEntry, PluginSummary } from '../../../../shared/types/plugin'
import type { Settings } from '../../../../shared/types/settings'
import { describePermission } from '../../../../shared/plugins/permissions'
import { Button } from '../../components/ui/button'
import { useConfirm } from '../../components/ui/confirm-dialog-context'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'
import { Input, Textarea } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Switch } from '../../components/ui/switch'
import { useLocale, useT } from '../../i18n'
import { invoke, onPush } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { usePluginsStore } from '../../stores/pluginsStore'
import { useUiStore } from '../../stores/uiStore'
import { useWorkflowPacksStore } from '../../stores/workflowPacksStore'
import { PluginPermissionDialog } from '../plugins/PluginPermissionDialog'
import { CatalogPanel } from './catalog/CatalogPanel'
import {
  SettingsEmptyState,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSegmented,
  SettingsStack
} from './kit/SettingsKit'
import { SettingsGroupMatchProvider, useIsSettingsSearching, useSettingsEntry } from './kit/SettingsSearchContext'
import { PluginDevelopmentPanel } from './PluginDevelopmentPanel'
import { MarketplacePanel } from './MarketplacePanel'
import { PluginConfiguration } from './PluginConfiguration'
import { ImportDialog } from './PacksPanel'
import { McpServerEditor, loadMcpServers, summaryInput, useMcpRegistry } from './McpServersPanel'
import { parseMcpConfigText } from './mcpImport'
import { type McpPreset } from './mcpPresets'
import { PluginFeatureMark } from './PluginFeatureMark'
import { buildPluginCenterRows, filterPluginCenterRows, type PluginCenterFilter, type PluginCenterRow } from './pluginCenterModel'
import { matchesSettingsSearch } from './search/settingsSearch'
import './settings-plugins.css'

type CenterView = { kind: 'list' } | { kind: 'row'; id: string } | { kind: 'catalog' | 'developer' | 'manual' | 'import' }
const FILTERS = ['all', 'study', 'plugin', 'external'] as const

function approved(plugin: PluginSummary): boolean {
  return plugin.state !== 'needs-approval' && plugin.approvedPermissions !== null && plugin.manifest.permissions.every(permission => plugin.approvedPermissions?.includes(permission))
}

function availablePresetName(preset: McpPreset, servers: readonly McpServerSummary[]): string {
  const base = preset.input('', {}).name
  let candidate = base, suffix = 2
  while (servers.some(server => server.name === candidate)) candidate = `${base}-${suffix++}`
  return candidate
}

/** Inline copy block used by the detail views (muted, selectable). */
function Copy({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <p className={cn('text-xs leading-relaxed text-muted-foreground select-text', className)}>{children}</p>
}

function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <details className="group rounded-lg border border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer text-sm font-medium text-foreground select-none">{summary}</summary>
      <div className="mt-3 space-y-2 select-text [overflow-wrap:anywhere]">{children}</div>
    </details>
  )
}

function PresetSetup({ preset, disabled, busy, onSave }: { preset: McpPreset; disabled: boolean; busy: boolean; onSave: (values: Record<string, string>) => void }): JSX.Element {
  const t = useT()
  const baseId = useId()
  const [values, setValues] = useState<Record<string, string>>({})
  const complete = preset.fields.every(field => (values[field.key] ?? '').trim())
  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-card/60 px-4 py-4"
      onSubmit={event => { event.preventDefault(); if (complete && !busy && !disabled) onSave(values) }}
    >
      <Copy>{t('settings.pluginCenter.preset.intro')}</Copy>
      {preset.id === 'notion' && (
        <Copy>
          {t('settings.pluginCenter.preset.notionGuide')}{' '}
          <Button
            type="button"
            variant="link"
            size="xs"
            className="text-xs"
            onClick={() => { void invoke('shell:openExternal', { url: 'https://www.notion.com/help/create-integrations-with-the-notion-api' }).catch(() => undefined) }}
          >
            {t('settings.pluginCenter.preset.notionGuideLink')}
          </Button>
        </Copy>
      )}
      {preset.fields.map(field => (
        <div className="space-y-1.5" key={field.key}>
          <Label htmlFor={`${baseId}-${field.key}`}>{t(field.labelKey)}</Label>
          <Input
            id={`${baseId}-${field.key}`}
            type={field.secret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}
          />
        </div>
      ))}
      <SettingsNotice>{t('settings.pluginCenter.preset.hint')}</SettingsNotice>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={disabled || busy || !complete}>
          {busy ? t('settings.pluginCenter.preset.checking') : t('settings.pluginCenter.connectAndUse')}
        </Button>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">{t('settings.pluginCenter.preset.details')}</summary>
        <code className="mt-2 block [overflow-wrap:anywhere]">{preset.packageName}</code>
      </details>
    </form>
  )
}

function PluginLogs({ id }: { id: string }): JSX.Element {
  const t = useT()
  const [entries, setEntries] = useState<PluginLogEntry[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => { let active = true; void invoke('plugins:logs', { id }).then(result => { if (active) setEntries(result.entries) }).catch(() => { if (active) setError(true) }); return () => { active = false } }, [id])
  return (
    <div className="plugin-center-logs max-h-80 space-y-1 overflow-auto rounded-lg border border-border bg-secondary/60 p-3 font-mono text-2xs text-secondary-foreground select-text [overflow-wrap:anywhere]">
      {error ? <p role="alert" className="text-destructive">{t('settings.plugins.error.logs')}</p>
        : entries === null ? <p role="status">{t('settings.plugins.logs.loading')}</p>
          : entries.length === 0 ? <p>{t('settings.plugins.logs.empty')}</p>
            : entries.map((entry, index) => <p key={index}><time>{entry.at}</time> {entry.level}: {entry.message}</p>)}
    </div>
  )
}

/**
 * The feature list is dynamic (packs, plugins, MCP servers), so it filters
 * itself against the settings search: the section's catalog entry (or the
 * pane title) shows every row, otherwise only rows whose name, outcome or
 * manifest setting titles match.
 */
function FeatureListSection({ searchId, rows, header, children }: { searchId: string; rows: readonly PluginCenterRow[]; header: ReactNode; children: (rows: readonly PluginCenterRow[]) => ReactNode }): JSX.Element | null {
  const t = useT()
  const entry = useSettingsEntry(searchId)
  const searching = useIsSettingsSearching()
  const query = useUiStore(state => state.settingsSearchQuery)
  const sectionMatches = !searching || (entry !== undefined && matchesSettingsSearch(query, entry)) || matchesSettingsSearch(query, { title: t('settings.category.packs.label') })
  const shown = sectionMatches ? rows : rows.filter(row => matchesSettingsSearch(query, {
    title: row.name,
    description: row.outcome,
    keywords: [
      ...(row.kind === 'external' ? [row.server.name] : []),
      ...(row.kind === 'plugin' ? [row.plugin.manifest.id, ...(row.plugin.manifest.contributes.settings ?? []).map(field => field.title)] : [])
    ]
  }))
  if (!sectionMatches && shown.length === 0) return null
  return (
    <section data-settings-group={searchId} data-settings-target={searchId} className="scroll-mt-6 space-y-3">
      {header}
      <SettingsGroupMatchProvider value>{children(shown)}</SettingsGroupMatchProvider>
    </section>
  )
}

export function PluginsCategoryPanel({ initialFilter = 'all' }: { initialFilter?: PluginCenterFilter } = {}): JSX.Element {
  const t = useT()
  const locale = useLocale()
  const confirm = useConfirm()
  const [view, setView] = useState<CenterView>({ kind: 'list' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PluginCenterFilter>(initialFilter)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [settingsError, setSettingsError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [permissionPlugin, setPermissionPlugin] = useState<PluginSummary | null>(null)
  const [runtimePlugin, setRuntimePlugin] = useState<PluginSummary | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [packImportOpen, setPackImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const importId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(0)
  const focusRow = useRef<string | null>(null)
  const packs = useWorkflowPacksStore(state => state.packs)
  const packsLoading = useWorkflowPacksStore(state => state.loading)
  const packsError = useWorkflowPacksStore(state => state.error)
  const plugins = usePluginsStore(state => state.plugins)
  const pluginsLoading = usePluginsStore(state => state.loading)
  const pluginsError = usePluginsStore(state => state.error)
  const registry = useMcpRegistry()
  const runtime = settings?.experimental.extensionRuntime ?? false
  const rows = useMemo(() => buildPluginCenterRows(packs, plugins, registry.servers, runtime, locale), [packs, plugins, registry.servers, runtime, locale])
  const visible = useMemo(() => filterPluginCenterRows(rows, query, filter), [rows, query, filter])
  const selected = view.kind === 'row' ? rows.find(row => row.id === view.id) : undefined
  const parsedImport = useMemo(() => parseMcpConfigText(importText), [importText])
  const available = registry.availability?.available === true
  const unavailableReason = registry.availability?.reason ?? t('settings.mcp.unavailable')
  const otherEnabled = plugins.filter(plugin => plugin.manifest.id !== (permissionPlugin ?? runtimePlugin)?.manifest.id && plugin.enabled && approved(plugin)).map(plugin => plugin.manifest.name)
  const runtimeNotice = `${t('settings.pluginCenter.runtime.notice')}${otherEnabled.length ? ` ${t('settings.pluginCenter.runtime.noticeOthers', { names: otherEnabled.join(', ') })}` : ''}`

  useEffect(() => { setFilter(initialFilter) }, [initialFilter])
  useEffect(() => {
    let active = true, pushed = false
    setSettingsError(false)
    const stop = onPush('settings:changed', ({ settings: next }) => { pushed = true; if (active) setSettings(next) })
    void invoke('settings:get', {}).then(next => { if (active && !pushed) setSettings(next) }).catch(() => { if (active) setSettingsError(true) })
    void useWorkflowPacksStore.getState().load()
    void usePluginsStore.getState().refresh().catch(() => undefined)
    return () => { active = false; stop() }
  }, [attempt])
  useEffect(() => {
    if (view.kind !== 'list') { const scroller = rootRef.current?.closest('.settings-content'); if (scroller) scroller.scrollTop = 0; return }
    const scroller = rootRef.current?.closest('.settings-content')
    if (scroller) scroller.scrollTop = scrollTop.current
    if (focusRow.current) [...rootRef.current?.querySelectorAll<HTMLElement>('[data-feature-id]') ?? []].find(row => row.dataset['featureId'] === focusRow.current)?.querySelector<HTMLElement>('.plugin-center-row__open')?.focus({ preventScroll: true })
  }, [view])

  const openView = (next: CenterView, rowId?: string): void => {
    if (view.kind === 'list') scrollTop.current = rootRef.current?.closest('.settings-content')?.scrollTop ?? 0
    focusRow.current = rowId ?? null
    setLogsOpen(false); setEditing(false); setFeedback(null); setView(next)
  }
  const back = (): void => { setEditing(false); setLogsOpen(false); setView({ kind: 'list' }) }
  const run = async (id: string, operation: () => Promise<void>): Promise<void> => {
    if (pending !== null) return
    setPending(id); setFeedback(null)
    try { await operation() } catch (error) { setFeedback(error instanceof Error ? error.message : t('settings.pluginCenter.error.generic')) } finally { setPending(null) }
  }
  const enablePlugin = async (plugin: PluginSummary, enableRuntime = false): Promise<void> => {
    await run(`plugin:${plugin.manifest.id}`, async () => {
      if (!approved(plugin)) await invoke('plugins:approve', { id: plugin.manifest.id })
      if (enableRuntime) setSettings(await invoke('settings:set', { experimental: { extensionRuntime: true } }))
      await invoke('plugins:setEnabled', { id: plugin.manifest.id, enabled: true })
      await usePluginsStore.getState().refresh()
      setPermissionPlugin(null); setRuntimePlugin(null)
    })
  }
  const checkAndEnable = async (server: McpServerSummary): Promise<void> => {
    const result = await invoke('mcp:test', { id: server.id })
    if (!result.ok) { await loadMcpServers(); throw new Error(result.error || t('settings.pluginCenter.error.checkFailed')) }
    await invoke('mcp:save', summaryInput(server, true))
    await loadMcpServers()
  }
  const toggle = (row: PluginCenterRow): void => {
    if (pending !== null) return
    if (row.kind === 'study') { void run(row.id, () => useWorkflowPacksStore.getState().setEnabled(row.summary.pack.id, !row.checked)); return }
    if (row.kind === 'plugin') {
      if (row.checked) { void run(row.id, async () => { await invoke('plugins:setEnabled', { id: row.plugin.manifest.id, enabled: false }); await usePluginsStore.getState().refresh() }); return }
      if (!approved(row.plugin)) { setPermissionPlugin(row.plugin); return }
      if (!runtime) { setRuntimePlugin(row.plugin); return }
      void enablePlugin(row.plugin); return
    }
    if (row.kind === 'external') void run(row.id, async () => { if (row.server.enabled) { await invoke('mcp:save', summaryInput(row.server, false)); await loadMcpServers() } else await checkAndEnable(row.server) })
  }
  const savedExternal = (server: McpServerSummary): void => {
    setEditing(false); setView({ kind: 'row', id: `mcp:${server.id}` })
    void run(`mcp:${server.id}`, () => checkAndEnable(server))
  }
  const installFolder = (): void => { void run('install', async () => { const picked = await invoke('plugins:pickFolder', {}); if (!picked.path) return; const result = await invoke('plugins:installFromFolder', { path: picked.path }); await usePluginsStore.getState().refresh(); openView({ kind: 'row', id: `plugin:${result.plugin.manifest.id}` }); if (result.warnings.length) setFeedback(result.warnings.join('\n')) }) }
  const stopRuntime = (): void => { void run('runtime', async () => { setSettings(await invoke('settings:set', { experimental: { extensionRuntime: false } })); await usePluginsStore.getState().refresh() }) }
  const showExternal = (): void => {
    setFilter('external')
    const scroller = rootRef.current?.closest('.settings-content')
    if (scroller) scroller.scrollTop = 0
  }
  const actionDisabled = pending !== null
  const switchFor = (row: PluginCenterRow): JSX.Element => (
    <Switch
      aria-label={t('settings.pluginCenter.useLabel', { name: row.name })}
      checked={row.checked}
      disabled={actionDisabled || row.kind === 'plugin' && (settings === null || row.plugin.state === 'starting' && runtime) || row.kind === 'external' && !available}
      onCheckedChange={() => toggle(row)}
    />
  )

  const removeStudyTool = async (row: Extract<PluginCenterRow, { kind: 'study' }>): Promise<void> => {
    const ok = await confirm({ title: t('settings.pluginCenter.study.removeConfirm', { name: row.name }), confirmLabel: t('settings.pluginCenter.remove'), confirmVariant: 'destructive' })
    if (ok) void run(row.id, async () => { await useWorkflowPacksStore.getState().remove(row.summary.pack.id); back() })
  }
  const uninstallPlugin = async (row: Extract<PluginCenterRow, { kind: 'plugin' }>): Promise<void> => {
    const ok = await confirm({ title: t('settings.plugins.confirmUninstall', { name: row.name }), confirmLabel: t('settings.pluginCenter.remove'), confirmVariant: 'destructive' })
    if (ok) void run(row.id, async () => { await invoke('plugins:uninstall', { id: row.plugin.manifest.id }); await usePluginsStore.getState().refresh(); back() })
  }
  const removeServer = async (row: Extract<PluginCenterRow, { kind: 'external' }>): Promise<void> => {
    const ok = await confirm({ title: t('settings.mcp.delete.title', { name: row.name }), description: t('settings.mcp.delete.message', { name: row.name }), confirmLabel: t('settings.pluginCenter.external.remove'), confirmVariant: 'destructive' })
    if (ok) void run(row.id, async () => { await invoke('mcp:delete', { id: row.server.id }); await loadMcpServers(); back() })
  }

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          {t('settings.pluginCenter.add')}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem disabled={actionDisabled} onSelect={installFolder}>{t('settings.packs.manage.installFolder.title')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setPackImportOpen(true)}>{t('settings.packs.manage.importPack.title')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openView({ kind: 'import' })}>{t('settings.packs.manage.importMcp.title')}</DropdownMenuItem>
        <DropdownMenuItem disabled={!available} onSelect={() => openView({ kind: 'manual' })}>{t('settings.packs.manage.manualMcp.title')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openView({ kind: 'developer' })}>{t('settings.packs.manage.developer.title')}</DropdownMenuItem>
        {runtime && <DropdownMenuItem variant="destructive" disabled={actionDisabled} onSelect={stopRuntime}>{t('settings.pluginCenter.stopRuntime')}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const listView = (
    <SettingsStack>
      <FeatureListSection
        searchId="packs.features"
        rows={visible}
        header={<>
          <div className="flex flex-wrap items-center gap-2">
            <div className="plugin-center-search relative min-w-36 flex-[1_1_15rem]">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="pl-8"
                aria-label={t('settings.pluginCenter.search')}
                placeholder={t('settings.pluginCenter.search')}
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </div>
            <SettingsSegmented
              ariaLabel={t('settings.pluginCenter.filter')}
              value={filter}
              options={FILTERS.map(id => ({ value: id, label: t(`settings.pluginCenter.filter.${id}`) }))}
              onChange={setFilter}
            />
            <Button variant="secondary" size="sm" onClick={() => openView({ kind: 'catalog' })}>{t('settings.pluginCenter.browse')}</Button>
            {addMenu}
          </div>
          {(packsLoading || pluginsLoading || registry.loading) && rows.length === 6 && <p role="status" className="text-xs text-muted-foreground">{t('settings.pluginCenter.loading')}</p>}
          {(packsError || pluginsError || settingsError || registry.error) && (
            <SettingsNotice
              tone="danger"
              action={<Button variant="secondary" size="xs" onClick={() => { setAttempt(n => n + 1); void loadMcpServers() }}>{t('settings.plugins.action.retry')}</Button>}
            >
              {t('settings.pluginCenter.loadPartialError')}
            </SettingsNotice>
          )}
          {!available && registry.availability && <SettingsNotice>{registry.availability.reason}</SettingsNotice>}
        </>}
      >
        {shown => shown.length === 0 ? (
          <SettingsEmptyState
            icon={<PackageSearch />}
            title={t('settings.pluginCenter.empty')}
            description={t('settings.pluginCenter.emptyDescription')}
            {...(query !== '' || filter !== 'all' ? { action: <Button variant="secondary" size="sm" onClick={() => { setQuery(''); setFilter('all') }}>{t('settings.pluginCenter.clearFilters')}</Button> } : {})}
          />
        ) : (
          <ul className="plugin-center-list divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/60" aria-label={t('settings.pluginCenter.list')}>
            {shown.map(row => (
              <li className="plugin-center-row flex items-center gap-4 px-3 py-2.5 max-[650px]:flex-wrap max-[650px]:gap-2" data-feature-id={row.id} key={row.id}>
                <button
                  type="button"
                  className="plugin-center-row__open flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-start transition-colors duration-(--dur-fast) hover:bg-accent"
                  onClick={() => openView({ kind: 'row', id: row.id }, row.id)}
                >
                  <PluginFeatureMark row={row} />
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="text-sm font-medium text-foreground">{row.name}</strong>
                    <span className="text-xs leading-relaxed text-muted-foreground">{row.outcome}</span>
                  </span>
                </button>
                <span className="max-w-24 shrink-0 text-end text-2xs text-muted-foreground max-[650px]:ms-14 max-[650px]:max-w-none max-[650px]:text-start">{row.status}</span>
                {row.kind === 'preset'
                  ? <Button variant="secondary" size="sm" disabled={!available || actionDisabled} onClick={() => openView({ kind: 'row', id: row.id }, row.id)}>{t('settings.pluginCenter.setup')}</Button>
                  : switchFor(row)}
              </li>
            ))}
          </ul>
        )}
      </FeatureListSection>

      <SettingsGroup searchId="packs.manage">
        <SettingsRow
          searchId="packs.manage.catalog"
          control={<Button variant="secondary" size="sm" onClick={() => openView({ kind: 'catalog' })}>{t('settings.packs.manage.catalog.action')}</Button>}
        />
        <SettingsRow
          searchId="packs.manage.external"
          control={<Button variant="secondary" size="sm" disabled={filter === 'external'} onClick={showExternal}>{t('settings.packs.manage.external.action')}</Button>}
        />
        <SettingsRow
          searchId="packs.manage.installFolder"
          control={<Button variant="secondary" size="sm" disabled={actionDisabled} onClick={installFolder}>{t('settings.packs.manage.installFolder.action')}</Button>}
        />
        <SettingsRow
          searchId="packs.manage.importPack"
          control={<Button variant="secondary" size="sm" onClick={() => setPackImportOpen(true)}>{t('settings.packs.manage.importPack.action')}</Button>}
        />
        <SettingsRow
          searchId="packs.manage.importMcp"
          control={<Button variant="secondary" size="sm" onClick={() => openView({ kind: 'import' })}>{t('settings.packs.manage.importMcp.action')}</Button>}
        />
        <SettingsRow
          searchId="packs.manage.manualMcp"
          disabled={!available}
          disabledReason={unavailableReason}
          control={<Button variant="secondary" size="sm" disabled={!available} onClick={() => openView({ kind: 'manual' })}>{t('settings.packs.manage.manualMcp.action')}</Button>}
        />
        <SettingsRow
          searchId="packs.manage.developer"
          control={<Button variant="secondary" size="sm" onClick={() => openView({ kind: 'developer' })}>{t('settings.packs.manage.developer.action')}</Button>}
        />
      </SettingsGroup>
    </SettingsStack>
  )

  const statusRow = (row: PluginCenterRow, description?: ReactNode): JSX.Element => (
    <SettingsRow
      label={t('settings.pluginCenter.detail.status')}
      description={description}
      badge={<span className="text-2xs text-muted-foreground">{row.status}</span>}
      {...(row.kind !== 'preset' ? { control: switchFor(row) } : {})}
    />
  )

  const detailView = (
    <SettingsGroupMatchProvider value>
      <SettingsStack className="gap-5">
        <Button variant="ghost" size="sm" className="-ms-2 w-fit" onClick={back}>
          <ArrowLeft aria-hidden="true" />
          {t('settings.pluginCenter.back')}
        </Button>
        {selected && <>
          <header className="flex items-center gap-3">
            <PluginFeatureMark row={selected} />
            <div className="min-w-0 space-y-0.5">
              <h2 className="text-base font-semibold tracking-tight text-foreground">{selected.name}</h2>
              <Copy>{selected.outcome}</Copy>
            </div>
          </header>

          {selected.kind === 'study' && <>
            <SettingsGroup>{statusRow(selected, t('settings.pluginCenter.study.enabledNote'))}</SettingsGroup>
            <Disclosure summary={t('settings.pluginCenter.study.details')}>
              <p>{t('settings.plugins.metadata', { version: selected.summary.pack.version, author: selected.summary.pack.author })}</p>
              <p>{selected.summary.pack.schemaVersion === 2 ? t('settings.pluginCenter.study.v2Output') : t('settings.pluginCenter.study.v1Output', { dir: selected.summary.pack.outputs.dir })}</p>
              <pre className="max-h-80 overflow-auto font-mono text-2xs whitespace-pre-wrap">{selected.summary.pack.recipe}</pre>
            </Disclosure>
            {selected.summary.source === 'user' && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => { void run(selected.id, async () => { await navigator.clipboard.writeText(JSON.stringify(selected.summary.pack, null, 2)); setFeedback(t('settings.pluginCenter.study.copied')) }) }}>{t('settings.pluginCenter.study.copy')}</Button>
                <Button variant="destructive-outline" size="sm" disabled={actionDisabled} onClick={() => { void removeStudyTool(selected) }}>{t('settings.pluginCenter.remove')}</Button>
              </div>
            )}
          </>}

          {selected.kind === 'plugin' && <>
            {!runtime && <SettingsNotice>{t('settings.pluginCenter.plugin.runtimeOff')}</SettingsNotice>}
            {selected.plugin.lastError && <SettingsNotice tone="danger">{selected.plugin.lastError}</SettingsNotice>}
            <SettingsGroup>
              {statusRow(selected)}
              <SettingsRow
                label={t('settings.pluginCenter.plugin.actions')}
                description={t('settings.pluginCenter.plugin.actionsNote')}
                alignTop
                footer={
                  <ul className="list-disc space-y-0.5 ps-5 text-xs text-secondary-foreground">
                    {selected.plugin.manifest.contributes.commands.map(command => <li key={command.id}>{command.title}</li>)}
                    {selected.plugin.manifest.contributes.panels.map(panel => <li key={panel.id}>{panel.title}</li>)}
                  </ul>
                }
              />
            </SettingsGroup>
            {(selected.plugin.manifest.contributes.settings?.length ?? 0) > 0 && <PluginConfiguration manifest={selected.plugin.manifest} />}
            <Disclosure summary={t('settings.pluginCenter.plugin.permissions')}>
              <p>{t('settings.plugins.metadata', { version: selected.plugin.manifest.version, author: selected.plugin.manifest.author })}</p>
              <ul className="list-disc space-y-0.5 ps-5">{selected.plugin.manifest.permissions.map(permission => <li key={permission}>{describePermission(permission, locale)}</li>)}</ul>
            </Disclosure>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={actionDisabled || !runtime} onClick={() => { void run(selected.id, async () => { await invoke('plugins:reload', { id: selected.plugin.manifest.id }); await usePluginsStore.getState().refresh() }) }}>{t('settings.pluginCenter.plugin.restart')}</Button>
              <Button variant="secondary" size="sm" aria-expanded={logsOpen} onClick={() => setLogsOpen(open => !open)}>{t('settings.pluginCenter.plugin.viewLogs')}</Button>
              <Button variant="destructive-outline" size="sm" disabled={actionDisabled} onClick={() => { void uninstallPlugin(selected) }}>{t('settings.pluginCenter.remove')}</Button>
            </div>
            {logsOpen && <PluginLogs id={selected.plugin.manifest.id} />}
          </>}

          {selected.kind === 'preset' && <>
            <SettingsGroup>{statusRow(selected)}</SettingsGroup>
            <PresetSetup key={selected.id} preset={selected.preset} disabled={!available} busy={actionDisabled} onSave={values => { void run(selected.id, async () => { const result = await invoke('mcp:save', { ...selected.preset.input(t(selected.preset.descriptionKey), values), name: availablePresetName(selected.preset, registry.servers), enabled: false }); setView({ kind: 'row', id: `mcp:${result.server.id}` }); await loadMcpServers(); await checkAndEnable(result.server) }) }} />
          </>}

          {selected.kind === 'external' && <>
            <SettingsGroup>
              {statusRow(selected, t('settings.pluginCenter.external.note'))}
              <SettingsRow
                label={t('settings.pluginCenter.external.check')}
                description={t('settings.pluginCenter.external.checkNote')}
                alignTop
                footer={
                  <div className="space-y-1.5 text-xs text-secondary-foreground">
                    {selected.server.lastTest && <p>{t('settings.pluginCenter.external.lastCheck')}<time dateTime={selected.server.lastTest.at}>{new Date(selected.server.lastTest.at).toLocaleString(locale)}</time></p>}
                    {selected.server.lastTest?.ok && <p>{t('settings.pluginCenter.external.toolsChecked', { count: selected.server.lastTest.tools.length })}</p>}
                    {selected.server.lastTest?.error && <p role="alert" className="text-destructive [overflow-wrap:anywhere]">{selected.server.lastTest.error}</p>}
                  </div>
                }
              />
            </SettingsGroup>
            <SettingsNotice>{t('settings.pluginCenter.external.hint')}</SettingsNotice>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={actionDisabled || !available} onClick={() => { void run(selected.id, async () => { const result = await invoke('mcp:test', { id: selected.server.id }); await loadMcpServers(); if (!result.ok) throw new Error(result.error || t('settings.pluginCenter.error.review')) }) }}>{t('settings.pluginCenter.external.checkAgain')}</Button>
              <Button variant="secondary" size="sm" disabled={actionDisabled || !available} onClick={() => setEditing(true)}>{t('settings.pluginCenter.external.edit')}</Button>
              <Button variant="destructive-outline" size="sm" disabled={actionDisabled} onClick={() => { void removeServer(selected) }}>{t('settings.pluginCenter.external.remove')}</Button>
            </div>
            {editing && <McpServerEditor key={selected.server.id} server={selected.server} disableOnSave submitLabel={t('settings.pluginCenter.external.saveAndReconnect')} onCancel={() => setEditing(false)} onSaved={savedExternal} />}
            <Disclosure summary={t('settings.pluginCenter.external.details')}>
              <p>{selected.server.name} · {selected.server.transport}</p>
              <code className="block">{selected.server.command ?? selected.server.url}</code>
              <ul className="list-disc space-y-0.5 ps-5">{selected.server.lastTest?.tools.map(tool => <li key={tool}>{tool}</li>)}</ul>
            </Disclosure>
          </>}
        </>}

        {view.kind === 'catalog' && <CatalogPanel settings={settings} />}
        {view.kind === 'developer' && <><PluginDevelopmentPanel /><MarketplacePanel /></>}
        {view.kind === 'manual' && <>
          <Copy>{t('settings.pluginCenter.manual.intro')}</Copy>
          <McpServerEditor server={null} submitLabel={t('settings.pluginCenter.connectAndUse')} onCancel={back} onSaved={savedExternal} />
        </>}
        {view.kind === 'import' && (
          <form
            className="space-y-4 rounded-lg border border-border bg-card/60 px-4 py-4"
            onSubmit={event => { event.preventDefault(); void run('import', async () => { let failed = 0; for (const input of parsedImport.servers) { try { await invoke('mcp:save', { ...input, enabled: false }) } catch { failed++ } } await loadMcpServers(); if (failed) throw new Error(t('settings.pluginCenter.import.saveFailed', { count: failed })); setImportText(''); setFilter('external'); back(); setFeedback(t('settings.pluginCenter.import.done')) }) }}
          >
            <div className="space-y-0.5">
              <h2 className="text-sm font-medium text-foreground">{t('settings.packs.manage.importMcp.title')}</h2>
              <Copy>{t('settings.pluginCenter.import.description')}</Copy>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={importId}>{t('settings.pluginCenter.import.label')}</Label>
              <Textarea id={importId} rows={8} spellCheck={false} className="font-mono text-xs" value={importText} onChange={event => setImportText(event.target.value)} />
            </div>
            {parsedImport.errors.map(error => <p role="alert" className="text-xs text-destructive" key={error}>{error}</p>)}
            {parsedImport.servers.length > 0 && <ul className="list-disc space-y-0.5 ps-5 text-xs text-secondary-foreground">{parsedImport.servers.map(server => <li key={server.name}>{server.name}</li>)}</ul>}
            <Button type="submit" size="sm" disabled={actionDisabled || !available || !parsedImport.servers.length || parsedImport.errors.length > 0}>{t('settings.pluginCenter.import.submit')}</Button>
          </form>
        )}
      </SettingsStack>
    </SettingsGroupMatchProvider>
  )

  return <div className="plugin-center grid min-w-0 gap-4" ref={rootRef} aria-busy={pending !== null}>
    {view.kind === 'list' ? listView : detailView}
    {feedback && <SettingsNotice className="whitespace-pre-wrap [overflow-wrap:anywhere]">{feedback}</SettingsNotice>}
    {packImportOpen && <ImportDialog onClose={() => setPackImportOpen(false)} />}
    {permissionPlugin && <PluginPermissionDialog plugin={permissionPlugin} pending={actionDisabled} notice={!runtime ? runtimeNotice : undefined} approveLabel={!runtime ? t('settings.pluginCenter.runtime.approveAndEnable') : undefined} onApprove={() => { void enablePlugin(permissionPlugin, !runtime) }} onCancel={() => setPermissionPlugin(null)} />}
    <Dialog open={runtimePlugin !== null} onOpenChange={open => { if (!open && pending === null) setRuntimePlugin(null) }}>
      <DialogContent size="compact" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('settings.pluginCenter.runtime.title')}</DialogTitle>
          <DialogDescription>{runtimeNotice}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={actionDisabled} onClick={() => setRuntimePlugin(null)}>{t('settings.plugins.action.cancel')}</Button>
          <Button size="sm" disabled={actionDisabled} onClick={() => { if (runtimePlugin) void enablePlugin(runtimePlugin, true) }}>{t('settings.pluginCenter.runtime.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
