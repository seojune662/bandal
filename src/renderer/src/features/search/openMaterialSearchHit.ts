import type { SearchHit } from '../../../../shared/types/search'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { showToast } from '../../app/toast'
import { openMaterialInCourse } from '../workspace/openMaterial'
import { captureActiveWorkspaceTarget } from '../workspace/captureWorkspaceTarget'
import { requestPdfPageNavigation } from '../pdf/pdfPageNavigation'

let navigation = 0
const searchKey = (text: string): string => text.normalize('NFC').toLocaleLowerCase()
/** Navigate only the window and pane opened by this search, never another visible PDF. */
export async function openMaterialSearchHit(courseId: string, hit: SearchHit, query: string, newInstance = false): Promise<void> {
  const request = ++navigation
  const windowKey = useWorkspaceStore.getState().activeWindowKey
  const target = captureActiveWorkspaceTarget()
  const kind = hit.kind === 'pdf' ? 'pdf' : hit.kind === 'note' ? 'note' : 'other'
  const current = (): boolean => request === navigation && useWorkspaceStore.getState().activeWindowKey === windowKey
  const panelId = await new Promise<string | null>(resolve => {
    const timeout = setTimeout(() => resolve(null), 8000)
    try {
      openMaterialInCourse(courseId, kind, hit.relPath, { ...(target ? { target } : {}), newInstance,
        onOpened: id => { clearTimeout(timeout); resolve(id) }
      })
    } catch (error) {
      clearTimeout(timeout)
      if (current()) showToast(error instanceof Error ? error.message : '자료를 열지 못했어요.', 'danger')
      resolve(null)
    }
  })
  if (!current() || !panelId) return
  if (hit.kind === 'pdf' && hit.page) { requestPdfPageNavigation({ courseId, relPath: hit.relPath, page: hit.page, panelId }); return }
  if (hit.kind !== 'note') return
  const started = performance.now()
  const stillSelected = (): boolean => current() && useWorkspaceStore.getState().activePanelId === panelId
  while (stillSelected() && performance.now() - started < 10000) {
    const panel = [...document.querySelectorAll<HTMLElement>('.workspace-panel-content:not([hidden])')].find(element => element.dataset.contentPanel === panelId)
    const content = panel?.querySelector('.ProseMirror,.markdown-view,.learning-reader,.note-quiz-preview,.page-note-list')
    if (content) {
      const match = [...content.querySelectorAll<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td')].find(element => searchKey(element.textContent ?? '').includes(searchKey(query.trim())))
      if (match) { match.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
      if (!panel?.querySelector('[aria-busy="true"]')) break
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (stillSelected()) showToast('내용이 바뀌어 일치 위치를 찾지 못했어요.')
}
