import { describe, expect, test, vi } from 'vitest'
import {
  createPageDriver,
  verdictFor,
  PAGE_SCRIPT_TIMEOUT_MS,
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

const SELECT_FACTS = {
  tag: 'select',
  type: null,
  inNonGetForm: false,
  href: null,
  disabled: false
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
      facts: null,
      problem: '그 프레임을 찾지 못했어요.'
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

  test('selects by label when the option value is a code', async () => {
    const options = [{ value: '2026-2', label: '2026학년도 2학기' }]
    const target = frame({
      ok: true,
      facts: SELECT_FACTS,
      problem: null,
      options
    })
    const driver = createPageDriver({
      frames: () => [target],
      currentUrl: () => PAGE.url
    })

    expect(
      await driver.act(0, 0, {
        kind: 'select',
        value: '2026학년도 2학기'
      })
    ).toEqual({ ok: true, facts: SELECT_FACTS, problem: null, options })

    const source = (target.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    expect(source).toContain("(option.textContent || '').trim() === wantedLabel")
    expect(source).toContain('target.selectedIndex = selectedIndex')
  })

  test('selects labels whose whitespace is irregular', async () => {
    const target = frame({
      ok: true,
      facts: SELECT_FACTS,
      problem: null,
      options: [{ value: '2026-2', label: '2026학년도  2학기' }]
    })
    const driver = createPageDriver({
      frames: () => [target],
      currentUrl: () => PAGE.url
    })

    await driver.act(0, 0, {
      kind: 'select',
      value: '2026학년도 2학기'
    })
    const source = (target.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    expect(source).toContain("wanted.replace(/\\s+/g, '')")
    expect(source).toContain("(option.textContent || '').replace(/\\s+/g, '')")
  })

  test('a missing select value fails and returns the available options', async () => {
    const options = [
      { value: '2026-1', label: '2026학년도 1학기' },
      { value: '2026-2', label: '2026학년도 2학기' }
    ]
    const target = frame({
      ok: false,
      facts: SELECT_FACTS,
      problem: '그 값을 고를 수 없어요.',
      options
    })
    const driver = createPageDriver({
      frames: () => [target],
      currentUrl: () => PAGE.url
    })

    expect(
      await driver.act(0, 0, { kind: 'select', value: '없는 학기' })
    ).toEqual({
      ok: false,
      facts: SELECT_FACTS,
      problem: '그 값을 고를 수 없어요.',
      options
    })

    const source = (target.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    expect(source).toContain('selectOptions.slice(0, 200)')
    expect(source).toContain("trim().slice(0, 100)")
  })

  test('selecting a non-select element fails', async () => {
    const facts = { ...SELECT_FACTS, tag: 'input' }
    const target = frame({
      ok: false,
      facts,
      problem: 'select 요소가 아니에요.'
    })
    const driver = createPageDriver({
      frames: () => [target],
      currentUrl: () => PAGE.url
    })

    expect(
      await driver.act(0, 0, { kind: 'select', value: '2026-2' })
    ).toEqual({
      ok: false,
      facts,
      problem: 'select 요소가 아니에요.'
    })

    const source = (target.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    expect(source).toContain("if (target.tagName !== 'SELECT')")
  })

  test('a successful select dispatches both input and change events', async () => {
    const target = frame({
      ok: true,
      facts: SELECT_FACTS,
      problem: null,
      options: []
    })
    const driver = createPageDriver({
      frames: () => [target],
      currentUrl: () => PAGE.url
    })

    await driver.act(0, 0, { kind: 'select', value: '2026-2' })
    const source = (target.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    const selectSource = source.slice(
      source.indexOf("if (input.action.kind === 'select')")
    )
    expect(selectSource).toContain("dispatchEvent(new Event('input'")
    expect(selectSource).toContain("dispatchEvent(new Event('change'")
    expect(selectSource.indexOf("new Event('input'")).toBeLessThan(
      selectSource.indexOf("new Event('change'")
    )
  })

  test('type reports a failure when the value is not reflected', async () => {
    const target = frame({
      ok: false,
      facts: { ...SELECT_FACTS, tag: 'input', type: 'text' },
      problem: '입력이 반영되지 않았어요.'
    })
    const driver = createPageDriver({
      frames: () => [target],
      currentUrl: () => PAGE.url
    })

    expect(await driver.act(0, 0, { kind: 'type', text: '해시' })).toEqual({
      ok: false,
      facts: { ...SELECT_FACTS, tag: 'input', type: 'text' },
      problem: '입력이 반영되지 않았어요.'
    })

    const source = (target.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    expect(source).toContain('if (target.value !== input.action.text)')
  })

  test('a thrown execution is a failure, not a crash', async () => {
    const driver = createPageDriver({
      frames: () => [frame(null, true)],
      currentUrl: () => PAGE.url
    })
    expect(await driver.act(0, 0, { kind: 'click' })).toEqual({
      ok: false,
      facts: null,
      problem: '페이지에서 실행하지 못했어요.'
    })
  })
})

describe('pageDriver viewport actions', () => {
  test('scrolls the main frame by a viewport-sized step', async () => {
    const target = frame({ ok: true, facts: null, problem: null })
    const driver = createPageDriver({
      frames: () => [target],
      currentUrl: () => PAGE.url
    })
    expect((await driver.scroll({ kind: 'down' })).ok).toBe(true)
    const source = (target.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string
    expect(source).toContain('window.innerHeight * 0.8')
    expect(source).toContain('window.scrollBy')
  })

  test('scroll-to-ref and hover use the frame and target ordinal', async () => {
    const first = frame({ ok: true, facts: null, problem: null })
    const second = frame({ ok: true, facts: null, problem: null })
    const driver = createPageDriver({
      frames: () => [first, second],
      currentUrl: () => PAGE.url
    })
    await driver.scroll({ kind: 'ref', frameIndex: 1, elementIndex: 4 })
    await driver.hover(1, 4)
    expect(first.executeJavaScript).not.toHaveBeenCalled()
    const sources = (second.executeJavaScript as ReturnType<typeof vi.fn>).mock
      .calls.map((call) => call[0] as string)
    expect(sources[0]).toContain('scrollIntoView')
    expect(sources[1]).toContain("'pointerover', 'mouseover', 'mouseenter'")
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

describe('pageSurface typing path', () => {
  test('regression: insertText must actually be reachable', async () => {
    // v0.17.0 shipped a CDP module whose PRIMARY justification —
    // `Input.insertText` for Hangul — had no caller, so the bundler removed
    // it entirely. Unit tests passed because they exercised the function in
    // isolation; only grepping the built asar caught it.
    const { createPageSurface } = await import(
      '../../../src/main/features/browserAgent/pageSurface'
    )
    const insertText = vi.fn(async () => undefined)
    const executed: string[] = []
    const surface = createPageSurface({
      resolveGuest: () => ({}) as never,
      framesOf: () => [
        {
          executeJavaScript: async (code: string) => {
            executed.push(code)
            return { ok: true, facts: null }
          }
        }
      ],
      requestTab: async () => 't1',
      settle: async () => undefined,
      requestActivateTab: () => undefined,
      awaitTabRegister: async () => true,
      sendKey: async () => undefined,
      history: async () => undefined,
      tabLifecycle: async () => true,
      findInPage: async () => 0,
      generations: { current: () => 1 } as never,
      insertText,
      run: {
        assertLive: () => undefined,
        step: () => undefined,
        wait: () => undefined,
        awaitResume: async () => 'resumed' as const
      }
    })

    expect(
      (await surface.act('t1', 0, 0, { kind: 'type', text: '해시' })).ok
    ).toBe(true)
    expect(insertText).toHaveBeenCalledWith('t1', '해시')
  })

  test('falls back to the DOM tier when the debugger is unavailable', async () => {
    // A student with DevTools open must still be able to use the agent.
    const { createPageSurface } = await import(
      '../../../src/main/features/browserAgent/pageSurface'
    )
    let calls = 0
    const surface = createPageSurface({
      resolveGuest: () => ({}) as never,
      framesOf: () => [
        {
          executeJavaScript: async () => {
            calls += 1
            return { ok: true, facts: null }
          }
        }
      ],
      requestTab: async () => 't1',
      settle: async () => undefined,
      requestActivateTab: () => undefined,
      awaitTabRegister: async () => true,
      sendKey: async () => undefined,
      history: async () => undefined,
      tabLifecycle: async () => true,
      findInPage: async () => 0,
      generations: { current: () => 1 } as never,
      insertText: async () => {
        throw new Error('debugger already attached')
      },
      run: {
        assertLive: () => undefined,
        step: () => undefined,
        wait: () => undefined,
        awaitResume: async () => 'resumed' as const
      }
    })

    expect(
      (await surface.act('t1', 0, 0, { kind: 'type', text: '해시' })).ok
    ).toBe(true)
    // Focus attempt + the real DOM-tier write.
    expect(calls).toBe(2)
  })
})

describe('a page that never answers', () => {
  test('rejects instead of hanging forever', async () => {
    // A guest showing a native alert() blocks its renderer, so
    // executeJavaScript never settles. With no timeout, every later tool call
    // on that tab hung with it — the agent did not fail, it stopped existing.
    vi.useFakeTimers()
    try {
      const stuck: DriverFrame = {
        executeJavaScript: () => new Promise(() => undefined)
      }
      const driver = createPageDriver({
        frames: () => [stuck],
        currentUrl: () => 'https://portal.ac.kr/'
      })
      const pending = driver.read(1000)
      await vi.advanceTimersByTimeAsync(PAGE_SCRIPT_TIMEOUT_MS + 100)
      // read() swallows failures into empty text; the point is that it RETURNS.
      await expect(pending).resolves.toEqual({
        url: 'https://portal.ac.kr/',
        text: ''
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('a script that answers in time is untouched', async () => {
    const quick: DriverFrame = {
      executeJavaScript: async () => ({
        url: 'https://portal.ac.kr/',
        text: '본문'
      })
    }
    const driver = createPageDriver({
      frames: () => [quick],
      currentUrl: () => 'https://portal.ac.kr/'
    })
    expect((await driver.read(1000)).text).toBe('본문')
  })
})
