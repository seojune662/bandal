import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Icon } from '../../../src/renderer/src/app/icons'
import { SHORTCUT_HELP_EVENT } from '../../../src/renderer/src/app/shortcuts'
import {
  installCollapsedRailHelpBridge,
  milestoneDestination
} from '../../../src/renderer/src/features/help/HelpHub'
import { useUiStore } from '../../../src/renderer/src/stores/uiStore'

afterEach(() => {
  useUiStore.setState({ leftRailOpen: true })
  delete (globalThis as { window?: Window }).window
})

describe('help hub entry points', () => {
  test('the rail help icon is a question mark in a circle', () => {
    const html = renderToStaticMarkup(<Icon name="help" />)
    expect(html).toContain('<circle')
    expect(html).toContain('M9.6 9')
  })

  test('every milestone maps to an existing app destination', () => {
    expect(milestoneDestination('university')).toBe('settings-university')
    expect(milestoneDestination('course')).toBe('course')
    expect(milestoneDestination('materials')).toBe('materials')
    expect(milestoneDestination('agent')).toBe('settings-ai')
    expect(milestoneDestination('tutorial')).toBe('tour')
    expect(milestoneDestination('favorite')).toBe('favorites-section')
    expect(milestoneDestination('question')).toBe('assistant-orb')
    expect(milestoneDestination('group')).toBe('together-footer')
    expect(milestoneDestination('pip')).toBe('pip')
  })

  test('reopens a collapsed rail before replaying the shortcut-help event', () => {
    const target = new EventTarget()
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    Object.assign(target, { requestAnimationFrame })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: target
    })
    useUiStore.setState({ leftRailOpen: false })
    let received = 0
    target.addEventListener(SHORTCUT_HELP_EVENT, () => {
      received += 1
    })

    installCollapsedRailHelpBridge()
    target.dispatchEvent(new Event(SHORTCUT_HELP_EVENT))

    expect(useUiStore.getState().leftRailOpen).toBe(true)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2)
    expect(received).toBe(2)
  })
})
