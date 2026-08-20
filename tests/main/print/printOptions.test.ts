/**
 * Print defaults.
 *
 * Two of these deliberately differ from Chromium's, and both differences are
 * the whole point on a Korean 고지서 — so they are pinned here rather than
 * left to be "improved" back to the Chromium default.
 */
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_PRINT_PREFS,
  printJobFileName,
  toPrintToPdfOptions
} from '../../../src/main/features/print/printOptions'

describe('DEFAULT_PRINT_PREFS', () => {
  test('A4, not Electron default Letter', () => {
    // Every Korean bill, form and transcript is A4.
    expect(DEFAULT_PRINT_PREFS.pageSize).toBe('A4')
  })

  test('background graphics on, unlike Chrome', () => {
    // A 고지서's table rules, shading and seals are background graphics.
    // Off prints a page of floating numbers.
    expect(DEFAULT_PRINT_PREFS.printBackground).toBe(true)
  })
})

describe('toPrintToPdfOptions', () => {
  test('honours the site @page rule', () => {
    // Korean report viewers almost always set one; ignoring it is the
    // difference between a bill that fits and one cut in half.
    expect(toPrintToPdfOptions(DEFAULT_PRINT_PREFS)['preferCSSPageSize']).toBe(
      true
    )
  })

  test('stamps no header or footer across the page', () => {
    expect(
      toPrintToPdfOptions(DEFAULT_PRINT_PREFS)['displayHeaderFooter']
    ).toBe(false)
  })

  test('carries the prefs through', () => {
    const options = toPrintToPdfOptions({
      pageSize: 'Letter',
      landscape: true,
      printBackground: false
    })
    expect(options['pageSize']).toBe('Letter')
    expect(options['landscape']).toBe(true)
    expect(options['printBackground']).toBe(false)
  })

  test('uses marginType rather than numbers', () => {
    // printToPDF's numeric margins are inches while print()'s are device
    // units, and they share a TypeScript interface — a numeric object shared
    // between the two silently prints at the wrong scale.
    expect(toPrintToPdfOptions(DEFAULT_PRINT_PREFS)['margins']).toEqual({
      marginType: 'default'
    })
  })
})

describe('printJobFileName', () => {
  const AT = new Date('2026-08-21T10:00:00Z')

  test('names the job after the page, with a date', () => {
    expect(printJobFileName('2026학년도 2학기 등록금', AT)).toBe(
      '2026학년도 2학기 등록금 2026-08-21.pdf'
    )
  })

  test('strips characters a filesystem refuses', () => {
    const name = printJobFileName('등록금/고지서: 1차*', AT)
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name.endsWith('.pdf')).toBe(true)
  })

  test('an untitled page still gets a usable name', () => {
    expect(printJobFileName('', AT)).toBe('인쇄 2026-08-21.pdf')
    expect(printJobFileName('   ', AT)).toBe('인쇄 2026-08-21.pdf')
  })

  test('a very long title is truncated, not rejected', () => {
    const name = printJobFileName('가'.repeat(200), AT)
    expect(name.length).toBeLessThan(90)
    expect(name.endsWith('.pdf')).toBe(true)
  })
})
