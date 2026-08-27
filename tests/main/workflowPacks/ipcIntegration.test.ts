import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const HANDLERS_SOURCE = join(
  process.cwd(),
  'src/main/ipc/registerHandlers.ts'
)

function handlersSource(): string {
  return readFileSync(HANDLERS_SOURCE, 'utf8')
}

describe('workflow pack IPC integration', () => {
  test('shares one store and run guard across pack execution and agent tools', () => {
    const source = handlersSource()
    const toolServer = source.slice(
      source.indexOf('const startToolServer'),
      source.indexOf('const sessionManager')
    )
    const study = source.slice(
      source.indexOf('const workflowSessionIds'),
      source.indexOf("handle('agent:installCommand'")
    )

    expect(source).toContain(
      'const packStore = createPackStore({ userDataPath: deps.userDataPath })'
    )
    expect(source).toContain('const packRunGuard = createPackRunGuard()')
    expect(toolServer).toContain('packRunGuard,')
    expect(study).toContain('const packRunner = createPackRunner({')
    expect(study).toContain('store: packStore,')
    expect(study).toContain('runGuard: packRunGuard,')
  })

  test('delegates pack IPC and study runs without dropping follow-up metadata', () => {
    const study = handlersSource().slice(
      handlersSource().indexOf('const workflowSessionIds'),
      handlersSource().indexOf("handle('agent:installCommand'")
    )

    expect(study).toContain("handle('packs:list'")
    expect(study).toContain("handle('packs:importText'")
    expect(study).toContain("handle('packs:remove'")
    expect(study).toContain("handle('packs:setEnabled'")
    expect(study).toContain("handle('study:run'")
    expect(study).toContain('packRunner.run({')
    expect(study).toContain('{ followUpOf: req.followUpOf }')
    expect(study).toContain('conversationId: sessionId')
  })
})
