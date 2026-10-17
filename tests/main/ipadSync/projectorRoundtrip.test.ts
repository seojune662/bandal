import { test, expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const { run } = createRequire(import.meta.url)('../../../scripts/test-projector-roundtrip.cjs')
test('shipped projector imports portable nested PDF, Markdown and ink without weakening containment', async () => {
  const result = await run(fileURLToPath(new URL('../../../', import.meta.url)), 'better-sqlite3-node')
  expect(result).toMatchObject({ records: 5, portableNestedCollision: true, traversalRejected: true, realpathEscapeRejected: true })
}, 30_000)
