import { describe, expect, test } from 'vitest'
import {
  ABORTED_ERROR_CODE,
  errorCopy
} from '../../../src/renderer/src/features/browser/loadError'

const HOST = 'myetl.snu.ac.kr'

describe('errorCopy', () => {
  test('says nothing for an aborted load', () => {
    // ERR_ABORTED fires on every replaced/stopped navigation. Rendering an
    // error page for it makes the overlay strobe during ordinary browsing.
    expect(errorCopy(ABORTED_ERROR_CODE, HOST)).toBeNull()
  })

  test('names the host in every message it produces', () => {
    for (const code of [-105, -137, -109, -118, -102, -101, -7, -201, -999]) {
      const copy = errorCopy(code, HOST)
      expect(copy, String(code)).not.toBeNull()
      expect(`${copy?.title}${copy?.detail}`, String(code)).toContain(HOST)
    }
  })

  test('offline is about the network, not the site', () => {
    const copy = errorCopy(-106, HOST)
    expect(copy?.title).toBe('인터넷에 연결되어 있지 않습니다.')
    expect(copy?.detail).not.toContain(HOST)
    expect(copy?.canRetry).toBe(true)
  })

  test('DNS failures are distinguished from connection failures', () => {
    expect(errorCopy(-105, HOST)?.title).toBe('주소를 찾지 못했습니다.')
    expect(errorCopy(-118, HOST)?.title).toBe('서버에 연결하지 못했습니다.')
  })

  test('certificate errors never offer a retry, only the system browser', () => {
    // Retrying cannot change Chromium's verdict, and this app registers no
    // `certificate-error` handler, so there is no bypass to offer either.
    for (const code of [-200, -201, -211, -219, -501]) {
      const copy = errorCopy(code, HOST)
      expect(copy?.canRetry, String(code)).toBe(false)
      expect(copy?.offerExternal, String(code)).toBe(true)
      expect(copy?.title, String(code)).toBe('연결이 안전하지 않습니다.')
    }
  })

  test('codes just outside the certificate range are not treated as one', () => {
    expect(errorCopy(-199, HOST)?.canRetry).toBe(true)
    expect(errorCopy(-220, HOST)?.canRetry).toBe(true)
  })

  test('an unknown code still produces something actionable', () => {
    const copy = errorCopy(-31337, HOST)
    expect(copy?.title).toBe('페이지를 열지 못했습니다.')
    expect(copy?.canRetry).toBe(true)
  })
})
