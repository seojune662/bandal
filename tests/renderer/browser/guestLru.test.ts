import { describe, expect, test } from 'vitest'
import {
  pickEvictions,
  touchOrder
} from '../../../src/renderer/src/features/browser/guestLru'

describe('touchOrder', () => {
  test('moves the id to the most-recently-used end', () => {
    expect(touchOrder(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
  })

  test('ignores unknown ids and never mutates the input', () => {
    const order = ['a', 'b']
    expect(touchOrder(order, 'zz')).toEqual(['a', 'b'])
    expect(order).toEqual(['a', 'b'])
  })
})

describe('pickEvictions', () => {
  const hidden = (ids: string[]) => (id: string) => ids.includes(id)

  test('no evictions within the cap', () => {
    expect(pickEvictions(['a', 'b'], 5, hidden(['a', 'b']))).toEqual([])
  })

  test('evicts oldest hidden guests first', () => {
    expect(
      pickEvictions(['a', 'b', 'c', 'd', 'e', 'f'], 5, hidden(['b', 'd']))
    ).toEqual(['b'])
  })

  test('never evicts visible guests (soft cap)', () => {
    expect(pickEvictions(['a', 'b', 'c'], 2, hidden([]))).toEqual([])
  })

  test('evicts multiple when far over the cap', () => {
    expect(
      pickEvictions(['a', 'b', 'c', 'd'], 2, hidden(['a', 'b', 'c', 'd']))
    ).toEqual(['a', 'b'])
  })
})
