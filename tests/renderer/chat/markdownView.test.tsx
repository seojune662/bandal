// @vitest-environment jsdom
import React from 'react'
import { describe, expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView } from '../../../src/renderer/src/features/chat/MarkdownView'

function render(text: string, streaming = false): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<MarkdownView text={text} streaming={streaming} />)
  return container
}

describe('study answer rendering', () => {
  test('typesets formulas in table cells and display blocks with accessible MathML', () => {
    const view = render(String.raw`| 수식 | 의미 |
|---|---|
| \(\frac{\partial\rho}{\partial t}+\nabla\cdot(\rho\mathbf V)=0\) | 질량보존 |

\[
\boxed{\nabla\cdot\boldsymbol{\tau}=0}
\]`)
    expect(view.querySelectorAll('table tbody tr')).toHaveLength(1)
    expect(view.querySelectorAll('.katex')).toHaveLength(2)
    expect(view.querySelectorAll('.katex-display')).toHaveLength(1)
    expect(view.querySelectorAll('math')).toHaveLength(2)
    expect(view.querySelector('.katex-error')).toBeNull()
  })

  test('keeps partially written formulas out of the visible answer', () => {
    const pending = render(String.raw`계산하면 \(\frac{`, true)
    expect(pending.querySelector('.chat-md__math--pending')).not.toBeNull()
    expect(pending.textContent).not.toContain('\\frac')
    expect(pending.textContent).not.toContain('\\(')
    const completed = render(String.raw`계산하면 \(\frac{1}{2}\)`)
    expect(completed.querySelector('.chat-md__math--pending')).toBeNull()
    expect(completed.querySelector('.katex')).not.toBeNull()
  })

  test('raw HTML and untrusted KaTeX extensions cannot inject active content', () => {
    const view = render(String.raw`<img src=x onerror=alert(1)>

\(\href{javascript:alert(1)}{click}\)

\(\htmlStyle{background:url(https://attacker.test)}{x}\)

[실행](javascript:alert(1))`)
    expect(view.querySelector('img,script,iframe')).toBeNull()
    expect(view.querySelector('a')).toBeNull()
    expect(view.innerHTML).not.toContain('style="background:url')
    expect(view.querySelector('.katex-error')).toBeNull()
  })

  test('invalid final formulas fall back to readable escaped text', () => {
    const view = render(String.raw`\(\frac{<script>}{\)`)
    expect(view.querySelector('.chat-md__math--fallback')?.textContent).toContain('<script>')
    expect(view.querySelector('script')).toBeNull()
  })

  test('lists preserve numbering and nest with semantic HTML', () => {
    const view = render('3. 세 번째\n   - 중첩 항목\n4. 네 번째')
    expect(view.querySelector('ol')?.start).toBe(3)
    expect(view.querySelectorAll('ol > li')).toHaveLength(2)
    expect(view.querySelector('ol > li > ul > li')?.textContent).toBe('중첩 항목')
  })
})
