/** The same five creation actions on desktop and iPad; saved tab kinds stay compatible. */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { formatChord, parseChord, resolveKeymap, type ShortcutActionId } from '../../../../shared/keymap'
import type { Course } from '../../../../shared/types/course'
import { Icon } from '../../app/icons'
import { createBrowserTab, createMarkdownTab, createStudyTab } from '../../app/tabCommands'
import { ensureSettingsLoaded, settingsSnapshot } from '../../stores/settingsSnapshot'
import { NEW_TAB_CYCLE_ACTIONS, useNewTabMenu } from './newTabMenuController'
import { looksLikeUrl, normalizeUrl } from './tabIdentity'
import { TabKindIcon } from './workspaceIcons'
import { onPush } from '../../lib/ipc'
import { useViewportBounds } from '../../lib/useViewportBounds'

export function shortcutLabel(keymap: ReadonlyMap<string, ShortcutActionId>, action: ShortcutActionId, platform: string): string | undefined {
  for (const [value, mapped] of keymap) if (mapped === action) {
    const chord = parseChord(value)
    return chord === null ? undefined : formatChord(chord, platform)
  }
  return undefined
}

export function NewTabMenu({ course }: { course: Course }): JSX.Element {
  const cycleIndex = useNewTabMenu(state => state.cycleIndex)
  const cycling = cycleIndex !== null
  const modifierLabel = window.bandal?.platform === 'darwin' ? '⌘' : 'Ctrl'
  const anchor = useNewTabMenu(state => state.anchor)
  const close = useNewTabMenu(state => state.close)
  const target = anchor?.target
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const listId = useId()
  const [keymap, setKeymap] = useState(() => resolveKeymap(settingsSnapshot().keybindings))
  const menuRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null)
  useViewportBounds(menuRef)
  useEffect(() => {
    if (cycling) menuRef.current?.focus()
    else inputRef.current?.focus()
  }, [cycling])
  useEffect(() => {
    let active = true
    void ensureSettingsLoaded().then(settings => { if (active) setKeymap(resolveKeymap(settings.keybindings)) }).catch(() => undefined)
    const off = onPush('settings:changed', ({ settings }) => setKeymap(resolveKeymap(settings.keybindings)))
    return () => { active = false; off() }
  }, [])
  useEffect(() => {
    const outside = (event: MouseEvent): void => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) close() }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [close])
  const items = useMemo(() => {
    const text = cycling ? '' : query.trim(), url = looksLikeUrl(text) ? normalizeUrl(text) : undefined
    const actions = [
      { id: 'new-whiteboard', label: '노트', search: '노트 필기 종이 화이트보드 note', hint: '빈 종이 · 줄 · 모눈 · 점', icon: 'whiteboard' as const, action: 'new-whiteboard' as const, run: () => createStudyTab('whiteboard', target) },
      { id: 'new-browser', label: '브라우저', search: '브라우저 웹 browser', hint: url, icon: 'browser' as const, action: 'new-browser-tab' as const, run: () => createBrowserTab(url, target) },
      { id: 'new-note', label: '마크다운', search: '마크다운 문서 markdown', hint: undefined, icon: 'note' as const, action: 'new-markdown' as const, run: () => createMarkdownTab(undefined, target) },
      { id: 'chat', label: 'AI', search: 'ai 대화 튜터', hint: course.name, icon: 'chat' as const, action: 'new-ai-tab' as const, run: () => createStudyTab('chat', target) },
      { id: 'recording', label: '녹음', search: '녹음 강의 실시간 자막 stt recording', hint: '강의 · 실시간 자막', icon: 'recording' as const, action: 'new-recording-tab' as const, run: () => createStudyTab('recording', target) }
    ]
    return NEW_TAB_CYCLE_ACTIONS.map(action => actions.find(item => item.action === action)!).filter(item => url ? item.id === 'new-browser' : !text || item.search.includes(text.toLowerCase()))
  }, [query, target, course.name, cycling])
  const selected = Math.max(0, Math.min(cycleIndex ?? highlighted, items.length - 1))
  const activate = (item: typeof items[number] | undefined): void => {
    if (!item) return
    close()
    void item.run()
  }
  const style = anchor ? { left: `clamp(var(--space-2), ${anchor.x}px, calc(100vw - var(--new-tab-menu-width) - var(--space-2)))`, top: anchor.y } : undefined
  return <div ref={menuRef} className="new-tab-menu" data-centered={anchor === null} style={style} role="dialog" aria-label="새 탭 열기" tabIndex={-1}>
    {cycling ? <div className="new-tab-menu__cycle-hint">{modifierLabel}를 누른 채 T로 선택 · {modifierLabel}를 놓아 열기</div> : <div className="new-tab-menu__search"><Icon name="search" /><input ref={inputRef} type="text" placeholder="검색하거나 URL 입력…" aria-label="새 탭 검색" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={items.length ? `${listId}-${selected}` : undefined} value={query}
      onChange={event => { setQuery(event.target.value); setHighlighted(0) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close() }
        else if (event.key === 'ArrowDown') { event.preventDefault(); setHighlighted(index => Math.min(index + 1, items.length - 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlighted(index => Math.max(index - 1, 0)) }
        else if (event.key === 'Enter') { event.preventDefault(); activate(items[selected]) }
      }} /></div>}
    <ul id={listId} className="new-tab-menu__list" role="listbox" aria-label="새 탭 항목">
      {!items.length && <li className="new-tab-menu__empty">일치하는 항목이 없어요</li>}
      {items.map((item, index) => <li key={item.id} role="presentation"><button id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={index === selected} data-highlighted={index === selected} onMouseEnter={() => { if (!cycling) setHighlighted(index) }} onClick={() => activate(item)}>
        <span className="new-tab-menu__icon"><TabKindIcon kind={item.icon} /></span><span className="new-tab-menu__label">{item.label}</span>
        {item.hint && <span className="new-tab-menu__hint">{item.hint}</span>}
        <span className="new-tab-menu__shortcut" aria-hidden="true">{shortcutLabel(keymap, item.action, window.bandal?.platform ?? 'unknown')}</span>
      </button></li>)}
    </ul>
  </div>
}
