/**
 * The Chrome DevTools Protocol, used for exactly three things.
 *
 * CDP is the LAST rung of the ladder, not the first. Most of what this agent
 * does never touches it: an LMS list comes from a JSON endpoint, and a click
 * comes from injected JS in an isolated world. It is here only for capability
 * gaps that genuinely have no DOM-tier equivalent:
 *
 *  1. **`Input.insertText` for Hangul.** `sendInputEvent` has no IME path.
 *     Synthesising `char` events for 한글 either produces mojibake or nothing
 *     at all on any site that listens for `compositionend`. This one gap is
 *     what decides CDP over `sendInputEvent`.
 *  2. **`DOM.setFileInputFiles`.** JavaScript cannot set
 *     `input[type=file].files` from an OS path. There is no substitute.
 *  3. **Trusted `Input.dispatchMouseEvent`**, for the minority of controls
 *     that check `event.isTrusted` or need real hit-testing.
 *
 * ## It is not a privilege escalation, and the comment matters
 *
 * Main already has strictly more power over a guest than CDP grants: it can
 * `executeJavaScript` arbitrary code in it (`loginFiller.ts` does exactly
 * that, holding a password), read and write its cookies, `loadURL` it
 * anywhere, and destroy it. Attaching a debugger changes no `webPreferences`,
 * re-enables no `nodeIntegration`, defeats no `webSecurity`, reaches outside
 * no partition, and cannot be initiated by the guest.
 *
 * ## The one thing it DOES change, and how that is contained
 *
 * CDP-dispatched input has `isTrusted === true`. `loginBridge.ts` uses exactly
 * that property to prove a human typed a password. So `browser_type` refuses
 * password fields outright (`actionPolicy.ts`) and only
 * `browser_use_saved_login` may touch one — and that path goes through
 * `createLoginFiller`, whose native-value-setter writes are UNtrusted and
 * therefore cannot poison the capture gate.
 *
 * ## Attachment is per action
 *
 * Never held across a navigation, always detached in `finally`, and skipped
 * entirely when DevTools is already attached (only one debugger client is
 * allowed, and stealing it from a student who opened DevTools would be rude
 * and confusing). Callers degrade to the DOM tier rather than failing.
 */

export interface DebuggerLike {
  isAttached: () => boolean
  attach: (protocolVersion?: string) => void
  detach: () => void
  sendCommand: (method: string, params?: object) => Promise<unknown>
}

export interface CdpTarget {
  debugger: DebuggerLike
}

/** Signals that CDP was unavailable, so the caller can fall back. */
export class CdpUnavailable extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'CdpUnavailable'
  }
}

/**
 * Attaches, runs, and detaches — in that order, with the detach guaranteed.
 *
 * Returns whatever `fn` returns. Throws `CdpUnavailable` when the debugger
 * cannot be attached, which callers treat as "use the DOM tier", not as a
 * failure of the action.
 */
export async function withDebugger<T>(
  target: CdpTarget,
  fn: (send: (method: string, params?: object) => Promise<unknown>) => Promise<T>
): Promise<T> {
  const dbg = target.debugger

  // Someone else — almost certainly the student's own DevTools — already owns
  // it. Only one client may attach.
  if (dbg.isAttached()) {
    throw new CdpUnavailable('debugger already attached')
  }

  try {
    dbg.attach('1.3')
  } catch (error) {
    throw new CdpUnavailable(
      error instanceof Error ? error.message : 'attach failed'
    )
  }

  try {
    return await fn((method, params) => dbg.sendCommand(method, params))
  } finally {
    try {
      dbg.detach()
    } catch {
      // Already gone (the page navigated, the guest died). Nothing to do, and
      // certainly nothing worth masking the real result with.
    }
  }
}

/**
 * Types text as if the IME committed it.
 *
 * `Input.insertText` is the whole reason CDP is here. It bypasses key-event
 * synthesis entirely, which is what makes 한글 work.
 */
export async function insertText(
  target: CdpTarget,
  text: string
): Promise<void> {
  await withDebugger(target, async (send) => {
    await send('Input.insertText', { text })
  })
}

/**
 * Attaches files to an `input[type=file]`.
 *
 * `DOM.setFileInputFiles` needs a backend node id, so the element is located
 * through the document first. There is no JavaScript equivalent — assigning
 * to `.files` is forbidden.
 */
export async function setFileInputFiles(
  target: CdpTarget,
  selector: string,
  paths: readonly string[]
): Promise<boolean> {
  return withDebugger(target, async (send) => {
    const doc = (await send('DOM.getDocument', { depth: 0 })) as {
      root?: { nodeId?: number }
    }
    const rootId = doc?.root?.nodeId
    if (typeof rootId !== 'number') return false

    const found = (await send('DOM.querySelector', {
      nodeId: rootId,
      selector
    })) as { nodeId?: number }
    const nodeId = found?.nodeId
    if (typeof nodeId !== 'number' || nodeId === 0) return false

    await send('DOM.setFileInputFiles', { nodeId, files: [...paths] })
    return true
  })
}
