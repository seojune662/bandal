import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import {
  createMarkdownCodec,
  type MarkdownCodec
} from '../../../src/renderer/src/features/notes/markdownCodec'

let codec: MarkdownCodec

beforeAll(async () => {
  // Milkdown timers use browser-global events. A private EventTarget keeps the
  // headless Node test faithful without bringing in a DOM implementation.
  const events = new EventTarget()
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events))
  vi.useFakeTimers()
  codec = await createMarkdownCodec()
  vi.clearAllTimers()
})

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function expectStable(markdown: string, expectedFragments: string[]): void {
  // The first pass represents opening and editing a note. Once Milkdown has
  // serialized it, every following parse/serialize pass must be identical.
  const afterEdit = codec.serialize(codec.parse(markdown))
  const afterReopen = codec.serialize(codec.parse(afterEdit))
  expect(afterReopen).toBe(afterEdit)
  for (const fragment of expectedFragments) {
    expect(afterEdit).toContain(fragment)
  }
}

describe('note markdown round trip', () => {
  test.each([
    ['headings', '# Title\n\n## Lecture\n\n### Detail\n', ['# Title', '## Lecture', '### Detail']],
    [
      'lists',
      '- first\n  - nested\n- second\n\n1. one\n2. two\n',
      ['* first', '  * nested', '1. one', '2. two']
    ],
    ['task lists', '- [x] reviewed\n- [ ] practice again\n', ['* [x] reviewed', '* [ ] practice again']],
    [
      'tables',
      '| Topic | Status |\n| :-- | --: |\n| Algebra | Done |\n| Physics | Next |\n',
      ['| Topic', '| Algebra', '| Physics']
    ],
    [
      'code blocks',
      '```ts\nconst answer: number = 42\nconsole.log(answer)\n```\n',
      ['```ts', 'const answer: number = 42', '```']
    ],
    [
      'links',
      'Read [Milkdown](https://milkdown.dev "Milkdown") and <https://example.com>.\n',
      ['[Milkdown](https://milkdown.dev "Milkdown")', '<https://example.com>']
    ],
    [
      'callout with a title',
      '> [!note] 제목\n> 본문\n',
      ['> [!note] 제목\n> 본문']
    ],
    [
      'collapsed callout',
      '> [!tip]-\n> folded\n',
      ['> [!tip]-\n> folded']
    ],
    [
      'uppercase callout with a list',
      '> [!WARNING] Caps\n> - list\n',
      ['> [!WARNING] Caps\n> * list']
    ],
    [
      'ordinary quote nested in a callout',
      '> [!quote] 바깥\n> > 안쪽 인용\n',
      ['> [!quote] 바깥\n> > 안쪽 인용']
    ],
    [
      'ordinary blockquote',
      '> 일반 인용은 그대로입니다.\n',
      ['> 일반 인용은 그대로입니다.']
    ],
    [
      'wikilinks',
      '본문 [[강의 1]] 과 [[강의 1|별칭]] 그리고 [[강의 1#요약]] 및 ![[그림.png]]\n',
      ['[[강의 1]]', '[[강의 1|별칭]]', '[[강의 1#요약]]', '![[그림.png]]']
    ],
    [
      'wikilinks with a path target and both heading and alias',
      '[[notes/Chap1.md#요약|1장]] 참고\n',
      ['[[notes/Chap1.md#요약|1장]]']
    ]
  ])('%s stays stable after editing and reopening', (_name, markdown, fragments) => {
    expectStable(markdown, fragments)
  })

  test('wikilink text inside a normal link label is left untouched', () => {
    const markdown = '[[[x]] 라벨](https://example.com) 과 `[[코드]]`\n'
    const normalized = codec.normalize(markdown)
    // The label keeps its literal brackets (escaped, as before) and no
    // wikilink node is produced for either the link label or the code span.
    expect(normalized).toContain('](https://example.com)')
    expect(normalized).toContain('`[[코드]]`')
    expect(normalized).not.toContain('[[x]] 라벨](')
    expectStable(markdown, ['](https://example.com)', '`[[코드]]`'])
  })

  test('wikilinks do not become escaped brackets after a save', () => {
    // Without a dedicated node, mdast-util-to-markdown writes `\\[\\[강의]]`
    // and the link is gone on the next open.
    expect(codec.normalize('[[강의]]\n')).toBe('[[강의]]\n')
  })

  test('documented limitation: an escaped \\[[x]] is promoted on the next round trip', () => {
    // `\\[` unescapes to a literal `[` before the remark transform runs, so
    // the text `[[x]]` matches and comes back as a real wikilink. Accepted:
    // there is no unescaped form a student would want to keep as text.
    expect(codec.normalize('\\[[x]]\n')).toBe('[[x]]\n')
  })

  test('a realistic mixed lecture note stays stable', () => {
    expectStable(`# Week 4: Data structures

> Review the examples before the quiz.

## Checklist

- [x] Read the chapter
- [ ] Implement a queue

| Operation | Complexity |
| --- | ---: |
| enqueue | O(1) |
| dequeue | O(1) |

\`\`\`ts
const queue: string[] = []
queue.push('note')
\`\`\`

See [course material](https://example.com/course).
`, ['# Week 4', '* [x] Read the chapter', '| Operation', '```ts', '[course material]'])
  })
})
