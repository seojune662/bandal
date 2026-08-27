import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createPackStore,
  MAX_CUSTOM_WORKFLOW_PACKS,
  WORKFLOW_PACKS_FILE_NAME
} from '../../../src/main/features/workflowPacks/packStore'

function packJson(name = '내 팩'): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: 'publisher-controlled-id',
    name,
    description: '직접 설치한 학습 팩',
    author: 'Student',
    version: '1.2.0',
    locale: 'ko-KR',
    worksOn: ['course'],
    recipe: '자료를 정리하라.',
    allowedTools: ['write_file'],
    usesWeb: false,
    outputs: { dir: '내 결과', primary: '정리' }
  })
}

describe('packStore', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'bandal-packs-'))
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  test('sanitizes imports and always assigns a fresh custom id', () => {
    let sequence = 0
    const store = createPackStore({
      userDataPath,
      randomUUID: () => `generated-${++sequence}`
    })

    const first = store.importText(packJson('첫 팩'))
    const second = store.importText(packJson('둘째 팩'))

    expect(first.pack.id).toBe('custom:generated-1')
    expect(second.pack.id).toBe('custom:generated-2')
    expect(first.pack.id).not.toBe('publisher-controlled-id')
    expect(store.list().filter(({ source }) => source === 'user')).toHaveLength(2)

    const envelope = JSON.parse(
      readFileSync(join(userDataPath, WORKFLOW_PACKS_FILE_NAME), 'utf8')
    ) as Record<string, unknown>
    expect(envelope).toMatchObject({
      format: 'bandal-workflow-packs',
      version: 1,
      disabledIds: [],
      approvals: {}
    })
  })

  test(`refuses more than ${MAX_CUSTOM_WORKFLOW_PACKS} custom packs`, () => {
    let sequence = 0
    const store = createPackStore({
      userDataPath,
      randomUUID: () => `limit-${++sequence}`
    })
    for (let index = 0; index < MAX_CUSTOM_WORKFLOW_PACKS; index += 1) {
      store.importText(packJson(`팩 ${index}`))
    }

    expect(() => store.importText(packJson('한도 초과'))).toThrow(
      `최대 ${MAX_CUSTOM_WORKFLOW_PACKS}개`
    )
    expect(store.list().filter(({ source }) => source === 'user')).toHaveLength(
      MAX_CUSTOM_WORKFLOW_PACKS
    )
  })

  test('quarantines a corrupt envelope and falls back to built-ins', () => {
    const path = join(userDataPath, WORKFLOW_PACKS_FILE_NAME)
    writeFileSync(path, '{broken')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const store = createPackStore({
      userDataPath,
      now: () => new Date('2026-08-27T10:00:00.000Z')
    })

    expect(store.list().every(({ source }) => source === 'builtin')).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(
      readdirSync(userDataPath).some((name) =>
        name.startsWith(`${WORKFLOW_PACKS_FILE_NAME}.corrupt-`)
      )
    ).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('tracks enabled state and approval, then cleans both on removal', () => {
    const store = createPackStore({
      userDataPath,
      randomUUID: () => 'stateful'
    })
    const { pack } = store.importText(packJson())

    store.setEnabled('summary', false)
    store.setEnabled(pack.id, false)
    expect(store.resolve('summary')).toBeNull()
    expect(store.resolve(pack.id)).toBeNull()

    store.setEnabled(pack.id, true)
    store.approve(pack.id, '2026-08-27T10:00:00.000Z')
    expect(store.list().find(({ pack: item }) => item.id === pack.id)).toMatchObject({
      enabled: true,
      approvedAt: '2026-08-27T10:00:00.000Z'
    })
    store.remove(pack.id)
    expect(store.list().some(({ pack: item }) => item.id === pack.id)).toBe(false)
  })
})
