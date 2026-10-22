import { useUiStore } from '../../stores/uiStore'

export function HomeTabs(): JSX.Element {
  const selected = useUiStore(state => state.leftRailPanel)
  return <div className="home-tabs" role="tablist" aria-label="홈 목록">
    {([['courses', '과목'], ['learning', '프로젝트']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={selected === id} aria-controls={id === 'courses' ? 'courses-list-panel' : 'learning-spaces-panel'} tabIndex={selected === id ? 0 : -1} onClick={() => useUiStore.getState().setHomeTab(id)} onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      useUiStore.getState().setHomeTab(id === 'courses' ? 'learning' : 'courses')
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.app-rail:not([hidden]) .home-tabs [aria-selected="true"]')?.focus())
    }}>{label}</button>)}
  </div>
}
