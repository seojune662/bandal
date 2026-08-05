import { describe, expect, test } from 'vitest'
import {
  browsingUserAgent,
  hasChromeToken
} from '../../../src/main/features/browser/userAgent'

/** Electron 35.7.5 on macOS (Chromium 134.0.6998.205), per the research doc. */
const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) bandal/0.1.0 Chrome/134.0.6998.205 Electron/35.7.5 Safari/537.36'

const PLAIN_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.6998.205 Safari/537.36'

describe('browsingUserAgent', () => {
  test('strips Electron/ and the app name, keeping everything else', () => {
    expect(browsingUserAgent(ELECTRON_UA, 'bandal')).toBe(PLAIN_CHROME_UA)
  })

  test('never drops the Chrome token — the whole point of the change', () => {
    expect(hasChromeToken(browsingUserAgent(ELECTRON_UA, 'bandal'))).toBe(true)
    expect(browsingUserAgent(ELECTRON_UA, 'bandal')).toContain(
      'Chrome/134.0.6998.205'
    )
  })

  test('takes the version from the input, never a hardcoded one', () => {
    const upgraded = ELECTRON_UA.replace('134.0.6998.205', '999.0.1.2').replace(
      'Electron/35.7.5',
      'Electron/40.0.0'
    )
    const result = browsingUserAgent(upgraded, 'bandal')

    expect(result).toContain('Chrome/999.0.1.2')
    expect(result).not.toContain('Electron')
  })

  test('is case-insensitive about the app name and idempotent', () => {
    const once = browsingUserAgent(ELECTRON_UA, 'Bandal')
    expect(once).toBe(PLAIN_CHROME_UA)
    expect(browsingUserAgent(once, 'bandal')).toBe(PLAIN_CHROME_UA)
  })

  test('leaves the parenthesised platform comment untouched', () => {
    expect(browsingUserAgent(ELECTRON_UA, 'bandal')).toContain(
      '(Macintosh; Intel Mac OS X 10_15_7)'
    )
    expect(browsingUserAgent(ELECTRON_UA, 'bandal')).toContain('(KHTML, like Gecko)')
  })

  test('does not touch a token that merely ends with the app name', () => {
    const ua = ELECTRON_UA.replace('bandal/0.1.0', 'notbandal/9.9 bandal/0.1.0')
    expect(browsingUserAgent(ua, 'bandal')).toContain('notbandal/9.9')
  })

  test('fails safe: input without a Chrome token is returned unchanged', () => {
    // Stripping here would leave something no portal can classify — worse
    // than the original. Better to change nothing.
    const noChrome = 'Mozilla/5.0 bandal/0.1.0 Electron/35.7.5 Safari/537.36'
    expect(browsingUserAgent(noChrome, 'bandal')).toBe(noChrome)
  })

  test('handles an empty app name and an empty UA', () => {
    expect(browsingUserAgent(ELECTRON_UA, '')).toBe(
      ELECTRON_UA.replace(' Electron/35.7.5', '')
    )
    expect(browsingUserAgent('', 'bandal')).toBe('')
  })

  test('an already-plain Chrome UA passes through unchanged', () => {
    expect(browsingUserAgent(PLAIN_CHROME_UA, 'bandal')).toBe(PLAIN_CHROME_UA)
  })
})

describe('hasChromeToken', () => {
  test('detects the token a fail-closed sniffer looks for', () => {
    expect(hasChromeToken(PLAIN_CHROME_UA)).toBe(true)
    expect(hasChromeToken('Mozilla/5.0 Safari/537.36')).toBe(false)
    expect(hasChromeToken('Chrome/')).toBe(false)
  })
})
