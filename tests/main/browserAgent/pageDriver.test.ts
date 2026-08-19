import { describe, expect, test, vi } from 'vitest'
import {
  createPageDriver,
  verdictFor,
  type DriverFrame
} from '../../../src/main/features/browserAgent/pageDriver'

function frame(result: unknown, fail = false): DriverFrame {
  return {
    executeJavaScript: vi.fn(async () => {
      if (fail) throw new Error('cross-origin')
      return result
    })
  }
}

const PAGE = {
  url: 'https://myetl.snu.ac.kr/courses/1',
  elements: [
    {
      index: 0,
      role: 'link',
      name: '3주차 강의자료',
      href: '/files/1.pdf',
      tag: 'a',
      type: null,
      inNonGetForm: false,
      disabled: false,
      value: null,
      required: false
    }
  ]
}

describe('pageDriver.snapshot', () => {
  test('renders the outline with refs at the current generation', async () => {
    const driver = createPageDriver({
      frames: () => [frame(PAGE)],
      currentUrl: () => PAGE.url
    })
    const result = await driver.snapshot(4)
    expect(result.outline).toContain('f0:e0@4 link "3주차 강의자료"')
    expect(result.url).toBe(PAGE.url)
  })

  test('covers subframes — SSO and LMS players live in iframes', async () => {
    const driver = createPageDriver({
      frames: () => [
        frame(PAGE),
        frame({ url: 'https://sso.ac.kr/', elements: [{ ...PAGE.elements[0], name: '로그인' }] })
      ],
      currentUrl: () => PAGE.url
    })
    const result = await driver.snapshot(1)
    expect(result.outline).toContain('f0:e0@1')
    expect(result.outline).toContain('f1:e0@1')
  })

  test('a frame we cannot script is omitted, not an error', async () => {
    // Otherwise every page with a cross-origin ad frame looks broken.
    const driver = createPageDriver({
      frames: () => [frame(PAGE), frame(null, true)],
      currentUrl: () => PAGE.url
    })
    const result = await driver.snapshot(1)
    expect(result.frames).toHaveLength(1)
    expect(result.outline).toContain('f0:e0@1')
  })

  test('junk from the page does not crash the outline', async () => {
    const driver = createPageDriver({
      frames: () => [frame({ url: 5, elements: [null, 'x', {}] })],
      currentUrl: () => PAGE.url
    })
    const result = await driver.snapshot(1)
    expect(result.frames[0]?.elements).toHaveLength(1) // only the {} survives
  })
})

describe('pageDriver.read', () => {
  test('returns page text, capped', async () => {
    const driver = createPageDriver({
      frames: () => [frame({ url: PAGE.url, text: 'x'.repeat(5000) })],
      currentUrl: () => PAGE.url
    })
    const result = await driver.read(1000)
    expect(result.text).toHaveLength(1000)
  })

  test('a failure is empty text, not a throw', async () => {
    const driver = createPageDriver({
      frames: () => [frame(null, true)],
      currentUrl: () => PAGE.url
    })
    expect((await driver.read(1000)).text).toBe('')
  })

  test('no frames at all is empty, not a crash', async () => {
    const driver = createPageDriver({
      frames: () => [],
      currentUrl: () => PAGE.url
    })
    expect((await driver.read(100)).text).toBe('')
  })
})

describe('pageDriver.act', () => {
  test('runs in the frame the ref names', async () => {
    const first = frame({ ok: true, facts: null })
    const second = frame({ ok: true, facts: null })
    const driver = createPageDriver({
      frames: () => [first, second],
      currentUrl: () => PAGE.url
    })
    await driver.act(1, 3, { kind: 'click' })
    expect(first.executeJavaScript).not.toHaveBeenCalled()
    expect(second.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  test('an out-of-range frame fails rather than falling back to frame 0', async () => {
    // Falling back would act on a different document entirely.
    const only = frame({ ok: true, facts: null })
    const driver = createPageDriver({
      frames: () => [only],
      currentUrl: () => PAGE.url
    })
    expect(await driver.act(9, 0, { kind: 'click' })).toEqual({
      ok: false,
      facts: null
    })
    expect(only.executeJavaScript).not.toHaveBeenCalled()
  })

  test('uses the native value setter so framework inputs update', async () => {
    const target = frame({ ok: true, facts: null })
    const driver = createPageDriver({
      frames: () => [target],
      currentUrl: () => PAGE.url
    })
    await driver.act(0, 0, { kind: 'type', text: '해시' })
    const source = (target.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    expect(source).toContain('getOwnPropertyDescriptor')
    expect(source).toContain("dispatchEvent(new Event('input'")
  })

  test('a thrown execution is a failure, not a crash', async () => {
    const driver = createPageDriver({
      frames: () => [frame(null, true)],
      currentUrl: () => PAGE.url
    })
    expect((await driver.act(0, 0, { kind: 'click' })).ok).toBe(false)
  })
})

describe('verdictFor', () => {
  const link = {
    tag: 'a',
    type: null,
    inNonGetForm: false,
    href: '/x',
    disabled: false
  }

  test('routes each action kind to its own policy', () => {
    expect(verdictFor('click', link).allowed).toBe(true)
    expect(verdictFor('type', link).allowed).toBe(false)
    expect(verdictFor('select', link).allowed).toBe(false)
  })

  test('a password field is refused whatever the caller asks', () => {
    const password = { ...link, tag: 'input', type: 'password' }
    expect(verdictFor('type', password).allowed).toBe(false)
  })
})
