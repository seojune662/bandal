import { flushDocumentSaves } from '../documents/saveRegistry'
import { retainedTabDescriptors, useWorkspaceStore } from '../../stores/workspaceStore'
import { flushOpenNoteSession } from '../notes/noteSessionRegistry'

/** An explicit restart waits for every live note, including moved/hidden views. */
export async function prepareUpdateInstall(): Promise<void> {
  await flushDocumentSaves()
  const saved = new Set<string>()
  for (const descriptor of retainedTabDescriptors()) {
    if (descriptor.kind !== 'note') continue
    const ref = descriptor.payload
    const key = `${ref.courseId}\u0000${ref.relPath}`
    if (saved.has(key)) continue
    saved.add(key)
    const flushed = await flushOpenNoteSession(ref)
    if (flushed !== null && flushed.result.status !== 'saved') {
      throw new Error(`필기를 저장하지 못해 다시 시작하지 않았어요. ${ref.relPath}의 저장 상태를 확인한 뒤 다시 시도해 주세요.`)
    }
  }
  // A transition ACK must follow the layout IPC ACK as well as document saves.
  await useWorkspaceStore.getState().flushPendingSave()
}
