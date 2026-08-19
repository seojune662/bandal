/**
 * Running the agent's reads and actions inside a guest.
 *
 * Two things make this different from the existing in-page bridges
 * (`loginBridge`, `selectionBridge`), and both matter:
 *
 * 1. **Isolated world.** Those bridges inject into the page's MAIN world and
 *    exfiltrate through a prefixed `console.log`, which the page can read,
 *    tamper with, and forge — any page can emit
 *    `console.log('__bandal_login_form__…')`. Harmless today because main
 *    re-validates the origin, but not a foundation for an agent. Here the
 *    script runs where the page cannot see it and the value returns on the
 *    promise.
 *
 * 2. **Every frame.** Both bridges are main-frame only
 *    (`loginBridge.ts`: `if (window.top !== window) return`), which means they
 *    are blind to Xinics LearningX's Canvas iframe, Moodle's player iframes,
 *    and SSO iframes. `webFrameMain.framesInSubtree` covers them, and it needs
 *    no CDP.
 *
 * The Electron surface is behind `PageDriverDeps` so the logic stays testable
 * without a running browser.
 */

import {
  canClick,
  canSelect,
  canType,
  type ActionVerdict,
  type ElementFacts
} from './actionPolicy'
import {
  DEFAULT_SNAPSHOT_CHARS,
  READ_SOURCE,
  renderSnapshot,
  SNAPSHOT_SOURCE,
  type FrameSnapshot,
  type SnapshotElement
} from './snapshot'

/** One frame we can run script in. Mirrors `WebFrameMain`'s useful surface. */
export interface DriverFrame {
  /** Runs in an isolated world — invisible to the page. */
  executeJavaScript: (code: string) => Promise<unknown>
}

export interface PageDriverDeps {
  /** Main frame first, then descendants, in a stable order. */
  frames: () => DriverFrame[]
  currentUrl: () => string
}

export interface SnapshotResult {
  url: string
  outline: string
  /** Kept so an action need not re-read the page to know what it is touching. */
  frames: FrameSnapshot[]
}

interface RawFrameResult {
  url?: unknown
  elements?: unknown
}

function toElements(raw: unknown): SnapshotElement[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as Record<string, unknown>
    return [
      {
        index: typeof row['index'] === 'number' ? row['index'] : index,
        role: (typeof row['role'] === 'string'
          ? row['role']
          : 'text') as SnapshotElement['role'],
        name: typeof row['name'] === 'string' ? row['name'] : '',
        href: typeof row['href'] === 'string' ? row['href'] : null,
        tag: typeof row['tag'] === 'string' ? row['tag'] : '',
        type: typeof row['type'] === 'string' ? row['type'] : null,
        inNonGetForm: row['inNonGetForm'] === true,
        disabled: row['disabled'] === true,
        value: typeof row['value'] === 'string' ? row['value'] : null,
        required: row['required'] === true
      }
    ]
  })
}

export function createPageDriver(deps: PageDriverDeps) {
  async function snapshot(
    generation: number,
    maxChars: number = DEFAULT_SNAPSHOT_CHARS
  ): Promise<SnapshotResult> {
    const frames = deps.frames()
    const collected: FrameSnapshot[] = []

    for (const [frameIndex, frame] of frames.entries()) {
      try {
        const raw = (await frame.executeJavaScript(
          SNAPSHOT_SOURCE
        )) as RawFrameResult
        collected.push({
          frameIndex,
          url: typeof raw?.url === 'string' ? raw.url : '',
          elements: toElements(raw?.elements)
        })
      } catch {
        // A cross-origin frame we cannot script is simply not in the outline.
        // Reporting it as an error would make every SSO page look broken.
      }
    }

    return {
      url: deps.currentUrl(),
      outline: renderSnapshot(collected, generation, maxChars),
      frames: collected
    }
  }

  async function read(maxChars: number): Promise<{ url: string; text: string }> {
    const [main] = deps.frames()
    if (main === undefined) return { url: deps.currentUrl(), text: '' }
    try {
      const raw = (await main.executeJavaScript(READ_SOURCE)) as {
        url?: unknown
        text?: unknown
      }
      const text = typeof raw?.text === 'string' ? raw.text : ''
      return {
        url: deps.currentUrl(),
        text: text.slice(0, Math.max(500, maxChars))
      }
    } catch {
      return { url: deps.currentUrl(), text: '' }
    }
  }

  /**
   * Performs one action, after the policy has approved it.
   *
   * The element is addressed by the SAME ordinal the snapshot used, recomputed
   * page-side with the same selector — so a page that changed shape between
   * snapshot and action resolves to a different element, which is why the
   * caller compares the facts it got back before trusting the result.
   */
  async function act(
    frameIndex: number,
    elementIndex: number,
    action: { kind: 'click' } | { kind: 'type'; text: string } | { kind: 'select'; value: string }
  ): Promise<{ ok: boolean; facts: ElementFacts | null }> {
    const frame = deps.frames()[frameIndex]
    if (frame === undefined) return { ok: false, facts: null }

    const payload = JSON.stringify({ index: elementIndex, action })
    const source = `(() => {
      const input = ${payload};
      const nodes = document.querySelectorAll('a[href], button, input, select, textarea, h1, h2, h3');
      let seen = -1;
      let target = null;
      for (const node of nodes) {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        seen += 1;
        if (seen === input.index) { target = node; break; }
      }
      if (!target) return { ok: false, facts: null };
      const tag = target.tagName.toLowerCase();
      const type = (target.getAttribute('type') || '').toLowerCase();
      const form = target.closest('form');
      const facts = {
        tag: tag,
        type: type === '' ? null : type,
        inNonGetForm: form ? (form.getAttribute('method') || 'get').toLowerCase() !== 'get' : false,
        href: tag === 'a' ? target.getAttribute('href') : null,
        disabled: Boolean(target.disabled)
      };
      if (input.action.kind === 'facts') return { ok: true, facts: facts };
      if (input.action.kind === 'click') {
        target.click();
        return { ok: true, facts: facts };
      }
      if (input.action.kind === 'type') {
        const setter = Object.getOwnPropertyDescriptor(
          tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value'
        );
        if (setter && setter.set) setter.set.call(target, input.action.text);
        else target.value = input.action.text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, facts: facts };
      }
      if (input.action.kind === 'select') {
        target.value = input.action.value;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, facts: facts };
      }
      return { ok: false, facts: facts };
    })()`

    try {
      const raw = (await frame.executeJavaScript(source)) as {
        ok?: unknown
        facts?: unknown
      }
      return {
        ok: raw?.ok === true,
        facts: (raw?.facts ?? null) as ElementFacts | null
      }
    } catch {
      return { ok: false, facts: null }
    }
  }

  /** Reads an element's facts without touching it, so the policy can rule. */
  async function factsFor(
    frameIndex: number,
    elementIndex: number
  ): Promise<ElementFacts | null> {
    const result = await act(frameIndex, elementIndex, {
      kind: 'facts'
    } as unknown as { kind: 'click' })
    return result.facts
  }

  return { snapshot, read, act, factsFor }
}

/** Picks the policy check for an action kind. */
export function verdictFor(
  kind: 'click' | 'type' | 'select',
  facts: ElementFacts
): ActionVerdict {
  if (kind === 'click') return canClick(facts)
  if (kind === 'type') return canType(facts)
  return canSelect(facts)
}
