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

interface InlineMatch {
  index: number
  length: number
  node: MdInline
}

const CODE_RE = /`([^`\n]+)`/
const STRONG_RE = /\*\*([^*\n]+?)\*\*/
const EM_RE = /\*([^*\n]+?)\*/
const LINK_RE = /\[([^\]\n]*)\]\(([^)\s]+)\)/

function findEarliest(text: string): InlineMatch | null {
  let best: InlineMatch | null = null

  const consider = (match: InlineMatch | null): void => {
    if (match !== null && (best === null || match.index < best.index)) {
      best = match
    }
  }

  const code = CODE_RE.exec(text)
  if (code !== null) {
    consider({
      index: code.index,
      length: code[0].length,
      node: { kind: 'code', text: code[1] ?? '' }
    })
  }
  const strong = STRONG_RE.exec(text)
  if (strong !== null) {
    consider({
      index: strong.index,
      length: strong[0].length,
      node: { kind: 'strong', children: parseInline(strong[1] ?? '') }
    })
  }
  const em = EM_RE.exec(text)
  if (em !== null) {
    consider({
      index: em.index,
      length: em[0].length,
      node: { kind: 'em', children: parseInline(em[1] ?? '') }
    })
  }
  const link = LINK_RE.exec(text)
  if (link !== null) {
    const href = link[2] ?? ''
    consider({
      index: link.index,
      length: link[0].length,
      node: isSafeLinkHref(href)
        ? { kind: 'link', href, children: parseInline(link[1] ?? '') }
        : { kind: 'text', text: link[0] }
    })
  }
  return best
}

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
  let rest = text
  while (rest.length > 0) {
    const match = findEarliest(rest)
    if (match === null) {
      nodes.push({ kind: 'text', text: rest })
      break
    }
    if (match.index > 0) {
      nodes.push({ kind: 'text', text: rest.slice(0, match.index) })
    }
    nodes.push(match.node)
    rest = rest.slice(match.index + match.length)
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

export function parseMarkdown(text: string): MdBlockNode[] {
  const lines = text.split('\n')
  const blocks: MdBlockNode[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) {
      return
    }
    blocks.push({
      kind: 'paragraph',
      children: parseInline(paragraph.join('\n'))
    })
    paragraph = []
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''

    const fence = FENCE_RE.exec(line)
    if (fence !== null) {
      flushParagraph()
      const lang = fence[1] !== undefined && fence[1] !== '' ? fence[1] : null
      const body: string[] = []
      i += 1
      // Streaming-friendly: run to EOF when the closing fence hasn't arrived.
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1 // skip the closing fence (or move past EOF)
      blocks.push({ kind: 'code-block', lang, text: body.join('\n') })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      flushParagraph()
      const level = Math.min((heading[1] ?? '#').length, 4) as 1 | 2 | 3 | 4
      blocks.push({
        kind: 'heading',
        level,
        children: parseInline(heading[2] ?? '')
      })
      i += 1
      continue
    }

    if (HR_RE.test(line) && line.trim().length >= 3) {
      flushParagraph()
      blocks.push({ kind: 'hr' })
      i += 1
      continue
    }

    const ulItem = UL_ITEM_RE.exec(line)
    const olItem = ulItem === null ? OL_ITEM_RE.exec(line) : null
    if (ulItem !== null || olItem !== null) {
      flushParagraph()
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
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    const quote = QUOTE_RE.exec(line)
    if (quote !== null) {
      flushParagraph()
      const quoteLines: string[] = []
      while (i < lines.length) {
        const quoteMatch = QUOTE_RE.exec(lines[i] ?? '')
        if (quoteMatch === null) {
          break
        }
        quoteLines.push(quoteMatch[1] ?? '')
        i += 1
      }
      blocks.push({
        kind: 'quote',
        children: parseInline(quoteLines.join('\n'))
      })
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      i += 1
      continue
    }

    paragraph.push(line)
    i += 1
  }

  flushParagraph()
  return blocks
}
