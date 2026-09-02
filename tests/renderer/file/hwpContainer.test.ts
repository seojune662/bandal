import { deflateRawSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
  HwpUnsupportedError,
  inflateRawDeflate,
  readHwpText
} from '../../../src/renderer/src/features/file/hwp/hwpContainer'
import { HWPTAG_PARA_TEXT } from '../../../src/renderer/src/features/file/hwp/parseHwp'

function hwpFileHeader(flags: number): Uint8Array {
  const bytes = new Uint8Array(256)
  bytes.set(new TextEncoder().encode('HWP Document File'))
  new DataView(bytes.buffer).setUint32(36, flags, true)
  return bytes
}

function paraTextRecord(text: string): Uint8Array {
  const payload = new Uint8Array(text.length * 2)
  const view = new DataView(payload.buffer)
  Array.from(text).forEach((char, index) =>
    view.setUint16(index * 2, char.charCodeAt(0), true)
  )
  const record = new Uint8Array(4 + payload.length)
  new DataView(record.buffer).setUint32(
    0,
    HWPTAG_PARA_TEXT | (payload.length << 20),
    true
  )
  record.set(payload, 4)
  return record
}

async function buildHwp(flags: number, section: Uint8Array): Promise<Uint8Array> {
  // 실제 .hwp 와 같은 CFB 컨테이너를 벤더 xlsx 의 CFB 로 조립한다 —
  // 이 왕복이 깨지면 벤더 교체가 CFB export 를 떨어뜨렸다는 뜻이다.
  const { CFB } = (await import('xlsx')) as unknown as {
    CFB: {
      utils: {
        cfb_new(): unknown
        cfb_add(cfb: unknown, path: string, content: Uint8Array): void
      }
      write(cfb: unknown, options: { type: 'buffer' }): Uint8Array
    }
  }
  const container = CFB.utils.cfb_new()
  CFB.utils.cfb_add(container, '/FileHeader', hwpFileHeader(flags))
  CFB.utils.cfb_add(container, '/BodyText/Section0', section)
  return new Uint8Array(CFB.write(container, { type: 'buffer' }))
}

describe('inflateRawDeflate', () => {
  test('round-trips node:zlib raw deflate output', async () => {
    const original = new TextEncoder().encode(
      '한글 문서 본문 텍스트 round trip — HWP 섹션은 raw deflate 다.'
    )
    const compressed = new Uint8Array(deflateRawSync(original))
    const inflated = await inflateRawDeflate(compressed)
    expect(new TextDecoder().decode(inflated)).toBe(
      new TextDecoder().decode(original)
    )
  })

  test('rejects on garbage input', async () => {
    await expect(
      inflateRawDeflate(Uint8Array.from([1, 2, 3, 4, 5]))
    ).rejects.toThrow()
  })
})

describe('readHwpText (CFB 왕복 — 벤더 xlsx CFB 핀 고정)', () => {
  test('reads a compressed body section', async () => {
    const section = paraTextRecord('한글 본문 추출 확인')
    const compressed = new Uint8Array(deflateRawSync(section))
    const file = await buildHwp(0b1, compressed)
    expect(await readHwpText(file)).toBe('한글 본문 추출 확인')
  })

  test('reads an uncompressed body section', async () => {
    const file = await buildHwp(0, paraTextRecord('무압축 본문'))
    expect(await readHwpText(file)).toBe('무압축 본문')
  })

  test('rejects passworded documents distinctly', async () => {
    const file = await buildHwp(0b10, paraTextRecord('x'))
    await expect(readHwpText(file)).rejects.toBeInstanceOf(HwpUnsupportedError)
  })
})
