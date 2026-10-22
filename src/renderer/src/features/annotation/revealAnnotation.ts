import type { AnnotationReference } from '../../../../shared/types/chatAnnotation'
import { workspaceFromKey } from '../../../../shared/types/workspace'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { invoke } from '../../lib/ipc'
import { showToast } from '../../app/toast'
import { descriptorFor, tabPanelId } from '../workspace/tabIdentity'
import { requestPdfPageNavigation } from '../pdf/pdfPageNavigation'
import { useAnnotationStore } from './annotationStore'

/** A snapshot survives source changes; reveal never replaces text or navigates an existing page. */
export async function revealAnnotation(reference: AnnotationReference): Promise<void> {
  useAnnotationStore.getState().stop()
  const workspaceKey = reference.workspaceKey ?? reference.courseId
  if (useWorkspaceStore.getState().activeWorkspaceKey !== workspaceKey) useWorkspaceStore.getState().showWorkspace(workspaceFromKey(workspaceKey))
  try {
    await new Promise<void>((resolve, reject) => {
      const ready = (): boolean => useWorkspaceStore.getState().activeWorkspaceKey === workspaceKey && useWorkspaceStore.getState().hydration === 'ready'
      if (ready()) { resolve(); return }
      const timer = setTimeout(() => { stop(); reject(new Error('원본 공간을 열지 못했어요.')) }, 8000)
      const stop = useWorkspaceStore.subscribe(state => {
        if (state.activeWorkspaceKey !== workspaceKey || state.hydration === 'error') { clearTimeout(timer); stop(); reject(new Error('원본 공간을 열지 못했어요.')) }
        else if (ready()) { clearTimeout(timer); stop(); resolve() }
      })
    })
    const state = useWorkspaceStore.getState()
    const existing = state.openTabs[reference.sourcePanelId]
    let panelId = reference.sourcePanelId
    if (existing) state.activatePanel(reference.sourcePanelId)
    else if (reference.relPath) {
      const descriptor = descriptorFor(reference.kind === 'pdf' ? 'pdf' : reference.kind === 'markdown' ? 'note' : 'file', { courseId: reference.courseId, relPath: reference.relPath })
      panelId = tabPanelId(descriptor)
      state.openTab(descriptor)
    }
    else { showToast('원본 탭이 닫혔어요. 첨부된 스냅샷에서 내용을 확인할 수 있어요.'); return }
    if (reference.browserTabId && reference.url) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const result = await invoke('annotation:browserReveal', { tabId: reference.browserTabId, url: reference.url, ...(reference.selector ? { selector: reference.selector } : {}), ...(reference.quote ? { quote: reference.quote } : {}) })
      if (!result.found) showToast('원본 페이지가 바뀌었어요. 첨부된 스냅샷은 그대로 남아 있어요.')
      return
    }
    if (reference.relPath && reference.page) requestPdfPageNavigation({ courseId: reference.courseId, relPath: reference.relPath, page: reference.page, panelId })
    if (reference.kind === 'markdown' && reference.quote) {
      const started = performance.now()
      const findDocument = (): Element | null => [...document.querySelectorAll<HTMLElement>('.workspace-panel-content:not([hidden])')].find(panel => panel.dataset.contentPanel === panelId)?.querySelector('.ProseMirror,.markdown-view,.learning-reader,.learning-article') ?? null
      while (!findDocument() && performance.now() - started < 3000 && useWorkspaceStore.getState().activeWorkspaceKey === workspaceKey) await new Promise(resolve => requestAnimationFrame(resolve))
      const elements = findDocument()?.querySelectorAll<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table') ?? []
      const target = [...elements].find(element => (element.textContent ?? '').trim().slice(0, 8000) === reference.quote?.trim())
      if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      else showToast('원본 글이 바뀌었어요. 첨부한 내용은 그대로 남아 있어요.')
    }
  } catch (error) { showToast(error instanceof Error ? error.message : '원본을 열지 못했어요.', 'danger') }
}
