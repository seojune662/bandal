import { useRef, useState } from 'react'
import type { ShareTabTarget } from '../../../shared/ipc/contract'
import type { TabDescriptor } from '../../../shared/tabs'
import { Tooltip } from '../components/Tooltip'
import { flushDocumentSaves } from '../features/documents/saveRegistry'
import { guestActions } from '../features/browser/guestActions'
import { useBrowserGuests } from '../features/browser/browserGuestsStore'
import { flushOpenNoteSession } from '../features/notes/noteSessionRegistry'
import { invoke } from '../lib/ipc'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { showToast } from './toast'

/** A target, or why there is nothing to share right now (shown as is). */
type Shareable = { label: string; target: () => Promise<ShareTabTarget | string> }

const FILE_LABELS = { pdf: 'PDF 공유', note: '마크다운 공유', image: '이미지 공유', file: '파일 공유' } as const

function browserUrl(tabId: string): string | null {
  const url = guestActions.currentUrl(tabId) ?? useBrowserGuests.getState().nav[tabId]?.url ?? null
  return url !== null && /^https?:\/\//iu.test(url) ? url : null
}

/** What the open tab shares: its file (a PDF with its markup, a note saved first) or its page link. */
export function shareableFor(descriptor: TabDescriptor | null): Shareable | null {
  switch (descriptor?.kind) {
    case 'browser': {
      const { tabId } = descriptor.payload
      return { label: '링크 공유', target: async () => { const url = browserUrl(tabId); return url === null ? '공유할 웹 주소가 아직 없어요.' : { kind: 'url', url } } }
    }
    case 'pdf': {
      const ref = { courseId: descriptor.payload.courseId, relPath: descriptor.payload.relPath }
      return { label: FILE_LABELS.pdf, target: async () => { await flushDocumentSaves(ref); return { kind: 'file', ...ref, annotatedPdf: true } } }
    }
    case 'note': {
      const ref = { courseId: descriptor.payload.courseId, relPath: descriptor.payload.relPath }
      return {
        label: FILE_LABELS.note,
        target: async () => {
          const flushed = await flushOpenNoteSession(ref)
          if (flushed !== null && flushed.result.status !== 'saved') return '노트를 저장하지 못했어요. 저장 상태를 확인한 뒤 다시 공유해 주세요.'
          return { kind: 'file', ...(flushed?.ref ?? ref) }
        }
      }
    }
    case 'image':
    case 'file': {
      const ref = { courseId: descriptor.payload.courseId, relPath: descriptor.payload.relPath }
      return { label: FILE_LABELS[descriptor.kind], target: async () => ({ kind: 'file', ...ref }) }
    }
    default:
      return null
  }
}

function ShareIcon(): JSX.Element {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 14V3.5m-4 4 4-4 4 4M7.5 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5" /></svg>
}

/** First of the corner controls: shares the open tab straight from the window chrome. */
export function ShareTabButton(): JSX.Element {
  // Subscribed so the label follows the open tab; the descriptor itself lives on the dockview panel.
  useWorkspaceStore(state => `${state.surface}:${state.windowsOverviewOpen}:${state.activePanelId}`)
  const shareable = shareableFor(useWorkspaceStore.getState().activeTabDescriptor())
  const [busy, setBusy] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const label = shareable?.label ?? '이 탭은 공유할 수 없어요'

  const share = async (): Promise<void> => {
    if (shareable === null || busy) return
    setBusy(true)
    try {
      const target = await shareable.target()
      if (typeof target === 'string') { showToast(target, 'danger'); return }
      const rect = button.current?.getBoundingClientRect()
      const { outcome } = await invoke('shell:shareTab', { target, anchor: { x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 6 } })
      if (outcome === 'copied') showToast('링크를 복사했어요.')
      else if (outcome === 'revealed') showToast('파일 위치를 열었어요. 거기서 보내면 돼요.')
    } catch (error) {
      console.error('[Bandal] 탭을 공유하지 못했습니다.', error)
      showToast('공유하지 못했어요. 잠시 뒤 다시 시도해 주세요.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return <Tooltip label={label} placement="bottom">
    <button ref={button} type="button" className="titlebar-button" aria-label={label} data-workspace-control="share"
      aria-busy={busy || undefined} disabled={shareable === null || busy} onClick={() => void share()}><ShareIcon /></button>
  </Tooltip>
}
