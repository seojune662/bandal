import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'vitest'
import {
  attachJsonlStream,
  createStderrRing
} from '../../../src/main/features/agent/jsonlStream'

function setup(options: { maxLineBytes?: number; maxConsecutiveMalformed?: number } = {}): {
  input: PassThrough
  received: unknown[]
  limitDetails: string[]
  write: (text: string) => Promise<void>
} {
  const input = new PassThrough()
  const received: unknown[] = []
  const limitDetails: string[] = []
  attachJsonlStream(input, {
    ...options,
    onJson: (value) => received.push(value),
    onMalformedLimit: (detail) => limitDetails.push(detail)
  })
  return {
    input,
    received,
    limitDetails,
    write: async (text: string) => {
      input.write(text)
      // let readline's line events fire
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

describe('attachJsonlStream', () => {
  test('parses one JSON value per line', async () => {
    const ctx = setup()
    await ctx.write('{"a":1}\n{"b":2}\n')
    expect(ctx.received).toEqual([{ a: 1 }, { b: 2 }])
  })

  test('handles a JSON line split across chunks', async () => {
    const ctx = setup()
    await ctx.write('{"type":"stream_')
    await ctx.write('event","n":7}\n')
    expect(ctx.received).toEqual([{ type: 'stream_event', n: 7 }])
  })

  test('skips empty lines without counting them as malformed', async () => {
    const ctx = setup({ maxConsecutiveMalformed: 1 })
    await ctx.write('\n\n{"ok":true}\n')
    expect(ctx.received).toEqual([{ ok: true }])
    expect(ctx.limitDetails).toHaveLength(0)
  })

  test('recovers when malformed lines stay below the limit', async () => {
    const ctx = setup()
    await ctx.write('garbage\nnot json\n{"ok":1}\nmore garbage\n{"ok":2}\n')
    expect(ctx.received).toEqual([{ ok: 1 }, { ok: 2 }])
    expect(ctx.limitDetails).toHaveLength(0)
  })

  test('reports after 5 consecutive malformed lines, exactly once', async () => {
    const ctx = setup()
    await ctx.write('a\nb\nc\nd\ne\nf\ng\n')
    expect(ctx.limitDetails).toHaveLength(1)
    expect(ctx.limitDetails[0]).toContain('unparseable')
  })

  test('stops delivering JSON after the malformed limit is hit', async () => {
    const ctx = setup()
    await ctx.write('a\nb\nc\nd\ne\n{"late":true}\n')
    expect(ctx.limitDetails).toHaveLength(1)
    expect(ctx.received).toEqual([])
  })

  test('counts oversized lines as malformed', async () => {
    const ctx = setup({ maxLineBytes: 32, maxConsecutiveMalformed: 1 })
    await ctx.write(`${JSON.stringify({ big: 'x'.repeat(100) })}\n`)
    expect(ctx.received).toEqual([])
    expect(ctx.limitDetails).toHaveLength(1)
    expect(ctx.limitDetails[0]).toContain('exceeds')
  })

  test('a valid line resets the consecutive-malformed counter', async () => {
    const ctx = setup()
    await ctx.write('a\nb\nc\nd\n{"ok":1}\na\nb\nc\nd\n{"ok":2}\n')
    expect(ctx.limitDetails).toHaveLength(0)
    expect(ctx.received).toEqual([{ ok: 1 }, { ok: 2 }])
  })
})

describe('createStderrRing', () => {
  test('keeps only the last N lines', () => {
    const ring = createStderrRing(3)
    ring.push('one\ntwo\nthree\nfour\n')
    expect(ring.tail()).toBe('two\nthree\nfour')
  })

  test('joins partial chunks into lines', () => {
    const ring = createStderrRing()
    ring.push('Error: some')
    ring.push('thing broke\nnext line\n')
    expect(ring.tail()).toBe('Error: something broke\nnext line')
  })

  test('includes a trailing unterminated line in the tail', () => {
    const ring = createStderrRing()
    ring.push('done\npartial tail')
    expect(ring.tail()).toBe('done\npartial tail')
  })
})
