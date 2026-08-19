import { describe, expect, test } from 'vitest'
import {
  canClick,
  canSelect,
  canType,
  type ElementFacts
} from '../../../src/main/features/browserAgent/actionPolicy'
import {
  formatRef,
  GenerationTracker,
  parseRef,
  resolveRef
} from '../../../src/main/features/browserAgent/refs'

function facts(over: Partial<ElementFacts> = {}): ElementFacts {
  return {
    tag: 'a',
    type: null,
    inNonGetForm: false,
    href: null,
    disabled: false,
    ...over
  }
}

describe('canClick', () => {
  test('allows an ordinary link or button', () => {
    expect(canClick(facts({ tag: 'a', href: '/x' })).allowed).toBe(true)
    expect(canClick(facts({ tag: 'button', type: 'button' })).allowed).toBe(true)
  })

  test('refuses a disabled control', () => {
    expect(canClick(facts({ disabled: true })).allowed).toBe(false)
  })

  test('refuses anything that would submit a form', () => {
    // Submit is the entire set of irreversible acts on the web, and the
    // always-prompt gate that will govern it does not exist yet.
    for (const element of [
      facts({ tag: 'input', type: 'submit' }),
      facts({ tag: 'input', type: 'image' }),
      facts({ tag: 'button', type: 'submit' })
    ]) {
      const verdict = canClick(element)
      expect(verdict.allowed, JSON.stringify(element)).toBe(false)
      if (!verdict.allowed) expect(verdict.reason).toBe('submit')
    }
  })

  test('a bare <button> inside a POST form counts as submit', () => {
    // HTML defaults it to type=submit; treating it as an ordinary button is
    // how an agent submits a form without meaning to.
    const verdict = canClick(
      facts({ tag: 'button', type: null, inNonGetForm: true })
    )
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('submit')
  })

  test('a bare <button> outside a form is just a button', () => {
    expect(
      canClick(facts({ tag: 'button', type: null, inNonGetForm: false })).allowed
    ).toBe(true)
  })

  test('the refusal explains what the student should do', () => {
    const verdict = canClick(facts({ tag: 'input', type: 'submit' }))
    if (!verdict.allowed) expect(verdict.message).toContain('직접')
  })
})

describe('canType', () => {
  test('allows ordinary text fields', () => {
    expect(canType(facts({ tag: 'input', type: 'text' })).allowed).toBe(true)
    expect(canType(facts({ tag: 'input', type: null })).allowed).toBe(true)
    expect(canType(facts({ tag: 'textarea' })).allowed).toBe(true)
    expect(canType(facts({ tag: 'input', type: 'search' })).allowed).toBe(true)
  })

  test('REFUSES a password field outright', () => {
    // loginBridge proves "a human typed this" with event.isTrusted; if typing
    // could reach a password field that proof would be worthless.
    const verdict = canType(facts({ tag: 'input', type: 'password' }))
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('password')
  })

  test('refuses inputs that are not text entry', () => {
    for (const type of ['checkbox', 'radio', 'file', 'submit', 'button']) {
      expect(canType(facts({ tag: 'input', type })).allowed, type).toBe(false)
    }
  })

  test('refuses non-input elements', () => {
    expect(canType(facts({ tag: 'div' })).allowed).toBe(false)
    expect(canType(facts({ tag: 'a', href: '/x' })).allowed).toBe(false)
  })

  test('refuses a disabled field', () => {
    expect(
      canType(facts({ tag: 'input', type: 'text', disabled: true })).allowed
    ).toBe(false)
  })
})

describe('canSelect', () => {
  test('allows a select', () => {
    expect(canSelect(facts({ tag: 'select' })).allowed).toBe(true)
  })

  test('refuses anything else', () => {
    expect(canSelect(facts({ tag: 'input', type: 'text' })).allowed).toBe(false)
    expect(canSelect(facts({ tag: 'select', disabled: true })).allowed).toBe(false)
  })
})

describe('refs', () => {
  test('round-trips', () => {
    expect(parseRef(formatRef(0, 12, 3))).toEqual({
      frameIndex: 0,
      elementIndex: 12,
      generation: 3
    })
  })

  test('rejects junk', () => {
    for (const ref of ['', 'e12', 'f0:e12', 'f0:e12@', 'nonsense', null, 42]) {
      expect(parseRef(ref), String(ref)).toBeNull()
    }
  })

  test('a ref from a previous page state is stale, not a different element', () => {
    // Without this, clicking `e12` after a navigation clicks whatever happens
    // to be the twelfth element of a completely different document.
    const verdict = resolveRef(formatRef(0, 12, 2), 3)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('stale')
  })

  test('a ref from the future is refused too', () => {
    // It can only mean the agent invented one.
    const verdict = resolveRef(formatRef(0, 12, 9), 3)
    expect(verdict.ok).toBe(false)
  })

  test('resolves a current ref', () => {
    const verdict = resolveRef(formatRef(1, 4, 3), 3)
    expect(verdict).toEqual({ ok: true, frameIndex: 1, elementIndex: 4 })
  })

  test('generation starts at zero and every navigation bumps it', () => {
    const tracker = new GenerationTracker()
    expect(tracker.current('t1')).toBe(0)
    expect(tracker.invalidate('t1')).toBe(1)
    expect(tracker.invalidate('t1')).toBe(2)
    // Tabs are independent.
    expect(tracker.current('t2')).toBe(0)
  })

  test('forgetting a tab resets it', () => {
    const tracker = new GenerationTracker()
    tracker.invalidate('t1')
    tracker.forget('t1')
    expect(tracker.current('t1')).toBe(0)
  })
})
