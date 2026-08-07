/**
 * Minimal, dependency-free markdown parser for streaming chat text.
 *
 * Produces a small AST that MarkdownView renders via React elements — text is
 * never injected as HTML, so raw HTML in model output stays inert text.
 * Streaming-friendly: an unterminated code fence is treated as an open code
 * block instead of leaking backticks into a paragraph.
 *
 * Supported: headings (#–####), fenced code blocks, inline code, **bold**,
 * *italic*, [links](https://…) with an http(s)/mailto scheme allowlist,
 * ordered/unordered lists, blockquotes and horizontal rules.
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: MdInline[] }
  | { kind: 'em'; children: MdInline[] }
  | { kind: 'link'; href: string; children: MdInline[] }

export type MdBlockNode =
  | { kind: 'paragraph'; children: MdInline[] }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; children: MdInline[] }
  | { kind: 'code-block'; lang: string | null; text: string }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'quote'; children: MdInline[] }
  | { kind: 'hr' }

const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:']

export function isSafeLinkHref(href: string): boolean {
  try {
    const url = new URL(href)
    return SAFE_LINK_PROTOCOLS.includes(url.protocol)
  } catch {
    return false
  }
}

// -- inline parsing -----------------------------------------------------------

const INLINE_TOKEN_RE =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]*)\]\(([^)\s]+)\)/g

/** Merges adjacent text nodes (e.g. from rejected unsafe links). */
function mergeTextNodes(nodes: readonly MdInline[]): MdInline[] {
  const merged: MdInline[] = []
  for (const node of nodes) {
    const previous = merged[merged.length - 1]
    if (
      node.kind === 'text' &&
      previous !== undefined &&
      previous.kind === 'text'
    ) {
      merged[merged.length - 1] = {
        kind: 'text',
        text: previous.text + node.text
      }
    } else {
      merged.push(node)
    }
  }
  return merged
}

