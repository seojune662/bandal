// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TextFormatTarget } from '../../../src/renderer/src/features/ink/textFormatStore'
import {
  isInsideTextFormatRow,
  mergeTextStyle,
  TEXT_FORMAT_ROW_ATTR,
  useTextFormatStore
} from '../../../src/renderer/src/features/ink/textFormatStore'

function target(ownerId: string): TextFormatTarget {
  return {
    ownerId,
    mode: 'selected',
    style: { color: 'ink', width: 0.006, opacity: 1, fontScale: 1 },
    apply: vi.fn()
  }
}

beforeEach(() => {
  useTextFormatStore.setState({ target: null })
  document.body.replaceChildren()
})

describe('textFormatStore', () => {
  test('publish replaces the current target with the last writer', () => {
    const first = target('page-1')
    const second = target('page-2')

    useTextFormatStore.getState().publish(first)
    useTextFormatStore.getState().publish(second)

    expect(useTextFormatStore.getState().target).toBe(second)
  })

  test('clear only removes a target owned by the matching layer', () => {
    const current = target('page-1')
    useTextFormatStore.getState().publish(current)

    useTextFormatStore.getState().clear('page-2')
    expect(useTextFormatStore.getState().target).toBe(current)

    useTextFormatStore.getState().clear('page-1')
    expect(useTextFormatStore.getState().target).toBeNull()
  })

  test('mergeTextStyle removes keys patched with undefined', () => {
    const base = {
      color: 'ink' as const,
      width: 0.006,
      opacity: 1,
      fontScale: 1,
      bold: true,
      fill: 'red' as const
    }

    expect(mergeTextStyle(base, { fill: undefined, bold: false })).toEqual({
      color: 'ink',
      width: 0.006,
      opacity: 1,
      fontScale: 1,
      bold: false
    })
  })

  test('detects the format-row attribute on an element or its ancestor', () => {
    const row = document.createElement('div')
    row.setAttribute(TEXT_FORMAT_ROW_ATTR, '')
    const button = document.createElement('button')
    const icon = document.createElement('span')
    button.append(icon)
    row.append(button)
    const outside = document.createElement('div')
    document.body.append(row, outside)

    expect(isInsideTextFormatRow(row)).toBe(true)
    expect(isInsideTextFormatRow(icon)).toBe(true)
    expect(isInsideTextFormatRow(outside)).toBe(false)
    expect(isInsideTextFormatRow(null)).toBe(false)
  })
})
