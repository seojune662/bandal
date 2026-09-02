import { Clock, Container, Ctx } from '@milkdown/ctx'
import {
  config,
  Editor,
  init,
  remarkCtx
} from '@milkdown/core'
import type { MarkdownNode } from '@milkdown/transformer'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { remarkCallout } from '../../../../src/renderer/src/features/notes/callout/remarkCallout'

beforeAll(() => {
  const events = new EventTarget()
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events))
})

afterAll(() => vi.unstubAllGlobals())

async function parseWithRemark(markdown: string): Promise<MarkdownNode> {
  const context = new Ctx(new Container(), new Clock())
  const plugins = [init(Editor.make()), config(() => undefined)]
  const runners = plugins.map((plugin) => plugin(context))
  await Promise.all(runners.map((run) => Promise.resolve(run())))

  // remarkCtx is initialized with remark-parse; adding the raw plugin lets us
  // assert the mdast transform before Milkdown's ProseMirror parser runs.
  const processor = context.get(remarkCtx).use(remarkCallout, {})
  return processor.runSync(processor.parse(markdown)) as MarkdownNode
}

describe('remark callout transform', () => {
  test('promotes a matching blockquote and removes its header line', async () => {
    const tree = await parseWithRemark('> [!tip]- 접힌 팁\n> 본문\n')
    const callout = tree.children?.[0]

    expect(callout).toMatchObject({
      type: 'callout',
      calloutType: 'tip',
      title: '접힌 팁',
      collapsed: true
    })
    expect(callout?.children?.[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text', value: '본문' }]
    })
  })

  test('preserves an unknown source type for serialization', async () => {
    const tree = await parseWithRemark('> [!custom-alert] Custom\n> body\n')
    expect(tree.children?.[0]).toMatchObject({
      type: 'callout',
      calloutType: 'custom-alert',
      title: 'Custom'
    })
  })

  test('leaves an ordinary blockquote unchanged', async () => {
    const tree = await parseWithRemark('> ordinary quote\n')
    expect(tree.children?.[0]).toMatchObject({
      type: 'blockquote',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'ordinary quote' }]
        }
      ]
    })
  })

  test('requires the header to begin in the first inline text node', async () => {
    const tree = await parseWithRemark('> **[!note]** not a callout\n')
    expect(tree.children?.[0]?.type).toBe('blockquote')
  })
})
