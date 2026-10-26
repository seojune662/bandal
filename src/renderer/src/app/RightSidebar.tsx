import { workspaceKey } from '../../../shared/types/workspace'
import { useWorkspaceStore } from '../stores/workspaceStore'
import type { Course } from '../../../shared/types/course'
import { useUiStore } from '../stores/uiStore'
import { MaterialsSidebar } from '../features/materials/MaterialsSidebar'
import { WorkspaceAssistantPanel } from '../features/assistantPanel/WorkspaceAssistantPanel'
import { Icon } from './icons'
import { Tooltip } from '../components/Tooltip'

export function RightSidebar({ course }: { course: Course | null }): JSX.Element {
  const workspace = useWorkspaceStore(state => state.activeWorkspace)
  const tab = useUiStore(state => state.rightRailTab)
  return <div className="right-sidebar">
    <div className="right-sidebar__tabs" role="tablist" aria-label="오른쪽 사이드바">
      {(['materials', 'ai'] as const).map(value => <Tooltip key={value} label={value === 'materials' ? '자료' : 'AI'}><button type="button" role="tab" aria-label={value === 'materials' ? '자료' : 'AI'} aria-selected={tab === value} aria-controls={`right-panel-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => useUiStore.getState().setRightRailTab(value)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
        event.preventDefault(); useUiStore.getState().setRightRailTab(value === 'materials' ? 'ai' : 'materials')
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.right-sidebar__tabs [aria-selected="true"]')?.focus())
      }}>{value === 'materials' ? <Icon name="folder" /> : <span aria-hidden="true">✦</span>}</button></Tooltip>)}
    </div>
    <section id="right-panel-materials" role="tabpanel" aria-label="자료" hidden={tab !== 'materials'}><MaterialsSidebar key={workspace ? workspaceKey(workspace) : 'empty'} course={course} /></section>
    <section id="right-panel-ai" role="tabpanel" aria-label="AI" hidden={tab !== 'ai'}><WorkspaceAssistantPanel /></section>
  </div>
}
