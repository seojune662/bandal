import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FunctionComponent } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { isTabDescriptor, tabTitle, descriptorFor } from '../workspace/tabIdentity'
import { useCoursesStore } from '../../stores/coursesStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { usePanelActive } from '../workspace/usePanelActive'
import { PanelAssistantContext, normalizeAssistantPanel, type AssistantPanelState } from './panelContext'
import { updateComposerDraft } from '../chat/composerDraftStore'
import { invoke } from '../../lib/ipc'
import { showToast } from '../../app/toast'
import { Icon } from '../../app/icons'
import { registerDocumentContext } from '../agent/documentContext'
import { useBrowserGuests } from '../browser/browserGuestsStore'
import './assistant-panel.css'
const ChatSurface = lazy(() => import('../chat/ChatSurface').then(m => ({ default: m.ChatSurface })))
export function withAssistantPanel(Component: FunctionComponent<IDockviewPanelProps>): FunctionComponent<IDockviewPanelProps> {
  return function AssistantPanel(props) {
    const descriptor = isTabDescriptor(props.params.descriptor) ? props.params.descriptor : null
    const selectedCourseId = useCoursesStore(s => s.selectedCourseId)
    const active = usePanelActive(props.api)
    const [state, setState] = useState(() => {
      const saved = normalizeAssistantPanel(props.params.assistant)
      return descriptor?.kind === 'pdf' ? saved : { ...saved, section: 'ai' as const }
    })
    const [ownerCourseId] = useState(() => state.courseId ?? selectedCourseId)
    const courseId = descriptor && 'courseId' in descriptor.payload ? descriptor.payload.courseId : ownerCourseId
    const [initialized, setInitialized] = useState(state.open)
    const resizeCleanup = useRef<(() => void) | null>(null)
    const stateRef = useRef(state); stateRef.current = state
    const mounted = useRef(true)
    const root = useRef<HTMLDivElement>(null)
    const [availableWidth, setAvailableWidth] = useState(1000)
    const [highlightHost, setHighlightHost] = useState<HTMLDivElement | null>(null)
    const [busy, setBusy] = useState(false)
    const selection = useRef('')
    const update = useCallback((patch: Partial<AssistantPanelState>) => {
      const next = { ...stateRef.current, ...(courseId ? { courseId } : {}), ...patch }
      stateRef.current = next; setState(next)
      props.api.updateParameters({ assistant: next })
      useWorkspaceStore.getState().notifyLayoutChanged()
    }, [props.api, courseId])
    useEffect(() => {
      mounted.current = true
      return () => { mounted.current = false; resizeCleanup.current?.() }
    }, [])
    useEffect(() => {
      if (!root.current) return
      const observer = new ResizeObserver(([entry]) => { if (entry) setAvailableWidth(entry.contentRect.width) })
      observer.observe(root.current)
      return () => observer.disconnect()
    }, [])
    useEffect(() => {
      if (!descriptor || !courseId || descriptor.kind === 'chat') return
      return registerDocumentContext(props.api.id, () => {
        const nav = descriptor.kind === 'browser' ? useBrowserGuests.getState().nav[descriptor.payload.tabId] : null
        return { courseId, documentId: props.api.id, kind: descriptor.kind, title: nav?.title || tabTitle(descriptor),
          ...('relPath' in descriptor.payload ? { relPath: descriptor.payload.relPath } : {}),
          ...(descriptor.kind === 'browser' ? { browserTabId: descriptor.payload.tabId, url: nav?.url || descriptor.payload.initialUrl } : {}),
          ...(selection.current ? { selection: selection.current } : {}) }
      })
    }, [props.api.id, descriptor, courseId])
    useEffect(() => {
      const saveSelection = () => {
        const selected = window.getSelection()
        if (selected?.anchorNode && root.current?.querySelector('.tab-document')?.contains(selected.anchorNode)) selection.current = selected.toString().trim().slice(0, 8000)
      }
      document.addEventListener('selectionchange', saveSelection)
      return () => document.removeEventListener('selectionchange', saveSelection)
    }, [])
    const show = useCallback((section: 'ai' | 'highlights' = 'ai') => { setInitialized(true); update({ open: true, section }) }, [update])
    const close = useCallback(() => update({ open: false }), [update])
    const ask = useCallback((text: string) => {
      updateComposerDraft(stateRef.current.conversationId, draft => ({ text: draft.text ? `${draft.text}\n\n${text}` : text }))
      show('ai')
    }, [show])
    const context = useMemo(() => ({ panelId: props.api.id, highlightHost, section: state.section, open: state.open, show, close, ask }), [props.api.id, highlightHost, state.section, state.open, show, close, ask])
    const [action, setAction] = useState('current')
    const quickAction = async (action: string) => {
      const id = stateRef.current.conversationId
      setBusy(true)
      try {
        if (action === 'region' || action === 'screen') {
          const image = await invoke('assistant:capture', { region: action === 'region' })
          if (image && !mounted.current) showToast('원본 탭이 닫혀 캡처를 대화에 추가하지 않았어요.')
          if (image && mounted.current) updateComposerDraft(id, draft => ({ images: [...draft.images, image].slice(-5) }))
        } else if (action === 'file') {
          const { paths } = await invoke('chat:pickAttachments', {})
          if (!mounted.current && paths.length) showToast('원본 탭이 닫혀 파일을 대화에 추가하지 않았어요.')
          if (mounted.current) updateComposerDraft(id, draft => ({ files: [...draft.files, ...paths.map(path => ({ path, name: path.split(/[\\/]/).pop() || path }))].slice(0, 20) }))
        } else if (courseId) {
          const snapshot = await invoke('chat:context', { courseId, sourcePanelId: props.api.id })
          if (snapshot.refresh === 'failed') throw new Error('원본 자료를 읽지 못했어요. 자료 탭을 확인해 주세요.')
          const selected = snapshot.material?.selection || selection.current
          if (mounted.current) updateComposerDraft(id, draft => ({ excludeCurrentMaterial: false, ...(selected ? { quotes: [...(draft.quotes ?? []), { text: selected, source: snapshot.material?.title ?? '현재 자료' }].slice(-5) } : {}) }))
        }
      } catch (error) { showToast(error instanceof Error ? error.message : '질문 자료를 준비하지 못했어요.', 'danger') }
      finally { if (mounted.current) setBusy(false) }
    }
    if (descriptor?.kind === 'chat') return <Component {...props} />
    const overlay = availableWidth < state.width + 360
    return <PanelAssistantContext.Provider value={context}>
      <div className="tab-with-assistant" ref={root} data-assistant-open={state.open} data-assistant-overlay={overlay}>
        <div className="tab-document">
          <div className="tab-assistant-launchbar"><span>{descriptor ? tabTitle(descriptor) : '현재 자료'}</span><button type="button" className="tab-assistant-toggle" data-tour="assistant-panel-toggle" aria-expanded={state.open} aria-label={state.open ? 'AI 보조 사이드바 접기' : 'AI 보조 사이드바 펼치기'} onClick={() => state.open ? close() : show()}>✦ <span>AI</span></button></div>
          <div className="tab-document-content"><Component {...props} /></div>
        </div>
        {initialized && <aside hidden={!state.open} className="tab-assistant" role={overlay ? 'dialog' : 'complementary'} aria-label="탭 보조 사이드바" style={{ width: Math.min(state.width, availableWidth) }}>
          {!overlay && <div className="tab-assistant-resize" role="separator" aria-label="AI 사이드바 너비" aria-orientation="vertical" tabIndex={0}
            onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); update({ width: Math.max(280, Math.min(480, state.width + (e.key === 'ArrowLeft' ? 16 : -16))) }) } }}
            onPointerDown={e => {
              e.preventDefault()
              resizeCleanup.current?.()
              e.currentTarget.setPointerCapture(e.pointerId)
              const origin = e.clientX, width = state.width
              const move = (event: PointerEvent) => update({ width: Math.max(280, Math.min(480, width + origin - event.clientX)) })
              const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
              resizeCleanup.current = end
              window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true }); window.addEventListener('pointercancel', end, { once: true })
            }} />}
          <header className="tab-assistant-header">
            <div role="tablist" aria-label="보조 사이드바 보기">
              <button role="tab" aria-selected={state.section === 'ai'} onClick={() => show()}>✦ AI</button>
              {descriptor?.kind === 'pdf' && <button role="tab" aria-selected={state.section === 'highlights'} onClick={() => show('highlights')}>하이라이트</button>}
            </div>
            <button className="bare-icon-button" aria-label="AI 보조 사이드바 접기" onClick={close}><Icon name="x" /></button>
          </header>
          <div ref={setHighlightHost} className="tab-assistant-highlights" hidden={state.section !== 'highlights'} />
          <div className="tab-assistant-ai" role="tabpanel" hidden={state.section !== 'ai'}>
            <div className="tab-assistant-actions">
              <select aria-label="AI 질문 방식" value={action} disabled={busy} onChange={e => setAction(e.target.value)}>
                <option value="current">현재 자료 · 선택한 내용</option><option value="region">영역 선택해서 질문</option><option value="screen">현재 화면 질문</option><option value="file">파일 첨부해서 질문</option>
              </select>
              <button disabled={busy} onClick={() => void quickAction(action)} aria-label="질문 자료 준비">{busy ? '…' : '담기'}</button>
              <button aria-label="AI 대화 크게 열기" disabled={!courseId} onClick={() => {
                if (!courseId) return
                update({ open: false })
                useWorkspaceStore.getState().openTab(descriptorFor('chat', { courseId, conversationId: state.conversationId, sourcePanelId: props.api.id }))
              }}>↗</button>
            </div>
            {courseId ? <Suspense fallback={<p role="status">AI를 준비하는 중…</p>}><ChatSurface courseId={courseId} conversationId={state.conversationId} sourcePanelId={props.api.id} variant="sidebar" active={active && state.open && state.section === 'ai'} onOpenConversation={conversationId => update({ conversationId })} /></Suspense> : <p className="tab-assistant-empty">과목을 선택하면 AI와 대화할 수 있어요.</p>}
          </div>
        </aside>}
      </div>
    </PanelAssistantContext.Provider>
  }
}
