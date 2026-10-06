// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { MaterialTree } from '../../../src/renderer/src/features/materials/MaterialTree'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), onPush: vi.fn(() => () => {}), startMaterialDrag: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('a full filename replacement cannot be narrowed by delayed initial stem selection', async () => {
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const node = { relPath: 'moving.md', name: 'moving.md', kind: 'note' as const }
  const rename = vi.fn(async () => null)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    act(() => root.render(<MaterialTree courseId="source" nodes={[node]} expandedPaths={{}} editingRelPath={node.relPath}
      selectedRelPath={null} pasteTargetDirRelPath={null} dropTargetDirRelPath={null} urlDropTargetDirRelPath={null} downloadingDirRelPath={null}
      onToggleFolder={() => {}} onSelect={() => {}} onContextMenu={() => {}} onCancelRename={() => {}} onRename={rename}
      onDropTargetChange={() => {}} onUrlDropTargetChange={() => {}} onMove={() => {}} onImportFiles={() => {}} onDownloadUrl={() => {}} onUnsupportedDrop={() => {}} />))
    const input = container.querySelector<HTMLInputElement>('.material-row__rename')!
    input.focus(); input.select()
    // Chromium may paint between selecting the field and inserting replacement
    // text. The initial focus callback must not reselect only "moving" here.
    act(() => { for (const callback of frames.values()) callback(0); frames.clear() })
    act(() => {
      input.setRangeText('renamed.md', input.selectionStart!, input.selectionEnd!, 'end')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(rename).toHaveBeenCalledWith(node, 'renamed.md')
  } finally {
    act(() => root.unmount()); container.remove(); request.mockRestore(); cancel.mockRestore()
  }
})
