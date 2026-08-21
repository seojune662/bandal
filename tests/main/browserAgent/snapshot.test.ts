import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SNAPSHOT_CHARS,
  MAX_SNAPSHOT_CHARS,
  renderSnapshot,
  SNAPSHOT_SOURCE,
  type FrameSnapshot,
  type SnapshotElement
} from '../../../src/main/features/browserAgent/snapshot'

function element(over: Partial<SnapshotElement> = {}): SnapshotElement {
  return {
    index: 0,
    role: 'link',
    name: '3주차 강의자료',
    href: '/mod/resource/view.php?id=88213',
    tag: 'a',
    type: null,
    inNonGetForm: false,
    disabled: false,
    value: null,
    required: false,
    ...over
  }
}

function frame(elements: SnapshotElement[], frameIndex = 0): FrameSnapshot {
  return { frameIndex, url: 'https://myetl.snu.ac.kr/courses/1', elements }
}

interface FakeElement {
  tagName: string
  textContent: string
  value?: string
  disabled?: boolean
  required?: boolean
  options?: FakeElement[]
  previousSibling: FakeElement | null
  previousElementSibling: FakeElement | null
  parentElement: FakeElement | null
  getAttribute: (name: string) => string | null
  hasAttribute: (name: string) => boolean
  closest: (selector: string) => FakeElement | null
  getBoundingClientRect: () => { width: number; height: number }
}

function fakeElement(
  tagName: string,
  textContent: string,
  attributes: Record<string, string> = {}
): FakeElement {
  return {
    tagName: tagName.toUpperCase(),
    textContent,
    previousSibling: null,
    previousElementSibling: null,
    parentElement: null,
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => attributes[name] !== undefined,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 20 })
  }
}

function runCollector(elements: FakeElement[]): {
  url: string
  elements: SnapshotElement[]
  omittedElementCount: number
  selector: string
} {
  let selector = ''
  const document = {
    querySelectorAll: (value: string) => {
      selector = value
      return elements
    },
    querySelector: () => null,
    getElementById: () => null
  }
  const window = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
  }
  const collect = new Function(
    'window',
    'document',
    'location',
    'CSS',
    `return ${SNAPSHOT_SOURCE}`
  ) as (
    window: object,
    document: object,
    location: object,
    css: object
  ) => Omit<ReturnType<typeof runCollector>, 'selector'>
  const result = collect(
    window,
    document,
    { href: 'https://portal.example.ac.kr/main' },
    { escape: (value: string) => value }
  )
  return { ...result, selector }
}

describe('renderSnapshot', () => {
  test('one line per element, carrying the ref and the target', () => {
    expect(renderSnapshot([frame([element()])], 3)).toBe(
      '[f0] https://myetl.snu.ac.kr/courses/1 (요소 1개)\n' +
        'f0:e0@3 link "3주차 강의자료" → /mod/resource/view.php?id=88213'
    )
  })

  test('the generation is in every ref, so a stale one is detectable', () => {
    const out = renderSnapshot([frame([element(), element({ index: 1 })])], 7)
    expect(
      out
        .split('\n')
        .filter((line) => line.startsWith('f'))
        .every((line) => line.includes('@7'))
    ).toBe(true)
  })

  test('frames are distinguished — iframes are where SSO and LMS players live', () => {
    const out = renderSnapshot(
      [
        frame([element()]),
        {
          ...frame([element({ name: '로그인' })], 2),
          url: 'https://sso.snu.ac.kr/login'
        }
      ],
      1
    )
    expect(out).toContain('f0:e0@1')
    expect(out).toContain('f2:e0@1')
    expect(out).toContain('[f2] https://sso.snu.ac.kr/login (요소 1개)')
  })

  test('flags the things an action needs to know', () => {
    const out = renderSnapshot(
      [
        frame([
          element({
            role: 'textbox',
            tag: 'input',
            type: 'text',
            name: '아이디',
            href: null,
            required: true
          })
        ])
      ],
      1
    )
    expect(out).toContain('textbox "아이디"')
    expect(out).toContain('required')
  })

  test('never renders a password value, only that it is one', () => {
    const out = renderSnapshot(
      [
        frame([
          element({
            role: 'textbox',
            tag: 'input',
            type: 'password',
            name: '비밀번호',
            href: null,
            value: null
          })
        ])
      ],
      1
    )
    expect(out).toContain('password')
    expect(out).not.toContain('value=')
  })

  test('says when it truncated instead of implying it saw everything', () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      element({ index, name: `항목 ${index} `.repeat(4) })
    )
    const out = renderSnapshot([frame(many)], 1, 800)
    expect(out.length).toBeLessThanOrEqual(900)
    expect(out).toMatch(/요소 \d+개를 더 보여주지 못했어요/)
  })

  test('respects the cap and clamps an absurd request', () => {
    const many = Array.from({ length: 4000 }, (_, index) =>
      element({ index, name: `항목 ${index}` })
    )
    const huge = renderSnapshot([frame(many)], 1, 10_000_000)
    expect(huge.length).toBeLessThanOrEqual(MAX_SNAPSHOT_CHARS + 200)
  })

  test('an empty page renders empty, not an error', () => {
    expect(renderSnapshot([], 1)).toBe('')
    expect(renderSnapshot([frame([])], 1)).toBe(
      '[f0] https://myetl.snu.ac.kr/courses/1 (요소 0개)'
    )
  })

  test('renders select options and keeps portal codes next to their labels', () => {
    const out = renderSnapshot(
      [
        frame([
          element({
            role: 'select',
            tag: 'select',
            href: null,
            name: '학기',
            value: 'U000200001',
            options: [
              { label: '1학기', value: 'U000200001' },
              { label: '2026', value: '2026' }
            ],
            optionCount: 24
          })
        ])
      ],
      3
    )

    expect(out).toContain('[옵션 1학기=U000200001 | 2026 | …외 22개]')
    expect(out).toContain('(value="U000200001")')
  })

  test('announces the exact page-side element omission count', () => {
    const out = renderSnapshot(
      [{ ...frame([element()]), omittedElementCount: 17 }],
      1
    )
    expect(out).toContain('(이 프레임에서 17개 더 있는데 생략했어요)')
  })

  test('shows each frame URL and counts whole frames lost to the character budget', () => {
    const first = {
      ...frame([element({ name: '아주 긴 항목 '.repeat(50) })]),
      url: 'https://portal.example.ac.kr/main'
    }
    const second = { ...frame([element()], 1), url: 'https://sso.snu.ac.kr/login' }
    const third = { ...frame([element()], 2), url: '' }
    const out = renderSnapshot([first, second, third], 1, 500)

    expect(out).toContain('[f0] https://portal.example.ac.kr/main')
    expect(out).toContain('프레임 2개를 더 보여주지 못했어요')
  })

  test('the default budget is well under the hard cap', () => {
    expect(DEFAULT_SNAPSHOT_CHARS).toBeLessThan(MAX_SNAPSHOT_CHARS)
  })
})

