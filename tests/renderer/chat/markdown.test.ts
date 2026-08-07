import { describe, expect, test } from 'vitest'
import {
  IncrementalMarkdownParser,
  isSafeLinkHref,
  parseInline,
  parseMarkdown
} from '../../../src/renderer/src/features/chat/markdown'

describe('inline parsing', () => {
  test('plain text passes through as a single text node', () => {
    expect(parseInline('그냥 텍스트')).toEqual([
      { kind: 'text', text: '그냥 텍스트' }
    ])
  })

  test('bold, italic and inline code', () => {
    const nodes = parseInline('a **bold** and *ital* and `code`')
    expect(nodes).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'bold' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'em', children: [{ kind: 'text', text: 'ital' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'code' }
    ])
  })

  test('bold wins over italic at the same position', () => {
    const nodes = parseInline('**strong**')
    expect(nodes[0]!.kind).toBe('strong')
  })

  test('markdown inside inline code is not parsed', () => {
    const nodes = parseInline('`**not bold**`')
    expect(nodes).toEqual([{ kind: 'code', text: '**not bold**' }])
  })

  test('http(s) links parse into link nodes', () => {
    const nodes = parseInline('see [docs](https://example.com/a)')
    expect(nodes[1]).toEqual({
      kind: 'link',
      href: 'https://example.com/a',
      children: [{ kind: 'text', text: 'docs' }]
    })
  })

  test('javascript: links are rejected and rendered as plain text', () => {
    const nodes = parseInline('[x](javascript:alert(1))')
    expect(nodes).toEqual([{ kind: 'text', text: '[x](javascript:alert(1))' }])
  })

  test('relative and file links are rejected', () => {
    expect(isSafeLinkHref('file:///etc/passwd')).toBe(false)
    expect(isSafeLinkHref('/relative')).toBe(false)
    expect(isSafeLinkHref('https://ok.com')).toBe(true)
    expect(isSafeLinkHref('mailto:a@b.c')).toBe(true)
  })
})

describe('block parsing', () => {
  test('blank lines split paragraphs', () => {
    const blocks = parseMarkdown('첫 문단\n\n둘째 문단')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.kind).toBe('paragraph')
    expect(blocks[1]!.kind).toBe('paragraph')
  })

  test('headings parse with level', () => {
    const blocks = parseMarkdown('## 핵심 개념')
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 2 })
  })

  test('fenced code block with language', () => {
    const blocks = parseMarkdown('```python\nprint("hi")\n```\nafter')
    expect(blocks[0]).toEqual({
      kind: 'code-block',
      lang: 'python',
      text: 'print("hi")'
    })
    expect(blocks[1]!.kind).toBe('paragraph')
  })

  test('unterminated fence (mid-stream) is treated as an open code block', () => {
    const blocks = parseMarkdown('```ts\nconst x = 1\nconst y =')
    expect(blocks).toEqual([
      { kind: 'code-block', lang: 'ts', text: 'const x = 1\nconst y =' }
    ])
  })

  test('unordered list groups consecutive items', () => {
    const blocks = parseMarkdown('- 하나\n- 둘\n- 셋')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false })
    const list = blocks[0] as Extract<
      ReturnType<typeof parseMarkdown>[number],
      { kind: 'list' }
    >
    expect(list.items).toHaveLength(3)
  })

  test('ordered list', () => {
    const blocks = parseMarkdown('1. one\n2. two')
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true })
  })

  test('blockquote and hr', () => {
    const blocks = parseMarkdown('> 인용문\n\n---')
    expect(blocks[0]!.kind).toBe('quote')
    expect(blocks[1]!.kind).toBe('hr')
  })

  test('raw HTML stays inert text (never parsed into markup)', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>')
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        children: [{ kind: 'text', text: '<script>alert(1)</script>' }]
      }
    ])
  })

  test('img/attribute injection stays inert text', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)>')
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' })
    const paragraph = blocks[0] as Extract<
      ReturnType<typeof parseMarkdown>[number],
      { kind: 'paragraph' }
    >
    expect(paragraph.children).toEqual([
      { kind: 'text', text: '<img src=x onerror=alert(1)>' }
    ])
  })
})

describe('incremental streaming parsing', () => {
  test('matches full parsing at every streamed prefix', () => {
    const parser = new IncrementalMarkdownParser()
    const text = [
      '# 제목',
      '',
      '문단 **강조**',
      '계속',
      '',
      '- 하나',
      '- 둘',
      '',
      '> 인용',
      '',
      '```ts',
      'const ticks = `three`',
      '```',
      '마무리'
    ].join('\n')

    for (let length = 1; length <= text.length; length += 1) {
      const prefix = text.slice(0, length)
      expect(parser.parse(prefix)).toEqual(parseMarkdown(prefix))
    }
  })

  test('completed blocks are parsed once while only the tail keeps growing', () => {
    let blockParseCalls = 0
    const parser = new IncrementalMarkdownParser(() => {
      blockParseCalls += 1
    })
    let text = '첫째\n\n둘째\n\n셋째\n\n마지막'
    const initial = parser.parse(text)
    const completed = initial.slice(0, 3)
    expect(blockParseCalls).toBe(4)

    const deltas = [' 문단', '이', ' 계속', ' 자란다']
    for (const delta of deltas) {
      text += delta
      parser.parse(text)
    }

    const final = parser.parse(text)
    expect(blockParseCalls).toBe(4 + deltas.length)
    expect(final.slice(0, 3)).toEqual(completed)
    for (let index = 0; index < completed.length; index += 1) {
      expect(final[index]).toBe(completed[index])
    }
  })

  test('an open code fence consumes plain deltas without reparsing its body', () => {
    let blockParseCalls = 0
    const parser = new IncrementalMarkdownParser(() => {
      blockParseCalls += 1
    })
    let text = '도입\n\n```ts\nconst value ='
    parser.parse(text)
    expect(blockParseCalls).toBe(2)

    for (let index = 0; index < 50; index += 1) {
      text += ` ${index}`
      parser.parse(text)
    }

    expect(blockParseCalls).toBe(2)
    expect(parser.parse(text)[1]).toMatchObject({
      kind: 'code-block',
      lang: 'ts',
      text: expect.stringContaining(' 49')
    })

    text += '\n```'
    expect(parser.parse(text)[1]).toMatchObject({ kind: 'code-block' })
    expect(blockParseCalls).toBe(3)
  })
})
