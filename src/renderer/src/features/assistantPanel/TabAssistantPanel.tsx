import './assistant-panel.css'
import { useCallback, useEffect, useMemo, useRef, useState, type FunctionComponent } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { isTabDescriptor, tabTitle } from '../workspace/tabIdentity'
import { useWorkspacePlacement } from '../workspace/placementContext'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { PanelAssistantContext, normalizeAssistantPanel } from './panelContext'
import { registerDocumentContext } from '../agent/documentContext'
import { useBrowserGuests } from '../browser/browserGuestsStore'
import { activeAssistantWorkspace, openWorkspaceAssistant } from './assistantController'
import type { WorkspaceRef } from '../../../../shared/types/workspace'

/** Document context and highlights survive removal of the per-document AI surface. */
export function withAssistantPanel(Component: FunctionComponent<IDockviewPanelProps>): FunctionComponent<IDockviewPanelProps> {
  return function DocumentContext(props) {
    const descriptor = isTabDescriptor(props.params.descriptor) ? props.params.descriptor : null
    const placement = useWorkspacePlacement()
    const [state, setState] = useState(() => normalizeAssistantPanel(props.params.assistant))
    const root = useRef<HTMLDivElement>(null), selection = useRef('')
    const courseId = descriptor && 'courseId' in descriptor.payload ? descriptor.payload.courseId : placement?.courseId ?? state.courseId ?? null
    const workspace = useCallback((): WorkspaceRef | null => {
      if (placement?.workspace) return placement.workspace
      const active = activeAssistantWorkspace()
      if (active?.courseId === courseId || useWorkspaceStore.getState().activePanelSource()?.panelId === props.api.id) return active
      return courseId ? { kind: 'course', courseId } : active
    }, [courseId, placement?.workspace, props.api.id])
    useEffect(() => {
      if (!descriptor || !courseId || descriptor.kind === 'chat') return
      return registerDocumentContext(props.api.id, () => {
        const nav = descriptor.kind === 'browser' ? useBrowserGuests.getState().nav[descriptor.payload.tabId] : null
        return { courseId, documentId: props.api.id, kind: descriptor.kind, title: nav?.title || props.api.title || tabTitle(descriptor),
          ...('relPath' in descriptor.payload ? { relPath: descriptor.payload.relPath } : {}),
          ...(descriptor.kind === 'browser' ? { browserTabId: descriptor.payload.tabId, url: nav?.url || descriptor.payload.initialUrl } : {}),
          ...(selection.current ? { selection: selection.current } : {}) }
      })
    }, [props.api.id, descriptor, courseId])
    useEffect(() => {
      const save = () => { const value = window.getSelection(); if (value?.anchorNode && root.current?.contains(value.anchorNode)) selection.current = value.toString().trim().slice(0, 8000) }
      document.addEventListener('selectionchange', save)
      return () => document.removeEventListener('selectionchange', save)
    }, [])
    const setHighlightsOpen = useCallback((highlightsOpen: boolean) => {
      setState(current => ({ ...current, highlightsOpen }))
      props.api.updateParameters({ assistant: { ...state, open: false, highlightsOpen } })
      useWorkspaceStore.getState().notifyLayoutChanged()
    }, [props.api, state])
    const toggle = useCallback(() => { const ref = workspace(); if (ref) openWorkspaceAssistant(ref) }, [workspace])
    const ask = useCallback((text: string) => { const ref = workspace(); if (ref) openWorkspaceAssistant(ref, { text }) }, [workspace])
    const context = useMemo(() => ({ panelId: props.api.id, open: false, toggle, highlightsOpen: state.highlightsOpen, setHighlightsOpen, ask }), [props.api.id, toggle, state.highlightsOpen, setHighlightsOpen, ask])
    return <PanelAssistantContext.Provider value={context}><div className="tab-with-assistant" data-tour-panel={props.api.id} ref={root}><div className="tab-document"><div className="tab-document-content"><Component {...props} /></div></div></div></PanelAssistantContext.Provider>
  }
}
