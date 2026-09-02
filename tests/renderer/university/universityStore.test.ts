/**
 * The layout mutators (order + 더보기 tier) follow `setServiceHidden`:
 * optimistic state, then `settings:set` with the whole university slice.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  invoke: vi.fn(),
  onPush: vi.fn(() => () => {}),
  openSettingsWindow: vi.fn()
}))

import { invoke } from '../../../src/renderer/src/lib/ipc'
import {
  resetUniversityStoreForTests,
  useUniversityStore
} from '../../../src/renderer/src/stores/universityStore'
import { findUniversity } from '../../../src/shared/universities'

const invokeMock = vi.mocked(invoke)

const SNU_IDS = (findUniversity('snu')?.services ?? []).map((service) => service.id)
const serviceIds = (): string[] =>
  useUniversityStore.getState().services.map((service) => service.id)
const lastPersisted = (): unknown =>
  invokeMock.mock.calls[invokeMock.mock.calls.length - 1]?.[1]

beforeEach(async () => {
  resetUniversityStoreForTests()
  invokeMock.mockReset()
  invokeMock.mockResolvedValue({ ok: true } as never)
  await useUniversityStore.getState().selectPreset('snu')
})

describe('universityStore layout mutators', () => {
  test('selecting a school lists presets, then 에브리타임, in catalog order', () => {
    expect(serviceIds()).toEqual([...SNU_IDS, 'common.everytime'])
    expect(
      useUniversityStore.getState().services.find((s) => s.id === 'common.everytime')
        ?.secondary
    ).toBe(false)
  })

  test('reorderServices persists the given order verbatim and re-sorts', async () => {
    await useUniversityStore.getState().reorderServices(['common.everytime', 'snu.mail'])

    expect(serviceIds().slice(0, 2)).toEqual(['common.everytime', 'snu.mail'])
    expect(useUniversityStore.getState().settings.serviceOrder).toEqual([
      'common.everytime',
      'snu.mail'
    ])
    expect(lastPersisted()).toEqual({
      university: expect.objectContaining({
        universityId: 'snu',
        serviceOrder: ['common.everytime', 'snu.mail']
      })
    })
  })

  test('moveService nudges one step and writes the full order', async () => {
    await useUniversityStore.getState().moveService('common.everytime', -1)

    const expected = [
      ...SNU_IDS.slice(0, -1),
      'common.everytime',
      SNU_IDS[SNU_IDS.length - 1] as string
    ]
    expect(serviceIds()).toEqual(expected)
    expect(useUniversityStore.getState().settings.serviceOrder).toEqual(expected)
  })

  test('moveService keeps hidden services in their slot', async () => {
    const store = useUniversityStore.getState()
    const [first, second] = SNU_IDS as [string, string]
    await store.setServiceHidden(second, true)

    await useUniversityStore.getState().moveService(first, 1)

    // The hidden entry still occupies its position in the persisted order…
    const order = useUniversityStore.getState().settings.serviceOrder
    expect(order.slice(0, 2)).toEqual([second, first])
    // …but stays out of the sidebar list.
    expect(serviceIds()).not.toContain(second)
    expect(serviceIds()[0]).toBe(first)
  })

  test('moveService at the edge is a no-op that still persists', async () => {
    const first = SNU_IDS[0] as string
    await useUniversityStore.getState().moveService(first, -1)

    expect(serviceIds()).toEqual([...SNU_IDS, 'common.everytime'])
  })

  test('setServiceSecondary overrides the preset tier both ways', async () => {
    const store = useUniversityStore.getState()
    await store.setServiceSecondary('snu.food', false)
    await useUniversityStore.getState().setServiceSecondary('snu.portal', true)

    const services = useUniversityStore.getState().services
    expect(services.find((s) => s.id === 'snu.food')?.secondary).toBe(false)
    expect(services.find((s) => s.id === 'snu.portal')?.secondary).toBe(true)
    expect(useUniversityStore.getState().settings.secondaryOverrides).toEqual({
      'snu.food': false,
      'snu.portal': true
    })
    expect(lastPersisted()).toEqual({
      university: expect.objectContaining({
        secondaryOverrides: { 'snu.food': false, 'snu.portal': true }
      })
    })
  })

  test('resetServiceLayout clears order and tiers but keeps hidden/external', async () => {
    const store = useUniversityStore.getState()
    await store.reorderServices(['common.everytime'])
    await useUniversityStore.getState().setServiceSecondary('snu.portal', true)
    await useUniversityStore.getState().setServiceHidden('snu.food', true)
    await useUniversityStore.getState().setOpenExternally('snu.mail', false)

    await useUniversityStore.getState().resetServiceLayout()

    const settings = useUniversityStore.getState().settings
    expect(settings.serviceOrder).toEqual([])
    expect(settings.secondaryOverrides).toEqual({})
    expect(settings.hiddenServiceIds).toEqual(['snu.food'])
    expect(settings.openExternallyOverrides).toEqual({ 'snu.mail': false })
    expect(serviceIds()[0]).toBe(SNU_IDS[0])
  })

  test('switching schools drops the layout like every other per-service tweak', async () => {
    await useUniversityStore.getState().reorderServices(['common.everytime'])
    await useUniversityStore.getState().setServiceSecondary('snu.portal', true)

    await useUniversityStore.getState().selectPreset('kaist')

    const settings = useUniversityStore.getState().settings
    expect(settings.serviceOrder).toEqual([])
    expect(settings.secondaryOverrides).toEqual({})
  })

  test('a failed save keeps the optimistic state and surfaces an error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    invokeMock.mockRejectedValueOnce(new Error('disk full'))

    await useUniversityStore.getState().reorderServices(['common.everytime'])

    expect(serviceIds()[0]).toBe('common.everytime')
    expect(useUniversityStore.getState().error).not.toBeNull()
    consoleError.mockRestore()
  })
})
