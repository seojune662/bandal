// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DrawingStyle } from '../../../src/shared/types/drawing'
import { TextFormatRow } from '../../../src/renderer/src/features/ink/TextFormatRow'
import {
  useTextFormatStore,
  type TextStylePatch
} from '../../../src/renderer/src/features/ink/textFormatStore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const baseStyle: DrawingStyle = {
  color: 'ink',
  width: 0.006,
  opacity: 1,
  fontScale: 1
}

let root: Root | null = null

function seedTarget(
  apply: (patch: TextStylePatch) => void,
  style: DrawingStyle = baseStyle
): void {
  useTextFormatStore.getState().publish({
    ownerId: 'row-test',
    mode: 'selected',
    style,
    apply
  })
}

function renderRow(visible?: boolean): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      visible === undefined ? <TextFormatRow /> : <TextFormatRow visible={visible} />
    )
  })
  return container
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  useTextFormatStore.setState({ target: null })
  document.body.replaceChildren()
})

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  root = null
  useTextFormatStore.setState({ target: null })
  document.body.replaceChildren()
})

describe('TextFormatRow', () => {
  test('renders the full format contract from the current target', () => {
    seedTarget(vi.fn(), {
      ...baseStyle,
      bold: true,
      italic: false,
      align: 'center'
    })
    const container = renderRow()
    const toolbar = container.querySelector<HTMLElement>(
      '.ink-format-row[role="toolbar"][aria-label="텍스트 서식"][data-ink-format-row]'
    )

    expect(toolbar).not.toBeNull()
    for (const label of [
      '글자 작게',
      '글자 크게',
      '굵게',
      '기울임',
      '밑줄',
      '취소선',
      '왼쪽 정렬',
      '가운데 정렬',
      '오른쪽 정렬'
    ]) {
      expect(toolbar?.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
    }
    for (const label of ['기본', '빨강', '주황', '노랑', '초록', '파랑', '보라']) {
      expect(toolbar?.querySelector(
        `.ink-format-row__swatch[aria-label="${label}"]`
      )).not.toBeNull()
    }
    for (const label of [
      '배경 없음',
      '배경 기본',
      '배경 빨강',
      '배경 주황',
      '배경 노랑',
      '배경 초록',
      '배경 파랑',
      '배경 보라'
    ]) {
      expect(toolbar?.querySelector(
        `.ink-format-row__fill[aria-label="${label}"]`
      )).not.toBeNull()
    }
    expect(toolbar?.querySelector('input[type="range"][aria-label="글자 불투명도"]'))
      .not.toBeNull()
    expect(toolbar?.querySelectorAll(
      'button.ink-format-row__swatch[data-color]'
    )).toHaveLength(7)
    expect(toolbar?.querySelectorAll(
      'button.ink-format-row__fill[data-color]'
    )).toHaveLength(8)
    expect(toolbar?.querySelector('.ink-format-row__scale')?.textContent).toBe('100%')
    expect(toolbar?.querySelector('[aria-label="굵게"]')?.getAttribute('aria-pressed'))
      .toBe('true')
    expect(toolbar?.querySelector('[aria-label="기울임"]')?.getAttribute('aria-pressed'))
      .toBe('false')
    expect(toolbar?.querySelector('[aria-label="가운데 정렬"]')?.getAttribute('aria-pressed'))
      .toBe('true')
    expect(toolbar?.querySelector('[aria-label="왼쪽 정렬"]')?.getAttribute('aria-pressed'))
      .toBe('false')
  })

  test('applies toggle, alignment, fill and stepped font patches', () => {
    const apply = vi.fn()
    seedTarget(apply)
    const container = renderRow()
    const byLabel = (label: string): HTMLButtonElement =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

    click(byLabel('굵게'))
    click(byLabel('가운데 정렬'))
    click(byLabel('배경 빨강'))
    click(byLabel('글자 크게'))
    click(byLabel('배경 없음'))

    expect(apply).toHaveBeenNthCalledWith(1, { bold: true })
    expect(apply).toHaveBeenNthCalledWith(2, { align: 'center' })
    expect(apply).toHaveBeenNthCalledWith(3, { fill: 'red' })
    expect(apply).toHaveBeenNthCalledWith(4, { fontScale: 1.25 })
    expect(apply).toHaveBeenNthCalledWith(5, { fill: undefined })

    for (const button of container.querySelectorAll('button')) {
      const allowed = button.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      )
      expect(allowed).toBe(false)
    }
  })

  test('renders nothing without a target unless visibility is forced', () => {
    const container = renderRow()

    expect(container.querySelector('.ink-format-row')).toBeNull()
  })

  test('renders disabled controls when visible without a target', () => {
    const container = renderRow(true)
    const toolbar = container.querySelector('.ink-format-row')
    const controls = toolbar?.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button, input'
    ) ?? []

    expect(toolbar).not.toBeNull()
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) expect(control.disabled).toBe(true)
  })
})
