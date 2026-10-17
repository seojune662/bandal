import { useCallback, useState, type RefObject } from 'react'
import type { DrawingClipSource } from '../../../../shared/types/drawing'
import type { PersonalBoard } from '../../../../shared/types/whiteboard'
import { openNewNoteSheet } from '../pdfNotes/NewNoteSheet'
import { noteNodes } from '../materials/NotesGroup'
import { showToast } from '../../app/toast'
import { invoke } from '../../lib/ipc'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { descriptorFor } from '../workspace/tabIdentity'
import type { ContentPoint } from './popovers'

export type NotePickerItem = Pick<PersonalBoard, 'id' | 'title'> & { relPath?: string }
export type WhiteboardDestination =
  | { kind: 'create' }
  | { kind: 'direct'; board: NotePickerItem }
  | { kind: 'choose'; boards: NotePickerItem[] }

export function destinationForBoards(
  boards: NotePickerItem[]
): WhiteboardDestination {
  if (boards.length === 0) return { kind: 'create' }
  const board = boards[0]
  if (boards.length === 1 && board !== undefined) return { kind: 'direct', board }
  return { kind: 'choose', boards }
}

export interface WhiteboardPickerState {
  source: DrawingClipSource
  boards: NotePickerItem[]
  position: ContentPoint
}

interface WhiteboardClipDelivery {
  picker: WhiteboardPickerState | null
  send: (
    source: DrawingClipSource,
    clientX: number,
    clientY: number
  ) => Promise<void>
  choose: (board: NotePickerItem) => void
  create: () => Promise<void>
  dismiss: () => void
}

export function useWhiteboardClipDelivery(
  courseId: string,
  contentRef: RefObject<HTMLDivElement>
): WhiteboardClipDelivery {
  const [picker, setPicker] = useState<WhiteboardPickerState | null>(null)

  const deliver = useCallback(async (board: NotePickerItem, source: DrawingClipSource): Promise<void> => {
    const relPath = board.relPath ?? board.id
    const info = await invoke('pdfNotes:info', { courseId, relPath })
    const aspect = source.pageAspect ?? Math.SQRT2
    const destinationAspect = info.orientation === 'landscape' ? 1 / Math.SQRT2 : Math.SQRT2
    const width = .6, height = Math.min(.72, width * (source.crop ? aspect * source.crop.height / source.crop.width : aspect) / destinationAspect)
    const existing = await invoke('drawings:listForFile', { courseId, relPath })
    const offset = Math.min(existing.filter(item => item.page === 1 && item.kind === 'clip').length, 8) * .025
    await invoke('drawings:create', { courseId, relPath, page: 1, documentRevision: info.documentRevision, kind: 'clip',
      data: { box: { x: Math.min(1 - width, .1 + offset), y: Math.min(1 - height, .1 + offset), width, height }, clip: source }, style: { color: 'ink', width: .002, opacity: 1 } })
    useWorkspaceStore.getState().openTab(descriptorFor('pdf', { courseId, relPath }))
    showToast(`${board.title}에 붙였어요`)
  }, [courseId])

  const createAndDeliver = useCallback(async (source: DrawingClipSource): Promise<void> => {
    openNewNoteSheet(courseId, undefined, relPath => deliver({ id: relPath, title: relPath.split('/').pop() ?? '노트', relPath }, source))
  }, [courseId, deliver])

  const send = useCallback(async (
    source: DrawingClipSource,
    clientX: number,
    clientY: number
  ): Promise<void> => {
    const content = contentRef.current
    if (content === null) return
    const contentBox = content.getBoundingClientRect()
    const position = {
      left: clientX - contentBox.left,
      top: clientY - contentBox.top + 6
    }

    try {
      const destination = destinationForBoards(
        noteNodes(await invoke('materials:tree', { courseId })).map(node => ({ id: node.relPath, title: node.name, relPath: node.relPath }))
      )
      if (destination.kind === 'choose') {
        setPicker({ source, boards: destination.boards, position })
      } else if (destination.kind === 'direct') {
        setPicker(null)
        await deliver(destination.board, source)
      } else {
        setPicker(null)
        await createAndDeliver(source)
      }
    } catch (error) {
      console.error('[Bandal] 노트로 보내지 못했습니다.', error)
      showToast('노트로 보내지 못했습니다.', 'danger')
    }
  }, [contentRef, courseId, createAndDeliver, deliver])

  const choose = useCallback((board: NotePickerItem): void => {
    if (picker === null) return
    const { source } = picker
    setPicker(null)
    void deliver(board, source).catch(() => showToast('노트로 보내지 못했습니다.', 'danger'))
  }, [deliver, picker])

  const create = useCallback(async (): Promise<void> => {
    if (picker === null) return
    const { source } = picker
    setPicker(null)
    try {
      await createAndDeliver(source)
    } catch (error) {
      console.error('[Bandal] 노트로 보내지 못했습니다.', error)
      showToast('노트로 보내지 못했습니다.', 'danger')
    }
  }, [createAndDeliver, picker])

  const dismiss = useCallback((): void => setPicker(null), [])

  return { picker, send, choose, create, dismiss }
}
