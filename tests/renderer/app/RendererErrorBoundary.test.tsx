// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RendererErrorBoundary } from '../../../src/renderer/src/app/RendererErrorBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

function BrokenScreen(): JSX.Element {
  throw new Error('page-note editor context missing')
}

describe('RendererErrorBoundary', () => {
  let container: HTMLDivElement
  let root: Root
  const preventExpectedError = (event: ErrorEvent): void => {
    event.preventDefault()
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    window.addEventListener('error', preventExpectedError)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.removeEventListener('error', preventExpectedError)
    vi.restoreAllMocks()
  })

  test('shows a recovery screen instead of leaving the window blank', () => {
    act(() => {
      root.render(
        <RendererErrorBoundary>
          <BrokenScreen />
        </RendererErrorBoundary>
      )
    })

    expect(container.textContent).toContain('화면을 불러오지 못했어요')
    expect(container.textContent).toContain(
      '파일과 필기는 그대로 보존되어 있습니다'
    )
    expect(container.textContent).toContain('page-note editor context missing')
    expect(container.querySelector('button')?.textContent).toBe('다시 불러오기')
  })
})