export function parseInline(text: string): MdInline[] {
  const nodes: MdInline[] = []
  let cursor = 0
  // A parser-local RegExp keeps recursive inline parses from sharing lastIndex.
  const tokenRe = new RegExp(INLINE_TOKEN_RE.source, INLINE_TOKEN_RE.flags)
  for (const match of text.matchAll(tokenRe)) {
    if (match.index > cursor) {
      nodes.push({ kind: 'text', text: text.slice(cursor, match.index) })
    }
    if (match[1] !== undefined) {
      nodes.push({ kind: 'code', text: match[1] })
    } else if (match[2] !== undefined) {
      nodes.push({ kind: 'strong', children: parseInline(match[2]) })
    } else if (match[3] !== undefined) {
      nodes.push({ kind: 'em', children: parseInline(match[3]) })
    } else {
      const href = match[5] ?? ''
      nodes.push(
        isSafeLinkHref(href)
          ? { kind: 'link', href, children: parseInline(match[4] ?? '') }
          : { kind: 'text', text: match[0] }
      )
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) {
    nodes.push({ kind: 'text', text: text.slice(cursor) })
  }
  return mergeTextNodes(nodes)
}

// -- block parsing ------------------------------------------------------------

const FENCE_RE = /^```(\S*)\s*$/
const HEADING_RE = /^(#{1,4})\s+(.*)$/
const HR_RE = /^\s*(?:-{3,}|\*{3,})\s*$/
const UL_ITEM_RE = /^\s*[-*]\s+(.*)$/
const OL_ITEM_RE = /^\s*\d+[.)]\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/

interface ParsedBlock {
  node: MdBlockNode
  /** Source offset at which this block starts. */
  start: number
  /** Whether appending at EOF can no longer change this block. */
  stableAtEnd: boolean
  /** Only true for the streaming-friendly unterminated fence case. */
  openFence: boolean
}

interface ParsedMarkdown {
  blocks: ParsedBlock[]
  stableBlockCount: number
  /** Start of the suffix that may still change, or text.length. */
  tailStart: number
}

type BlockParsedListener = (node: MdBlockNode) => void

function parseMarkdownSegment(
  text: string,
  onBlockParsed?: BlockParsedListener
): ParsedMarkdown {
  const lines = text.split('\n')
  const lineStarts: number[] = []
  let lineStart = 0
  for (const line of lines) {
    lineStarts.push(lineStart)
    lineStart += line.length + 1
  }

  const blocks: ParsedBlock[] = []
  let paragraph: string[] = []
  let paragraphStart = 0

  const pushBlock = (block: ParsedBlock): void => {
    blocks.push(block)
    onBlockParsed?.(block.node)
  }

  const flushParagraph = (stableAtEnd: boolean): void => {
    if (paragraph.length === 0) {
      return
    }
    pushBlock({
      node: {
        kind: 'paragraph',
        children: parseInline(paragraph.join('\n'))
      },
      start: paragraphStart,
      stableAtEnd,
      openFence: false
    })
    paragraph = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const currentLineStart = lineStarts[i] ?? text.length

    const fence = FENCE_RE.exec(line)
    if (fence !== null) {
      flushParagraph(currentLineStart + line.length < text.length)
      const lang = fence[1] !== undefined && fence[1] !== '' ? fence[1] : null
      const body: string[] = []
      i += 1
      // Streaming-friendly: run to EOF when the closing fence hasn't arrived.
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      const hasClosingFence = i < lines.length
      const closingLineStart = lineStarts[i] ?? text.length
      const closingLineLength = (lines[i] ?? '').length
      i += 1 // skip the closing fence (or move past EOF)
      pushBlock({
        node: { kind: 'code-block', lang, text: body.join('\n') },
        start: currentLineStart,
        // A closing fence at EOF can still be invalidated by appended text.
        stableAtEnd:
          hasClosingFence && closingLineStart + closingLineLength < text.length,
        openFence: !hasClosingFence
      })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      flushParagraph(true)
      const level = Math.min((heading[1] ?? '#').length, 4) as 1 | 2 | 3 | 4
      pushBlock({
        node: {
          kind: 'heading',
          level,
          children: parseInline(heading[2] ?? '')
        },
        start: currentLineStart,
        stableAtEnd: currentLineStart + line.length < text.length,
        openFence: false
      })
      i += 1
      continue
    }

    if (HR_RE.test(line) && line.trim().length >= 3) {
      flushParagraph(currentLineStart + line.length < text.length)
      pushBlock({
        node: { kind: 'hr' },
        start: currentLineStart,
        stableAtEnd: currentLineStart + line.length < text.length,
        openFence: false
      })
      i += 1
      continue
    }

    const ulItem = UL_ITEM_RE.exec(line)
    const olItem = ulItem === null ? OL_ITEM_RE.exec(line) : null
    if (ulItem !== null || olItem !== null) {
      flushParagraph(true)
      const ordered = olItem !== null
      const itemRe = ordered ? OL_ITEM_RE : UL_ITEM_RE
      const items: MdInline[][] = []
      while (i < lines.length) {
        const itemMatch = itemRe.exec(lines[i] ?? '')
        if (itemMatch === null) {
          break
        }
        items.push(parseInline(itemMatch[1] ?? ''))
        i += 1
      }
      pushBlock({
        node: { kind: 'list', ordered, items },
        start: currentLineStart,
        stableAtEnd:
          (lineStarts[i] ?? text.length) + (lines[i] ?? '').length <
          text.length,
        openFence: false
      })
      continue
    }

    const quote = QUOTE_RE.exec(line)
    if (quote !== null) {
      flushParagraph(true)
      const quoteLines: string[] = []
      while (i < lines.length) {
        const quoteMatch = QUOTE_RE.exec(lines[i] ?? '')
        if (quoteMatch === null) {
          break
        }
        quoteLines.push(quoteMatch[1] ?? '')
        i += 1
      }
      pushBlock({
        node: {
          kind: 'quote',
          children: parseInline(quoteLines.join('\n'))
        },
        start: currentLineStart,
        stableAtEnd:
          (lineStarts[i] ?? text.length) + (lines[i] ?? '').length <
          text.length,
        openFence: false
      })
      continue
    }

    if (line.trim() === '') {
      // The synthetic empty line produced by a single trailing newline can be
      // replaced by more streamed text, so only a real blank line is stable.
      flushParagraph(currentLineStart + line.length < text.length)
      i += 1
      continue
    }

    if (paragraph.length === 0) {
      paragraphStart = currentLineStart
    }
    paragraph.push(line)
    i += 1
  }

  flushParagraph(false)
  let stableBlockCount = blocks.length
  while (
    stableBlockCount > 0 &&
    blocks[stableBlockCount - 1]?.stableAtEnd === false
  ) {
    stableBlockCount -= 1
  }
  const tailStart = blocks[stableBlockCount]?.start ??
    (blocks.length === 0 ? 0 : text.length)
  return { blocks, stableBlockCount, tailStart }
}

export function parseMarkdown(text: string): MdBlockNode[] {
  return parseMarkdownSegment(text).blocks.map(({ node }) => node)
}

/**
 * Per-view parser cache for append-only model output. Parsed blocks before the
 * growing tail retain both their AST and object identity across stream ticks.
 */
export class IncrementalMarkdownParser {
  private text = ''
  private blocks: MdBlockNode[] = []
  private stableBlocks: MdBlockNode[] = []
  private tailStart = 0
  private tailIsOpenFence = false

  constructor(private readonly onBlockParsed?: BlockParsedListener) {}

  parse(text: string): MdBlockNode[] {
    if (text === this.text) return this.blocks

    if (!text.startsWith(this.text)) {
      this.text = ''
      this.blocks = []
      this.stableBlocks = []
      this.tailStart = 0
      this.tailIsOpenFence = false
    }

    if (this.canExtendOpenFence(text)) {
      const previous = this.blocks[this.blocks.length - 1]
      if (previous?.kind === 'code-block') {
        const node: MdBlockNode = {
          ...previous,
          text: previous.text + text.slice(this.text.length)
        }
        this.text = text
        this.blocks = [...this.stableBlocks, node]
        return this.blocks
      }
    }

    const prefixLength = this.tailStart
    const parsed = parseMarkdownSegment(
      text.slice(prefixLength),
      this.onBlockParsed
    )
    const localStableCount = parsed.stableBlockCount
    this.stableBlocks = [
      ...this.stableBlocks,
      ...parsed.blocks.slice(0, localStableCount).map(({ node }) => node)
    ]
    const tail = parsed.blocks.slice(localStableCount)
    this.blocks = [...this.stableBlocks, ...tail.map(({ node }) => node)]
    this.text = text
    this.tailStart = prefixLength + parsed.tailStart
    this.tailIsOpenFence = tail[0]?.openFence === true
    return this.blocks
  }

  private canExtendOpenFence(nextText: string): boolean {
    if (
      !this.tailIsOpenFence ||
      !this.text.slice(this.tailStart).includes('\n')
    ) {
      return false
    }
    const lastLineStart = this.text.lastIndexOf('\n') + 1
    const changedLines =
      this.text.slice(lastLineStart) + nextText.slice(this.text.length)
    return !changedLines.split('\n').some((line) => /^```\s*$/.test(line))
  }
}
