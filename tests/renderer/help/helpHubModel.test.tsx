import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { Icon } from '../../../src/renderer/src/app/icons'
import {
  milestoneDestination
} from '../../../src/renderer/src/features/help/HelpHub'


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
    expect(milestoneDestination('question')).toBe('assistant-panel-toggle')
    expect(milestoneDestination('pip')).toBe('pip')
  })

})
