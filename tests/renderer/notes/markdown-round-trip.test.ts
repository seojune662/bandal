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
    ]
  ])('%s stays stable after editing and reopening', (_name, markdown, fragments) => {
    expectStable(markdown, fragments)
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
