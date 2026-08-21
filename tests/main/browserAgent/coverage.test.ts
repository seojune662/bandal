/**
 * Can the agent do what a person does in a browser?
 *
 * The app side got this guard after 학기 그룹 shipped and sat there for eleven
 * releases with no agent tool, because nothing could notice. The browser side
 * was in the same state: `guestActions` could go back, reload, find, copy and
 * zoom while the agent could do none of them — and it could not scroll at all,
 * so a page longer than the snapshot budget had no below-the-fold and no way
 * to say so.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  AGENT_BROWSER_TOOLS,
  BROWSER_CAPABILITIES,
  NOT_FOR_AGENT_BROWSER
} from '../../../src/main/features/browserAgent/coverage'
import {
  BROWSER_TOOL_DEFINITIONS,
  BROWSER_TOOL_NAMES
} from '../../../src/main/features/agentTools/schemas'

describe('agent browser coverage', () => {
  test('every capability is either given to the agent or refused with a reason', () => {
    const undecided = BROWSER_CAPABILITIES.filter(
      (capability) =>
        AGENT_BROWSER_TOOLS[capability.id] === undefined &&
        NOT_FOR_AGENT_BROWSER[capability.id] === undefined
    )

    expect(
      undecided.map((capability) => capability.id),
      undecided.length === 0
        ? ''
        : [
            '',
            '사람은 브라우저에서 이걸 하는데 에이전트는 못 하고,',
            '왜 안 되는지도 적혀 있지 않습니다:',
            ...undecided.map((c) => `  · ${c.id} — ${c.what}`),
            '',
            'src/main/features/browserAgent/coverage.ts 에서 둘 중 하나를 하세요:',
            '  1) 도구를 만들고 AGENT_BROWSER_TOOLS 에 매핑하거나',
            '  2) NOT_FOR_AGENT_BROWSER 에 이유를 적으세요.',
            ''
          ].join('\n')
    ).toEqual([])
  })

  test('every mapped tool actually exists', () => {
    const missing = Object.entries(AGENT_BROWSER_TOOLS)
      .filter(
        ([, tool]) => !(BROWSER_TOOL_NAMES as readonly string[]).includes(tool)
      )
      .map(([id, tool]) => `${id} → ${tool}`)
    expect(missing).toEqual([])
  })

  test('browser_key is destructive and exposes only the fixed key set', () => {
    const definition = BROWSER_TOOL_DEFINITIONS.find(
      (tool) => tool.name === 'browser_key'
    )
    expect(definition?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true
    })
    expect(definition?.description).toContain('폼을 제출할 수 있습니다')
    const properties = definition?.inputSchema.properties as
      | Record<string, { enum?: string[] }>
      | undefined
    expect(properties?.['key']?.enum).toEqual([
      'Enter',
      'Tab',
      'Escape',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight'
    ])
  })

  test('a capability is not both given and refused', () => {
    const both = Object.keys(AGENT_BROWSER_TOOLS).filter(
      (id) => NOT_FOR_AGENT_BROWSER[id] !== undefined
    )
    expect(both).toEqual([])
  })

  test('every refusal carries a real reason', () => {
    const thin = Object.entries(NOT_FOR_AGENT_BROWSER)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([id]) => id)
    expect(thin).toEqual([])
  })

  test('the maps do not name capabilities that were removed', () => {
    const known = new Set(BROWSER_CAPABILITIES.map((c) => c.id))
    const stale = [
      ...Object.keys(AGENT_BROWSER_TOOLS),
      ...Object.keys(NOT_FOR_AGENT_BROWSER)
    ].filter((id) => !known.has(id))
    expect(stale).toEqual([])
  })

  test('the app itself has not grown a guest action nobody decided about', () => {
    // The drift that started this: `guestActions` gained back/forward/reload/
    // find/copy/zoom over time and the capability list never followed. Parsed
    // from source rather than imported — this is a node test and that file is
    // renderer code.
    const source = readFileSync(
      join(
        process.cwd(),
        'src/renderer/src/features/browser/guestActions.ts'
      ),
      'utf8'
    )
    const methods = [...source.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1])
    /** Plumbing, not something a person does to a page. */
    const PLUMBING = new Set([
      'tabId',
      'element',
      'navigate',
      'setZoom',
      'contentType',
      'currentUrl',
      'printToPdf',
      'copyImageAt',
      'stopFind',
      'focus',
      'paste',
      'cut',
      'selectAll',
      'undo',
      'redo',
      'reloadIgnoringCache',
      'copySelection',
      'download'
    ])
    const KNOWN: Readonly<Record<string, string>> = {
      back: 'back',
      forward: 'forward',
      reload: 'reload',
      stop: 'stop-loading',
      find: 'find-in-page',
      openDevTools: 'devtools'
    }
    const capabilityIds = new Set(BROWSER_CAPABILITIES.map((c) => c.id))
    const unaccounted = methods.filter((method) => {
      if (method === undefined || PLUMBING.has(method)) return false
      const id = KNOWN[method]
      return id === undefined || !capabilityIds.has(id)
    })
    expect(
      unaccounted,
      unaccounted.length === 0
        ? ''
        : `guestActions 가 새 동작을 얻었는데 BROWSER_CAPABILITIES 에 없습니다: ${unaccounted.join(', ')}`
    ).toEqual([])
  })
})
