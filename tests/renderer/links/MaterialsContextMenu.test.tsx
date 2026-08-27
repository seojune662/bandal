import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { MaterialNode } from '../../../src/shared/types/materials'
import { MaterialsContextMenu } from '../../../src/renderer/src/features/materials/MaterialsContextMenu'

function renderMenu(target: MaterialNode): string {
  const noop = vi.fn()
  return renderToStaticMarkup(
    <MaterialsContextMenu
      target={target}
      x={0}
      y={0}
      placement="bottom"
      align="start"
      returnFocus={null}
      onClose={noop}
      onCreateFile={noop}
      onCreateFolder={noop}
      onDuplicate={noop}
      onCopyAbsolutePath={noop}
      onCopyRelativePath={noop}
      onReveal={noop}
      onConnect={noop}
      onRename={noop}
      onDelete={noop}
    />
  )
}

function openingTagBefore(html: string, label: string): string {
  const labelIndex = html.indexOf(label)
  const buttonIndex = html.lastIndexOf('<button', labelIndex)
  const endIndex = html.indexOf('>', buttonIndex)
  return html.slice(buttonIndex, endIndex + 1)
}

describe('materials link context-menu action', () => {
  test('enables material linking for a file', () => {
    const html = renderMenu({ relPath: '강의.pdf', name: '강의.pdf', kind: 'pdf' })

    expect(html).toContain('자료 연결…')
    expect(openingTagBefore(html, '자료 연결…')).not.toContain('disabled')
  })

  test('disables material linking for a folder', () => {
    const html = renderMenu({
      relPath: '강의',
      name: '강의',
      kind: 'dir',
      children: []
    })

    expect(openingTagBefore(html, '자료 연결…')).toContain('disabled')
  })
})