describe('SNAPSHOT_SOURCE', () => {
  test('never reads a password field value', () => {
    // The collector runs inside the page; this is the line that keeps a
    // password out of the model's context entirely.
    expect(SNAPSHOT_SOURCE).toContain("type === 'password' ? null")
  })

  test('collects only actionable elements, not every node', () => {
    // An outline that lists every <div> is the DOM dump this avoids.
    expect(SNAPSHOT_SOURCE).toContain(
      "'a, button, input, select, textarea, h1, h2, h3, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [onclick], label, summary'"
    )
  })

  test('is bounded page-side too, not only when rendering', () => {
    expect(SNAPSHOT_SOURCE).toContain('MAX_ELEMENTS')
  })

  test('collects an href-less onclick anchor and drops nameless noise', () => {
    const search = fakeElement('a', '검색', { onclick: 'fnSearch()' })
    const noise = fakeElement('div', '', { onclick: 'track()' })
    const result = runCollector([search, noise])

    expect(result.selector.split(', ')).toContain('a')
    expect(result.elements).toHaveLength(1)
    expect(result.elements[0]).toMatchObject({
      tag: 'a',
      role: 'link',
      name: '검색',
      href: null
    })
  })

  test('names an unlabelled select from the preceding th-td cell', () => {
    const headingCell = fakeElement('th', '학기')
    const valueCell = fakeElement('td', '')
    valueCell.previousElementSibling = headingCell
    const select = fakeElement('select', '', { name: 'schyy' })
    select.parentElement = valueCell
    select.value = 'U000200001'
    select.options = [
      Object.assign(fakeElement('option', '1학기'), { value: 'U000200001' }),
      Object.assign(fakeElement('option', '2학기'), { value: 'U000200002' })
    ]

    const [collected] = runCollector([select]).elements
    expect(collected?.name).toBe('학기')
    expect(collected?.options).toEqual([
      { label: '1학기', value: 'U000200001' },
      { label: '2학기', value: 'U000200002' }
    ])
  })

  test('keeps only the first 20 select options and truncates labels at 60 chars', () => {
    const select = fakeElement('select', '', { 'aria-label': '학년도' })
    select.value = '2000'
    select.options = Array.from({ length: 22 }, (_, index) =>
      Object.assign(fakeElement('option', `${index}`.repeat(80)), {
        value: `${2000 + index}`
      })
    )

    const [collected] = runCollector([select]).elements
    expect(collected?.options).toHaveLength(20)
    expect(collected?.options?.every(({ label }) => label.length <= 60)).toBe(true)
    expect(collected?.optionCount).toBe(22)
    expect(renderSnapshot([frame([collected!])], 1)).toContain('…외 2개')
  })

  test('caps collection at 250 elements and reports the exact remainder', () => {
    const links = Array.from({ length: 253 }, (_, index) =>
      fakeElement('a', `메뉴 ${index}`, { href: `/menu/${index}` })
    )
    const collected = runCollector(links)

    expect(collected.elements).toHaveLength(250)
    expect(collected.omittedElementCount).toBe(3)
    const out = renderSnapshot(
      [
        {
          frameIndex: 0,
          url: collected.url,
          elements: collected.elements,
          omittedElementCount: collected.omittedElementCount
        }
      ],
      1,
      MAX_SNAPSHOT_CHARS
    )
    expect(out).toContain('(이 프레임에서 3개 더 있는데 생략했어요)')
  })
})
