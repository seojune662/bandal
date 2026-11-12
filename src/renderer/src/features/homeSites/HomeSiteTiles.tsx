import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { Building2, Pin, Plus } from 'lucide-react'
import { foldVisits, homeSiteHost, normalizeSiteUrl, rankHomeSites, type HomeSite, type HomeSitePreferences } from '../../../../shared/homeSites'
import { invoke, onPush } from '../../lib/ipc'
import { ensureSettingsLoaded } from '../../stores/settingsSnapshot'
import { useUiStore } from '../../stores/uiStore'
import { useUniversityStore } from '../../stores/universityStore'
import { useDismissableMenu } from '../../components/useDismissableMenu'
import { useViewportBounds } from '../../lib/useViewportBounds'
import { openShortcut } from '../university/openService'
import { AI_WEB_SHORTCUTS } from '../ai/aiShortcutModel'
import { openAiShortcut } from '../ai/openAiShortcut'
import { useSiteIcon } from './siteIcons'
import './home-sites.css'

const EMPTY: HomeSitePreferences = { pinned: [], hidden: [], custom: [] }

function aiServiceFor(host: string): (typeof AI_WEB_SHORTCUTS)[number] | undefined {
  return AI_WEB_SHORTCUTS.find(shortcut => shortcut.hosts.some(candidate => host === candidate || host.endsWith(`.${candidate}`)))
}

/** Visits folded by host, refreshed when the window regains focus (history grows while browsing). */
function useVisitedSites(): ReturnType<typeof foldVisits> {
  const [visited, setVisited] = useState<ReturnType<typeof foldVisits>>([])
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void invoke('browser:searchHistory', { query: '', limit: 200 })
        .then(result => { if (alive) setVisited(foldVisits(result.entries)) })
        .catch(() => undefined)
    }
    load()
    const interval = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    return () => { alive = false; window.clearInterval(interval); window.removeEventListener('focus', load) }
  }, [])
  return visited
}

function useHomeSitePreferences(): [HomeSitePreferences, (next: HomeSitePreferences) => void] {
  const [preferences, setPreferences] = useState<HomeSitePreferences>(EMPTY)
  useEffect(() => {
    let alive = true
    void ensureSettingsLoaded().then(settings => { if (alive) setPreferences(settings.homeSites) }).catch(() => undefined)
    const off = onPush('settings:changed', ({ settings }) => setPreferences(settings.homeSites))
    return () => { alive = false; off() }
  }, [])
  const save = useCallback((next: HomeSitePreferences) => {
    setPreferences(next)
    void invoke('settings:set', { homeSites: next }).catch(() => undefined)
  }, [])
  return [preferences, save]
}

function SiteGlyph({ site }: { site: Pick<HomeSite, 'host' | 'title'> }): JSX.Element {
  const icon = useSiteIcon(site.host)
  if (icon) return <img className="home-site__icon" src={icon} alt="" draggable={false} />
  return <span className="home-site__letter" aria-hidden="true">{(site.title.trim()[0] ?? site.host[0] ?? '?').toUpperCase()}</span>
}

/**
 * The home sidebar's sites, three across and sliding sideways for more; the
 * last tile adds one. School essentials first, then the browser's visits
 * decide the order. Right-click (iPad: long press) pins or removes a site.
 */
