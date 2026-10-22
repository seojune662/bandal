// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'

const harness = vi.hoisted(() => ({ importPaths: vi.fn(), created: vi.fn() }))
vi.mock('../../../src/renderer/src/features/materials/importDrop', () => ({ importMaterialPaths: harness.importPaths }))
vi.mock('../../../src/renderer/src/lib/ipc', () => ({ invoke: vi.fn(), pathForFile: () => '/external/lecture.pdf' }))
vi.mock('../../../src/renderer/src/app/toast', () => ({ showToast: vi.fn() }))
vi.mock('../../../src/renderer/src/stores/materialsStore', () => ({ useMaterialsStore: { getState: () => ({ loadTree: vi.fn() }) } }))
import { useMaterialsPaste } from '../../../src/renderer/src/features/materials/useMaterialsPaste'

test('copied OS files stay in the initiating project and late completion cannot select another project', async () => {
  let finish!: (paths: string[]) => void
  harness.importPaths.mockImplementation(() => new Promise<string[]>(resolve => { finish = resolve }))
  let paste!: ReturnType<typeof useMaterialsPaste>['onPaste']
  function Probe(): JSX.Element {
    const state = useMaterialsPaste({ enabled: true, courseId: 'course', courseName: 'Parent', dirRelPath: 'projects/review', destinationName: '복습 프로젝트', onCreated: harness.created })
    paste = state.onPaste
    return <div>{state.pasteNotice}</div>
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<Probe />) })
  await act(async () => {
    paste({ target: host, preventDefault: vi.fn(), clipboardData: { files: [new File(['pdf'], 'lecture.pdf', { type: 'application/pdf' })], types: ['Files'], getData: () => '' } } as unknown as React.ClipboardEvent<HTMLElement>)
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
  expect(harness.importPaths).toHaveBeenCalledWith('course', ['/external/lecture.pdf'], 'projects/review')
  expect(host.textContent).toContain('복습 프로젝트에 추가됩니다')
  await act(async () => { root.unmount(); finish(['projects/review/lecture.pdf']); await Promise.resolve() })
  expect(harness.created).not.toHaveBeenCalled()
  host.remove()
})
