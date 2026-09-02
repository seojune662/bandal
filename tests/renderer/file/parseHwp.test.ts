import { describe, expect, test } from 'vitest'
import {
  HWPTAG_PARA_TEXT,
  extractParaText,
  extractSectionText,
  iterateHwpRecords,
  parseHwpFileHeader
} from '../../../src/renderer/src/features/file/hwp/parseHwp'

function buildRecord(tagId: number, level: number, payload: Uint8Array): Uint8Array {
  const extended = payload.length >= 0xfff
  const header = new Uint8Array(extended ? 8 : 4)
  const view = new DataView(header.buffer)
  view.setUint32(
    0,
    (tagId & 0x3ff) | ((level & 0x3ff) << 10) |
      ((extended ? 0xfff : payload.length) << 20),
    true
  )
  if (extended) view.setUint32(4, payload.length, true)
  const record = new Uint8Array(header.length + payload.length)
  record.set(header)
  record.set(payload, header.length)
  return record
}

function utf16(units: number[]): Uint8Array {
  const bytes = new Uint8Array(units.length * 2)
  const view = new DataView(bytes.buffer)
  units.forEach((unit, index) => view.setUint16(index * 2, unit, true))
  return bytes
}

function textUnits(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0))
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  return merged
}

describe('parseHwpFileHeader', () => {
  function header(flags: number): Uint8Array {
    const bytes = new Uint8Array(256)
    bytes.set(new TextEncoder().encode('HWP Document File'))
    new DataView(bytes.buffer).setUint32(36, flags, true)
    return bytes
  }

  test('reads signature, compressed and password bits', () => {
    expect(parseHwpFileHeader(header(0b01))).toEqual({
      isHwp: true,
      compressed: true,
      passworded: false
    })
    expect(parseHwpFileHeader(header(0b10)).passworded).toBe(true)
    expect(parseHwpFileHeader(header(0)).compressed).toBe(false)
  })

  test('rejects non-hwp bytes', () => {
    expect(parseHwpFileHeader(new TextEncoder().encode('PK-not-hwp-at-all-padding-here-123456')).isHwp)
      .toBe(false)
    expect(parseHwpFileHeader(new Uint8Array(4)).isHwp).toBe(false)
  })
})

describe('iterateHwpRecords', () => {
  test('unpacks tag/level/size and walks multiple records', () => {
    const stream = concat([
      buildRecord(66, 0, new Uint8Array(3)),
      buildRecord(HWPTAG_PARA_TEXT, 1, utf16(textUnits('ab')))
    ])
    const records = [...iterateHwpRecords(stream)]
    expect(records.map((record) => record.tagId)).toEqual([66, HWPTAG_PARA_TEXT])
    expect(records[0]!.level).toBe(0)
    expect(records[1]!.payload.length).toBe(4)
  })

  test('handles the extended (0xFFF) size path', () => {
    const big = new Uint8Array(0x1200).fill(7)
    const records = [...iterateHwpRecords(buildRecord(66, 0, big))]
    expect(records).toHaveLength(1)
    expect(records[0]!.payload.length).toBe(0x1200)
  })

  test('a truncated tail ends iteration without throwing', () => {
    const record = buildRecord(66, 0, new Uint8Array(10))
    expect([...iterateHwpRecords(record.subarray(0, 7))]).toHaveLength(0)
    expect([...iterateHwpRecords(record.subarray(0, 2))]).toHaveLength(0)
  })
})

describe('extractParaText (제어문자 유닛 테이블)', () => {
  test('keeps plain text and korean', () => {
    expect(extractParaText(utf16(textUnits('항공역학 A+')))).toBe('항공역학 A+')
  })

  test('tab and breaks are single units', () => {
    expect(extractParaText(utf16([...textUnits('a'), 9, ...textUnits('b'), 13])))
      .toBe('a\tb\n')
    expect(extractParaText(utf16([...textUnits('x'), 10, ...textUnits('y')])))
      .toBe('x\ny')
  })

  test('inline/extended controls consume 8 units', () => {
    // 코드 4 + 7유닛 페이로드(본문처럼 보이는 값 포함) 뒤의 텍스트만 남는다.
    const payload = utf16([
      ...textUnits('앞'),
      4, 0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777,
      ...textUnits('뒤')
    ])
    expect(extractParaText(payload)).toBe('앞뒤')
  })

  test('char controls (0, 24-31) consume one unit', () => {
    expect(extractParaText(utf16([...textUnits('a'), 0, 24, 31, ...textUnits('b')])))
      .toBe('ab')
  })

  test('surrogate pairs pass through', () => {
    const emoji = '𝛼' // U+1D6FC, 서로게이트 쌍
    const units = [emoji.charCodeAt(0), emoji.charCodeAt(1)]
    expect(extractParaText(utf16(units))).toBe(emoji)
  })
})

describe('extractSectionText', () => {
  test('joins PARA_TEXT records and ignores other tags', () => {
    const stream = concat([
      buildRecord(66, 0, new Uint8Array(8)),
      buildRecord(HWPTAG_PARA_TEXT, 1, utf16(textUnits('첫 문단'))),
      buildRecord(70, 1, new Uint8Array(2)),
      buildRecord(HWPTAG_PARA_TEXT, 1, utf16(textUnits('둘째 문단')))
    ])
    expect(extractSectionText(stream)).toBe('첫 문단\n둘째 문단')
  })
})