export function HomeSiteTiles(): JSX.Element {
  const university = useUniversityStore(state => state.university)
  const services = useUniversityStore(state => state.services)
  const initUniversity = useUniversityStore(state => state.init)
  const [preferences, savePreferences] = useHomeSitePreferences()
  const visited = useVisitedSites()
  const [menu, setMenu] = useState<{ site: HomeSite; x: number; y: number } | null>(null)
  const [adding, setAdding] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => { void initUniversity() }, [initUniversity])

  const sites = useMemo(() => rankHomeSites(
    services.map(service => ({ id: service.id, label: service.label, url: service.url, secondary: service.secondary, opensExternally: service.opensExternally })),
    preferences,
    visited
  ), [services, preferences, visited])

  const open = (site: HomeSite): void => {
    const ai = aiServiceFor(site.host)
    if (ai) openAiShortcut(ai.id)
    else openShortcut(site)
  }
  const togglePin = (site: HomeSite): void => savePreferences({
    ...preferences,
    pinned: site.pinned ? preferences.pinned.filter(id => id !== site.id) : [...preferences.pinned, site.id]
  })
  const remove = (site: HomeSite): void => savePreferences({
    pinned: preferences.pinned.filter(id => id !== site.id),
    hidden: site.source === 'custom' ? preferences.hidden : [...new Set([...preferences.hidden, site.host])],
    custom: preferences.custom.filter(custom => custom.id !== site.id)
  })
  const add = (url: string, title: string): void => {
    const host = homeSiteHost(url)
    if (!host) return
    const id = `custom:${host}`
    savePreferences({
      pinned: preferences.pinned,
      hidden: preferences.hidden.filter(hidden => hidden !== host),
      custom: [...preferences.custom.filter(custom => custom.id !== id), { id, title, url }]
    })
  }

  return (
    <section className="home-sites" aria-label="사이트">
      {university === null && (
        <button type="button" className="home-sites__school" onClick={() => useUiStore.getState().openSettings('university')}>
          <Building2 size={16} strokeWidth={1.75} aria-hidden="true" /> 학교 고르기
        </button>
      )}
      <ul className="home-sites__row" aria-label="자주 가는 사이트">
        {sites.map(site => (
          <li key={site.id}>
            <button type="button" className="home-site" title={site.url} aria-label={`${site.title}${site.pinned ? ' (고정됨)' : ''}`}
              onClick={() => open(site)}
              onContextMenu={(event: MouseEvent) => { event.preventDefault(); setMenu({ site, x: event.clientX, y: event.clientY }) }}>
              <SiteGlyph site={site} />
              <span className="home-site__title">{site.title}</span>
              {site.pinned && <Pin className="home-site__pin" size={8} strokeWidth={2.4} aria-hidden="true" />}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="home-site home-site--add" aria-label="사이트 추가" aria-expanded={adding !== null} onClick={event => {
            const shortcuts = event.currentTarget.closest('.home-sites')?.getBoundingClientRect()
            const rect = event.currentTarget.getBoundingClientRect()
            setAdding(value => value ? null : { left: (shortcuts?.left ?? rect.left) + 14, top: rect.bottom + 8 })
          }}>
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </li>
      </ul>
      {adding && createPortal(<AddSitePopover position={adding} existing={new Set(sites.map(site => site.host))} visited={visited} onClose={() => setAdding(null)} onAdd={(url, title) => { add(url, title); setAdding(null) }} />, document.body)}
      {menu && createPortal(<SiteMenu menu={menu} onClose={() => setMenu(null)} onPin={() => togglePin(menu.site)} onRemove={() => remove(menu.site)} />, document.body)}
    </section>
  )
}

function SiteMenu({ menu, onClose, onPin, onRemove }: { menu: { site: HomeSite; x: number; y: number }; onClose: () => void; onPin: () => void; onRemove: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismissableMenu(true, ref, onClose)
  useViewportBounds(ref)
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [])
  const run = (action: () => void) => (): void => { onClose(); action() }
  return (
    <div ref={ref} className="context-menu home-sites__menu" role="menu" aria-label={menu.site.title} style={{ left: menu.x, top: menu.y }}>
      <button type="button" role="menuitem" onClick={run(onPin)}>{menu.site.pinned ? '고정 해제' : '고정'}</button>
      <button type="button" role="menuitem" onClick={run(onRemove)}>삭제</button>
      {menu.site.source === 'school' && <>
        <span className="context-menu__separator" role="separator" />
        <button type="button" role="menuitem" onClick={run(() => useUiStore.getState().openSettings('university'))}>학교 설정</button>
      </>}
    </div>
  )
}

function AddSitePopover({ position, existing, visited, onClose, onAdd }: { position: { left: number; top: number }; existing: Set<string>; visited: ReturnType<typeof foldVisits>; onClose: () => void; onAdd: (url: string, title: string) => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useViewportBounds(ref)
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  useDismissableMenu(true, ref, onClose)
  useEffect(() => { ref.current?.querySelector('input')?.focus() }, [])
  const url = normalizeSiteUrl(address)
  const suggestions = [
    ...AI_WEB_SHORTCUTS.map(shortcut => ({ title: shortcut.label, url: shortcut.url, host: homeSiteHost(shortcut.url) ?? '' })),
    ...visited.map(site => ({ title: site.title || site.host, url: `https://${site.host}/`, host: site.host }))
  ].filter((site, index, all) => site.host && !existing.has(site.host) && all.findIndex(other => other.host === site.host) === index).slice(0, 8)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (url) onAdd(url, name.trim() || (homeSiteHost(url) ?? ''))
  }
  return (
    <div ref={ref} className="home-sites__add glass-popover" role="dialog" aria-label="사이트 추가" style={position}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <form onSubmit={submit}>
        <label className="home-sites__field"><span>주소</span><input value={address} onChange={event => setAddress(event.target.value)} placeholder="example.com" inputMode="url" spellCheck={false} /></label>
        <label className="home-sites__field"><span>이름</span><input value={name} onChange={event => setName(event.target.value)} placeholder="선택" /></label>
        <button type="submit" className="home-sites__submit" disabled={!url}>추가</button>
      </form>
      {suggestions.length > 0 && <>
        <p className="home-sites__suggest-title">추천</p>
        <ul className="home-sites__suggestions">
          {suggestions.map(site => (
            <li key={site.host}>
              <button type="button" onClick={() => onAdd(site.url, site.title)}>
                <SiteGlyph site={site} /><span>{site.title}</span><Plus size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </>}
    </div>
  )
}

