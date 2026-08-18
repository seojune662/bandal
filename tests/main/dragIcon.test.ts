import { describe, expect, test } from 'vitest'
import { DRAG_ICON_PNG_BASE64 } from '../../src/main/ipc/dragIcon'

/**
 * startDrag 는 빈 NativeImage 에 throw 하므로 인라인 폴백 아이콘은 반드시
 * 유효한 PNG 여야 한다. nativeImage 는 electron 런타임이 필요하니 여기서는
 * base64 → 바이트 디코드와 PNG 구조(시그니처, IHDR 32x32)를 검증한다.
 */
describe('DRAG_ICON_PNG_BASE64', () => {
  test('decodes to a non-empty valid 32x32 PNG', () => {
    const bytes = Buffer.from(DRAG_ICON_PNG_BASE64, 'base64')

    expect(bytes.length).toBeGreaterThan(0)
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    // First chunk must be IHDR; width/height at fixed offsets 16/20.
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(bytes.readUInt32BE(16)).toBe(32)
    expect(bytes.readUInt32BE(20)).toBe(32)
    // Ends with IEND.
    expect(bytes.subarray(bytes.length - 8, bytes.length - 4).toString('ascii'))
      .toBe('IEND')
  })
})
