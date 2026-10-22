import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { useUiStore } from '../../stores/uiStore'
import { useFeatureInventory, type FeatureEntry } from './featureInventory'
import { useLauncherContext } from './launcherContext'
import { requestFeatureAction } from './featureActions'
import './launcher.css'

/** AI packs live in the assistant. This menu contains installed app extensions. */
export function FeatureLauncherPanel({ hidden }: { hidden: boolean }): JSX.Element {
  const { entries, loading, error, reload } = useFeatureInventory()
  const { context, loading: contextLoading } = useLauncherContext()
  const railOpen = useUiStore(state => state.leftRailOpen && state.courseRailOpen)
  const settingsOpen = useUiStore(state => state.isSettingsOpen)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string[]>([])
  const [messages, setMessages] = useState<Record<string, string>>({})
  const pendingActions = useRef(new Set<string>())
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (hidden || !railOpen || settingsOpen || document.querySelector('.tour-overlay')) return
    const element = input.current
    if (!element) return
    const focus = (): boolean => {
      if (!element.isConnected || element.closest('[inert], [hidden]')) return false
      element.focus({ preventScroll: true })
      return document.activeElement === element
    }
    if (focus()) return
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect() })
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert', 'hidden'] })
    return () => observer.disconnect()
  }, [hidden, railOpen, settingsOpen])

  const run = async (entry: FeatureEntry): Promise<void> => {
    if (entry.kind === 'pack' || pendingActions.current.has(entry.id)) return
    pendingActions.current.add(entry.id)
    setPending([...pendingActions.current])
    try {
      const result = await requestFeatureAction(entry, context)
      setMessages(previous => ({ ...previous, [entry.id]: result.message }))
    } catch (caught) {
      setMessages(previous => ({ ...previous, [entry.id]: caught instanceof Error ? caught.message : '실행하지 못했어요.' }))
    } finally {
      pendingActions.current.delete(entry.id)
      setPending([...pendingActions.current])
    }
  }
  const needle = query.trim().toLocaleLowerCase()
  const filtered = entries.filter(entry => entry.kind !== 'pack' && (!needle || `${entry.label} ${entry.description} ${entry.pluginName}`.toLocaleLowerCase().includes(needle)))
  return <aside id="plugins-panel" className="app-rail app-rail--left feature-launcher" aria-label="앱 더보기" hidden={hidden}>
    <header className="launcher-header"><h2>더보기</h2><button type="button" className="bare-icon-button" aria-label="기능 새로고침" onClick={() => void reload()}><Icon name="refresh" /></button></header>
    <label className="launcher-search"><Icon name="search" /><input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="플러그인 검색" aria-label="기능 검색" /></label>
    <div className="launcher-scroll">
      {error && <p className="launcher-error" role="alert">{error} <button type="button" onClick={() => void reload()}>다시 불러오기</button></p>}
      {loading && <p className="launcher-empty" role="status">기능을 불러오는 중…</p>}
      {filtered.map(entry => {
        const reason = entry.unavailableReason || (!entry.enabled ? '이 기능이 비활성화되어 있어요.' : null)
        return <article className="launcher-feature" key={entry.id} data-kind={entry.kind}>
          <button type="button" className="launcher-feature__action" disabled={!!reason || pending.includes(entry.id) || contextLoading} title={reason ?? entry.description} onClick={() => void run(entry)}>
            <span className="launcher-feature__icon" aria-hidden="true"><Icon name="puzzle" /></span><span><strong>{entry.label}</strong><small>{entry.description}</small></span>
          </button>
          {reason && <p className="launcher-feature__reason">{reason}</p>}
          {messages[entry.id] && <p className="launcher-feature__status" role="status">{messages[entry.id]}</p>}
        </article>
      })}
      {!loading && !filtered.length && <p className="launcher-empty">{query ? '검색한 기능이 없어요.' : '플러그인 관리에서 필요한 기능을 추가해 보세요.'}</p>}
    </div>
    <footer className="launcher-footer"><button type="button" onClick={() => useUiStore.getState().openSettings('packs')}><Icon name="settings" /> 플러그인 관리 <Icon name="chevronRight" /></button></footer>
  </aside>
}
