import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from '../src/renderer/src/app/AppShell'
import { RendererErrorBoundary } from '../src/renderer/src/app/RendererErrorBoundary'
import { setIpcAdapter } from '../src/renderer/src/lib/ipc'
import { useWorkspaceStore } from '../src/renderer/src/stores/workspaceStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { setLocale } from '../src/renderer/src/i18n'
import { THEMES, PALETTES } from '../src/shared/theme'
import { adapter, emit, exportNotes } from './adapter'
import { data, commit, settings, courseId, PDF, NOTE, PAGE_NOTE, pdfDescriptor, pageNoteDescriptor, mode, ko, resetDemo, storageLabel } from './state'
import '../src/renderer/src/styles/tokens.css'
import '../src/renderer/src/styles/base.css'
import './web-demo.css'

// No Electron APIs or local file access are available in this build.
setIpcAdapter(adapter)
window.bandal = { ...adapter, platform: 'web', pathForFile: () => '', startMaterialDrag: () => {}, openSettings: async () => { useUiStore.getState().openSettings() } }
document.documentElement.dataset.platform = 'web'
setLocale(ko ? 'ko-KR' : 'en-US')
if (!window.requestIdleCallback) {
  window.requestIdleCallback = callback => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 15 }), 1)
  window.cancelIdleCallback = window.clearTimeout
}
function appearance(value: { palette?: string; theme?: string }) {
  if (!PALETTES.some(p => p.id === value.palette) || !THEMES.some(t => t.id === value.theme)) return
  settings.palette = value.palette as typeof settings.palette
  settings.theme = value.theme as typeof settings.theme
  document.documentElement.dataset.palette = settings.palette
  document.documentElement.dataset.theme = settings.theme
  emit('settings:changed', { settings })
}
try { appearance(window.parent.document.documentElement.dataset) } catch { /* Standalone uses Bandal Dark. */ }
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'bandal-appearance') return
  appearance(event.data)
})
const compact = mode === 'ai' || mode === 'board' || innerWidth < 900
useUiStore.setState({ leftRailOpen: !compact, rightRailOpen: !compact && innerWidth >= 1100 })

type Experience = 'workspace' | 'linked' | 'board' | 'ai'
function openExperience(view: Experience) {
  commit(next => { next.scene = view })
  const store = useWorkspaceStore.getState()
  useUiStore.getState().closeSettings()
  useUiStore.getState().closeBoardOverlay()
  for (const panel of Object.keys(store.openTabs)) store.closeTab(panel)
  if (view === 'ai') store.openTab({ kind: 'chat', payload: { courseId, conversationId: 'demo-chat' } })
  else if (view === 'board') store.openTab({ kind: 'board', payload: {} })
  else if (view === 'linked' && innerWidth >= 700) store.openPdfNotePair(pdfDescriptor, pageNoteDescriptor, 'demo-pdf-note-link', 1)
  else {
    store.openTab({ kind: 'pdf', payload: { courseId, relPath: PDF } })
    store.openTab({ kind: 'note', payload: { courseId, relPath: view === 'linked' ? PAGE_NOTE : data.primaryNotePath ?? NOTE } }, { beside: innerWidth >= 700, background: innerWidth < 700 })
  }
}

function Demo(): React.JSX.Element {
  const [ready, setReady] = useState(false)
  const [current, setCurrent] = useState<Experience>(['linked', 'ai', 'board'].includes(data.scene ?? mode) ? (data.scene ?? mode) as Experience : 'workspace')
  const [notice, setNotice] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const resetDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (confirmReset) resetDialog.current?.showModal()
    else resetDialog.current?.close()
  }, [confirmReset])
  useEffect(() => {
    let initialized = false
    const unsubscribe = useWorkspaceStore.subscribe(state => {
      if (initialized || state.hydration !== 'ready' || state.activeCourseId !== courseId) return
      initialized = true
      queueMicrotask(() => {
        if (!Object.keys(useWorkspaceStore.getState().openTabs).length) openExperience(current)
        setReady(true)
        window.parent.postMessage({ type: 'bandal-demo-ready' }, location.origin)
      })
    })
    const unavailable = () => setNotice(ko ? '이 기능은 설치한 앱에서 사용할 수 있어요. PDF·필기·보드·달력은 여기서 직접 사용해보세요.' : 'This feature needs the desktop app. Try PDFs, notes, board and calendar here.')
    window.addEventListener('bandal-demo-unavailable', unavailable)
    return () => { unsubscribe(); window.removeEventListener('bandal-demo-unavailable', unavailable) }
  }, [])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer) }, [notice])
  return <div className="web-demo" data-view={mode}>
    <div className="demo-toolbar" aria-label={ko ? '웹 체험 도구' : 'Demo tools'}>
      <div className="demo-scenes">{([['workspace', ko ? 'PDF와 필기' : 'PDF & notes'], ['linked', ko ? '페이지 연결' : 'Linked notes'], ['board', ko ? '보드·달력' : 'Board & calendar'], ['ai', ko ? 'AI 예시' : 'AI example']] as const).map(([value, label]) => <button key={value} disabled={!ready} aria-pressed={current === value} onClick={() => { try { openExperience(value); setCurrent(value) } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) } }}>{label}</button>)}</div>
      <div className="demo-utilities"><button onClick={exportNotes} title={ko ? '체험 중 쓴 필기를 .md 파일로 저장' : 'Download your notes as Markdown'}>{ko ? '필기 내보내기' : 'Export notes'} ↓</button><button onClick={() => setConfirmReset(true)} aria-label={ko ? '체험 초기화' : 'Reset demo'}>↺</button></div>
    </div>
    {(current === 'ai' || mode === 'ai') && <p className="demo-disclosure">{ko ? '실제 앱의 AI 화면입니다. 웹에서는 미리 준비한 예시 답변을 보여주며, AI 요청·도구 실행·계정 연결은 하지 않습니다.' : 'The actual app chat UI, with scripted example replies. No AI requests, tool execution or account connection.'}</p>}
    <div className="demo-app"><RendererErrorBoundary><AppShell /></RendererErrorBoundary></div>
    <div className="demo-status"><span><i />{storageLabel()}</span><span>{ko ? '실제 앱 UI · 예제 자료' : 'Actual app UI · Sample material'}</span></div>
    {notice && <div className="demo-notice" role="status">{notice}<button aria-label={ko ? '알림 닫기' : 'Dismiss'} onClick={() => setNotice('')}>×</button></div>}
    <dialog ref={resetDialog} className="demo-reset" aria-labelledby="reset-title" onCancel={() => setConfirmReset(false)}><h2 id="reset-title">{ko ? '체험을 처음부터 다시 할까요?' : 'Start over?'}</h2><p>{ko ? '이 체험에서 작성한 필기와 과제가 지워집니다. 필요한 필기는 먼저 내보내세요.' : 'This clears notes and tasks in this demo. Export anything you want to keep first.'}</p><button onClick={exportNotes}>{ko ? '필기 내보내기' : 'Export notes'}</button><button autoFocus onClick={() => setConfirmReset(false)}>{ko ? '취소' : 'Cancel'}</button><button onClick={resetDemo}>{ko ? '초기화' : 'Reset'}</button></dialog>
  </div>
}
createRoot(document.getElementById('root')!).render(<Demo />)
