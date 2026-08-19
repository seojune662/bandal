/**
 * What the agent is shown of a page.
 *
 * NOT the DOM, and NOT `Accessibility.getFullAXTree`. A Korean 학사 포털 is
 * nested `<table>` layout with `<font>` tags and no `<label>`s; an accessibility
 * tree of one is fifteen thousand `generic`/`StaticText` nodes with no
 * accessible names — the worst possible trade, expensive AND uninformative.
 *
 * Instead: a flat, ref-indexed outline of the things a student could act on,
 * plus the text around them, hard-capped. One line per element:
 *
 *   f0:e12@3 link "3주차 강의자료" → /mod/resource/view.php?id=88213
 *   f0:e21@3 button "주차 접기"
 *   f2:e04@3 textbox "아이디" (empty, required)
 *
 * ## Why it runs in an isolated world
 *
 * Guests get no preload by policy (`hardenWebviews`), so the existing bridges
 * inject into the MAIN world and exfiltrate through a prefixed `console.log`
 * — which the page can read, tamper with, and forge. For the agent path that
 * is not good enough, so this runs via `executeJavaScriptInIsolatedWorld`,
 * where the page cannot see it, and the value comes back on the promise.
 */

/** Default budget. A snapshot is context, not a document. */
export const DEFAULT_SNAPSHOT_CHARS = 6_000
export const MAX_SNAPSHOT_CHARS = 20_000

export interface SnapshotElement {
  /** Index within its frame, used to build the ref. */
  index: number
  role: 'link' | 'button' | 'textbox' | 'select' | 'checkbox' | 'heading' | 'text'
  name: string
  href: string | null
  /** Element facts the action policy needs, carried so a click need not re-read. */
  tag: string
  type: string | null
  inNonGetForm: boolean
  disabled: boolean
  value: string | null
  required: boolean
}

export interface FrameSnapshot {
  frameIndex: number
  url: string
  elements: SnapshotElement[]
}

/**
 * The page-side collector, as source. Kept as a string because it is injected,
 * not imported — it runs in the guest's isolated world, not in main.
 *
 * Deliberately conservative about what counts as actionable: an outline that
 * lists every `<div>` is the DOM dump this exists to avoid.
 */
export const SNAPSHOT_SOURCE = `(() => {
  const MAX_ELEMENTS = 250;
  const out = [];
  const seen = new Set();

  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      const id = el.getAttribute('id');
      if (id) {
        const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (label && label.textContent.trim()) return label.textContent.trim();
      }
      const wrapping = el.closest('label');
      if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim();
      const name = el.getAttribute('name');
      if (name) return name;
    }
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    return text.slice(0, 120);
  };

  const inNonGetForm = (el) => {
    const form = el.closest('form');
    if (!form) return false;
    return (form.getAttribute('method') || 'get').toLowerCase() !== 'get';
  };

  const roleOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return 'checkbox';
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') {
        return 'button';
      }
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return 'text';
  };

  const collect = (el) => {
    if (out.length >= MAX_ELEMENTS) return;
    if (seen.has(el)) return;
    if (!visible(el)) return;
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute ? (el.getAttribute('type') || '').toLowerCase() : '';
    out.push({
      index: out.length,
      role: roleOf(el),
      name: nameOf(el),
      href: tag === 'a' ? el.getAttribute('href') : null,
      tag: tag,
      type: type === '' ? null : type,
      inNonGetForm: inNonGetForm(el),
      disabled: Boolean(el.disabled),
      // Never report the contents of a password field, not even its length.
      value: type === 'password' ? null : (el.value == null ? null : String(el.value).slice(0, 80)),
      required: Boolean(el.required)
    });
  };

  document
    .querySelectorAll('a[href], button, input, select, textarea, h1, h2, h3')
    .forEach(collect);

  return { url: location.href, elements: out };
})()`

/** Renders one frame's elements as the lines the model sees. */
export function renderSnapshot(
  frames: readonly FrameSnapshot[],
  generation: number,
  maxChars: number = DEFAULT_SNAPSHOT_CHARS
): string {
  const budget = Math.min(Math.max(maxChars, 500), MAX_SNAPSHOT_CHARS)
  const lines: string[] = []
  let used = 0
  let truncated = false

  for (const frame of frames) {
    for (const element of frame.elements) {
      const line = renderElement(frame.frameIndex, element, generation)
      if (used + line.length + 1 > budget) {
        truncated = true
        break
      }
      lines.push(line)
      used += line.length + 1
    }
    if (truncated) break
  }

  if (truncated) {
    // Say so rather than letting the agent believe it saw the whole page.
    lines.push('… (페이지가 길어 일부만 표시했어요)')
  }
  return lines.join('\n')
}

function renderElement(
  frameIndex: number,
  element: SnapshotElement,
  generation: number
): string {
  const ref = `f${frameIndex}:e${element.index}@${generation}`
  const name = element.name === '' ? '' : ` "${element.name}"`
  const parts = [`${ref} ${element.role}${name}`]
  if (element.href !== null && element.href !== '') {
    parts.push(`→ ${element.href}`)
  }
  const flags: string[] = []
  if (element.disabled) flags.push('disabled')
  if (element.required) flags.push('required')
  if (element.type === 'password') flags.push('password')
  if (element.value !== null && element.value !== '') {
    flags.push(`value=${JSON.stringify(element.value)}`)
  }
  if (flags.length > 0) parts.push(`(${flags.join(', ')})`)
  return parts.join(' ')
}

/** Text of the page for `browser_read`, with the same hard cap. */
export const READ_SOURCE = `(() => {
  const text = (document.body ? document.body.innerText : '') || '';
  return { url: location.href, text: text.replace(/\\n{3,}/g, '\\n\\n') };
})()`
