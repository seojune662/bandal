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

describe('renderSnapshot', () => {
  test('one line per element, carrying the ref and the target', () => {
    expect(renderSnapshot([frame([element()])], 3)).toBe(
      'f0:e0@3 link "3주차 강의자료" → /mod/resource/view.php?id=88213'
    )
  })

  test('the generation is in every ref, so a stale one is detectable', () => {
    const out = renderSnapshot([frame([element(), element({ index: 1 })])], 7)
    expect(out.split('\n').every((line) => line.includes('@7'))).toBe(true)
  })

  test('frames are distinguished — iframes are where SSO and LMS players live', () => {
    const out = renderSnapshot(
      [frame([element()]), frame([element({ name: '로그인' })], 2)],
      1
    )
    expect(out).toContain('f0:e0@1')
    expect(out).toContain('f2:e0@1')
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
    expect(out).toContain('일부만 표시')
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
    expect(renderSnapshot([frame([])], 1)).toBe('')
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
      "'a[href], button, input, select, textarea, h1, h2, h3'"
    )
  })

  test('is bounded page-side too, not only when rendering', () => {
    expect(SNAPSHOT_SOURCE).toContain('MAX_ELEMENTS')
  })
})
