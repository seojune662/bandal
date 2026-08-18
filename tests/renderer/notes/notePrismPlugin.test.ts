/**
 * Regression guard for the v0.13.0 dead-toolbar bug: @milkdown/plugin-prism
 * resolving a SECOND copy of @milkdown/core made its `ctx.wait(SchemaReady)`
 * throw timerNotFound (Timer identity is a per-module Symbol), which rejected
 * editor.create() silently and turned every toolbar button into a no-op.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { Clock, Container, Ctx } from '@milkdown/ctx'
import { SchemaReady, prosePluginsCtx } from '@milkdown/core'
import { loadNotePrismPlugins } from '../../../src/renderer/src/features/notes/noteEditorPlugins'

function installedVersion(pkg: string): string {
  const raw = readFileSync(
    join(process.cwd(), 'node_modules', pkg, 'package.json'),
    'utf8'
  )
  return (JSON.parse(raw) as { version: string }).version
}

describe('note prism plugin / Milkdown single-instance guard', () => {
  // Timers signal readiness through global events; the node test env has none.
  beforeAll(() => {
    const events = new EventTarget()
    vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
    vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
    vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  test('plugin-prism ships the same Milkdown version as the app core', () => {
    // A version split re-creates the dual-core bundle. Pinned + overridden in
    // package.json; this assert fails fast if a future bump drifts.
    expect(installedVersion('@milkdown/plugin-prism')).toBe(
      installedVersion('@milkdown/core')
    )
  })

  test('prism plugins run against the app core ctx (no timerNotFound)', async () => {
    const ctx = new Ctx(new Container(), new Clock())
    ctx.inject(prosePluginsCtx, [])
    ctx.record(SchemaReady)

    const plugins = await loadNotePrismPlugins()
    expect(plugins.length).toBeGreaterThan(0)

    // Start the handlers first — Timer.done signals via a one-shot event, so
    // the wait() subscribers must exist before it fires.
    // With a duplicated core this rejects: Timer "SchemaReady" not found.
    const handlers = plugins.map((plugin) => Promise.resolve(plugin(ctx)()))
    ctx.done(SchemaReady)
    await Promise.all(handlers)

    expect(ctx.get(prosePluginsCtx).length).toBeGreaterThan(0)
  })
})
