/**
 * Renders the markdown AST from ./markdown.ts as React elements.
 * All text flows through React's escaping — no innerHTML anywhere.
 */

import { memo } from 'react'
import { parseMarkdown, type MdBlockNode, type MdInline } from './markdown'

function InlineNodes({ nodes }: { nodes: MdInline[] }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.kind) {
          case 'text':
            return <span key={index}>{node.text}</span>
          case 'code':
            return (
              <code key={index} className="chat-md__code">
                {node.text}
              </code>
            )
          case 'strong':
            return (
              <strong key={index}>
                <InlineNodes nodes={node.children} />
              </strong>
            )
          case 'em':
            return (
              <em key={index}>
                <InlineNodes nodes={node.children} />
              </em>
            )
          case 'link':
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noreferrer noopener"
                className="chat-md__link"
              >
                <InlineNodes nodes={node.children} />
              </a>
            )
        }
      })}
    </>
  )
}

function BlockNode({ node }: { node: MdBlockNode }): JSX.Element {
  switch (node.kind) {
    case 'paragraph':
      return (
        <p className="chat-md__p">
          <InlineNodes nodes={node.children} />
        </p>
      )
    case 'heading': {
      const Tag = `h${node.level + 2}` as keyof JSX.IntrinsicElements
      return (
        <Tag className="chat-md__heading" data-level={node.level}>
          <InlineNodes nodes={node.children} />
        </Tag>
      )
    }
    case 'code-block':
      return (
        <div className="chat-md__codeblock">
          {node.lang !== null && (
            <span className="chat-md__codeblock-lang">{node.lang}</span>
          )}
          <pre>
            <code>{node.text}</code>
          </pre>
        </div>
      )
    case 'list': {
      const items = node.items.map((item, index) => (
        <li key={index}>
          <InlineNodes nodes={item} />
        </li>
      ))
      return node.ordered ? (
        <ol className="chat-md__list">{items}</ol>
      ) : (
        <ul className="chat-md__list">{items}</ul>
      )
    }
    case 'quote':
      return (
        <blockquote className="chat-md__quote">
          <InlineNodes nodes={node.children} />
        </blockquote>
      )
    case 'hr':
      return <hr className="chat-md__hr" />
  }
}

export interface MarkdownViewProps {
  text: string
}

export const MarkdownView = memo(function MarkdownView({
  text
}: MarkdownViewProps): JSX.Element {
  const blocks = parseMarkdown(text)
  return (
    <div className="chat-md">
      {blocks.map((node, index) => (
        <BlockNode key={index} node={node} />
      ))}
    </div>
  )
})
