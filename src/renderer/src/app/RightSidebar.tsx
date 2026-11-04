import { useLayoutEffect, useRef } from 'react'
import { workspaceKey } from '../../../shared/types/workspace'
import { useWorkspaceStore } from '../stores/workspaceStore'
import type { Course } from '../../../shared/types/course'
import { useUiStore } from '../stores/uiStore'
import { MaterialsSidebar } from '../features/materials/MaterialsSidebar'
import { useFocusTrap } from '../components/useFocusTrap'
import '../features/materials/materialsExpanded.css'

export function RightSidebar({ course }: { course: Course | null }): JSX.Element {
  const workspace = useWorkspaceStore(state => state.activeWorkspace)
  const expanded = useUiStore(state => state.materialsExpanded)
  const restoreFocus = useUiStore(state => state.materialsExpandedRestoreFocus)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  useLayoutEffect(() => { searchRef.current = sidebarRef.current?.querySelector<HTMLInputElement>('#material-search') ?? null }, [expanded, workspace])
  useFocusTrap(sidebarRef, {
    active: expanded,
    initialFocus: searchRef,
    returnFocus: restoreFocus,
    onEscape: () => {
      // Context menus own their first Escape; nested dialogs use their own trap.
      if (sidebarRef.current?.querySelector('[role="menu"]')) return
      useUiStore.getState().closeMaterialsExpanded()
    }
  })
  return <div ref={sidebarRef} className="right-sidebar" data-expanded={expanded || undefined}
    role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? '자료 넓게 보기' : undefined}>
    <MaterialsSidebar key={workspace ? workspaceKey(workspace) : 'empty'} course={course} expanded={expanded} onToggleExpanded={() => useUiStore.getState().setMaterialsExpanded(!expanded)} />
  </div>
}
