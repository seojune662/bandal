import { ProjectAssistantRuns } from './ProjectAssistantRuns'
import { AssistantToolsMenu } from './AssistantToolsMenu'
import { useChatSessionStore } from '../chat/chatSessionStore'
import { useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useUiStore } from '../../stores/uiStore'
import { useCoursesStore } from '../../stores/coursesStore'
import { workspaceKey } from '../../../../shared/types/workspace'
import { ChatSurface } from '../chat/ChatSurface'
import { ConversationListMenu } from '../chat/ConversationListMenu'
import { ASSISTANT_MODES } from '../chat/studyMode'
import { useWorkspaceAssistantStore } from './workspaceAssistantStore'
import type { LearningBinding } from '../../../../shared/types/learning'
import { useLearningProject } from '../learning/useLearningProject'
import { learningDisplayName } from '../learning/learningPresentation'
import './workspace-assistant.css'

function ProjectWorkspaceLabel({ binding, fallback }: { binding: LearningBinding; fallback: string }): JSX.Element {
  const { project } = useLearningProject(binding)
  const courses = useCoursesStore(state => state.courses)
  const name = project ? learningDisplayName(project, courses) : binding.rootRelPath.split('/').at(-1) || fallback
  return <small title={name}>{name}</small>
}

export function WorkspaceAssistantPanel(): JSX.Element {
  const [toolsOpen, setToolsOpen] = useState(false)
  const workspace = useWorkspaceStore(state => state.activeWorkspace)
  const sourcePanelId = useWorkspaceStore(state => state.activePanelId)
  const courses = useCoursesStore(state => state.courses)
  const active = useUiStore(state => state.rightRailOpen && state.rightRailTab === 'ai')
  const spaces = useWorkspaceAssistantStore(state => state.spaces)
  const key = workspace ? workspaceKey(workspace) : ''
  const state = spaces[key]
  const conversationTitle = useChatSessionStore(store => state ? store.sessions[state.conversationId]?.title : null)
  const root = useRef<HTMLElement>(null)
  useEffect(() => { if (workspace) useWorkspaceAssistantStore.getState().select(workspace) }, [key])
  useEffect(() => {
    const focus = () => requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>('.chat-composer__input')?.focus())
    window.addEventListener('bandal:focus-assistant', focus)
    return () => window.removeEventListener('bandal:focus-assistant', focus)
  }, [])
  if (!workspace || !state) return <section className="workspace-assistant workspace-assistant--empty"><h2>어디서 시작할까요?</h2><p>과목이나 프로젝트를 선택하면 자료를 함께 보며 대화할 수 있어요.</p></section>
  const title = courses.find(course => course.id === workspace.courseId)?.name ?? '현재 공간'
  return <section ref={root} className="workspace-assistant" aria-label="공간 AI">
    <header className="workspace-assistant__header"><div className="workspace-assistant__title"><strong>{conversationTitle || '새 대화'}</strong>{workspace.kind === 'project' ? <ProjectWorkspaceLabel binding={workspace} fallback={title} /> : <small title={title}>{title}</small>}</div><div className="workspace-assistant__actions"><button type="button" className="bare-icon-button" aria-label="더 많은 AI 도구" aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}>···</button><button type="button" className="bare-icon-button" aria-label="새 AI 대화" onClick={() => useWorkspaceAssistantStore.getState().select(workspace, crypto.randomUUID())}>+</button><ConversationListMenu courseId={workspace.courseId} workspaceKey={key} currentConversationId={state.conversationId} onNewConversation={() => useWorkspaceAssistantStore.getState().select(workspace, crypto.randomUUID())} onOpenConversation={id => useWorkspaceAssistantStore.getState().select(workspace, id)} /></div></header>
    <div className="workspace-assistant__modes" data-tour="ai-modes" role="tablist" aria-label="AI 모드">{ASSISTANT_MODES.map((mode, index) => <button key={mode.id} type="button" role="tab" aria-selected={state.mode === mode.id} tabIndex={state.mode === mode.id ? 0 : -1} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? ASSISTANT_MODES.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ASSISTANT_MODES.length) % ASSISTANT_MODES.length
      useWorkspaceAssistantStore.getState().setMode(workspace, ASSISTANT_MODES[next]!.id)
      const target = event.currentTarget.parentElement?.children[next] as HTMLElement | undefined
      target?.focus(); target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }} onClick={() => useWorkspaceAssistantStore.getState().setMode(workspace, mode.id)}>{mode.label}</button>)}</div>
    {toolsOpen && <div className="workspace-assistant__tools"><AssistantToolsMenu key={key} /></div>}
    {workspace.kind === 'project' && <ProjectAssistantRuns key={`jobs:${key}`} binding={{ courseId: workspace.courseId, rootRelPath: workspace.rootRelPath }} />}
    <ChatSurface key={`chat:${key}`} sourcePanelId={sourcePanelId ?? ''} courseId={workspace.courseId} conversationId={state.conversationId} workspace={workspace} mode={state.mode} variant="sidebar" hideHeader active={active} onOpenConversation={id => useWorkspaceAssistantStore.getState().select(workspace, id)} />
  </section>
}
