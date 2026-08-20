/**
 * Which pages may ask to launch a program.
 *
 * The bar is not "is this scheme known" — nobody can enumerate every Korean
 * university's helper. It is "could this plausibly be a launcher, and is it
 * shaped like one". Everything that executes code, reaches the filesystem,
 * drives the browser, or leaks credentials to a share is refused before the
 * student is ever asked.
 */
import { describe, expect, test } from 'vitest'
import {
  classifyExternalScheme,
  externalSchemeDisplay,
  requestingOriginOf,
  EXTERNAL_SCHEME_MAX_URL
} from '../../../src/main/features/browser/externalScheme'

describe('classifyExternalScheme', () => {
  test('a Korean university helper is worth asking about', () => {
    expect(classifyExternalScheme('wizvera://install?v=1')).toEqual({
      kind: 'ask',
      scheme: 'wizvera'
    })
    expect(classifyExternalScheme('ozviewer://open')).toEqual({
      kind: 'ask',
      scheme: 'ozviewer'
    })
    expect(classifyExternalScheme('nppfs://start').kind).toBe('ask')
    expect(classifyExternalScheme('astxsvc://run').kind).toBe('ask')
  })

  test('mailto and tel are ordinary handoffs too', () => {
    expect(classifyExternalScheme('mailto:a@b.ac.kr').kind).toBe('ask')
    expect(classifyExternalScheme('tel:0212345678').kind).toBe('ask')
  })

  test('code execution and local file access are never offered', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>1</script>',
      'view-source:https://x/',
      'jar:https://x!/y',
      'shell:startup'
    ]) {
      expect(classifyExternalScheme(url)).toEqual({
        kind: 'blocked',
        reason: 'scheme'
      })
    }
  })

  test('the Windows LPE families are never offered', () => {
    // ms-msdt (Follina) and search-ms are one-click RCE with the right payload.
    for (const url of [
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x&crumb=location:\\\\attacker\\share',
      'ms-appinstaller:?source=https://x/y.appinstaller',
      'ms-officecmd:%7B%22id%22:3%7D'
    ]) {
      expect(classifyExternalScheme(url).kind).toBe('blocked')
    }
  })

  test('network file systems are never offered', () => {
    // Reaching one leaks an NTLM hash before anything is displayed.
    for (const scheme of ['smb', 'nfs', 'afp', 'ftp', 'dav']) {
      expect(classifyExternalScheme(`${scheme}://host/share`)).toEqual({
        kind: 'blocked',
        reason: 'scheme'
      })
    }
  })

  test('our own deep links are never driven by web content', () => {
    expect(classifyExternalScheme('bandal://course/1')).toEqual({
      kind: 'blocked',
      reason: 'scheme'
    })
  })

  test('the browser internals are never offered', () => {
    for (const scheme of ['about', 'chrome', 'devtools', 'chrome-extension']) {
      expect(classifyExternalScheme(`${scheme}://x`).kind).toBe('blocked')
    }
  })

  test('a long URL is refused before the dialog ever sees it', () => {
    // Length is how the LPE payloads carry their arguments, and it is also
    // how you push the real scheme off the top of a dialog.
    const long = `wizvera://${'a'.repeat(EXTERNAL_SCHEME_MAX_URL)}`
    expect(classifyExternalScheme(long)).toEqual({
      kind: 'blocked',
      reason: 'length'
    })
  })

  test('quotes, backslashes and whitespace are refused', () => {
    // They forge extra lines in the dialog body and extra arguments to a
    // handler's command line.
    for (const url of [
      'wizvera://a b',
      'wizvera://a\nb',
      'wizvera://a"b',
      "wizvera://a'b",
      'wizvera://a\\b',
      'wizvera://a`b'
    ]) {
      expect(classifyExternalScheme(url)).toEqual({
        kind: 'blocked',
        reason: 'shape'
      })
    }
  })

  test('a malformed scheme is refused', () => {
    expect(classifyExternalScheme('nocolon').kind).toBe('blocked')
    expect(classifyExternalScheme(':leading').kind).toBe('blocked')
    expect(classifyExternalScheme('9numeric://x')).toEqual({
      kind: 'blocked',
      reason: 'shape'
    })
  })

  test('http(s) is not an external scheme and must not reach here', () => {
    expect(classifyExternalScheme('https://x/').kind).toBe('blocked')
  })

  test('case does not let a blocked scheme through', () => {
    expect(classifyExternalScheme('FILE:///etc/passwd').kind).toBe('blocked')
    expect(classifyExternalScheme('Ms-Msdt:/id x').kind).toBe('blocked')
  })
})

describe('externalSchemeDisplay', () => {
  test('a normal URL is shown as it is', () => {
    expect(externalSchemeDisplay('wizvera://install?v=1')).toBe(
      'wizvera://install?v=1'
    )
  })

  test('a long URL is truncated so the scheme stays visible', () => {
    const shown = externalSchemeDisplay(`wizvera://${'a'.repeat(500)}`)
    expect(shown.length).toBeLessThanOrEqual(301)
    expect(shown.startsWith('wizvera://')).toBe(true)
    expect(shown.endsWith('…')).toBe(true)
  })

  test('control characters cannot forge dialog lines', () => {
    expect(externalSchemeDisplay('wizvera://a\n요청한 사이트: 은행')).not.toContain(
      '\n'
    )
  })
})

describe('requestingOriginOf', () => {
  test('shows the origin, never the path', () => {
    // A path is attacker-controlled and can be written to read like prose.
    expect(
      requestingOriginOf('https://shine.snu.ac.kr/com/ozReportViewer.action?x=1')
    ).toBe('https://shine.snu.ac.kr')
  })

  test('keeps a non-standard port, because it identifies the host', () => {
    expect(requestingOriginOf('https://portal.inha.ac.kr:8443/x')).toBe(
      'https://portal.inha.ac.kr:8443'
    )
  })

  test('an unparseable URL does not print undefined', () => {
    expect(requestingOriginOf('')).toBe('알 수 없는 사이트')
  })
})
