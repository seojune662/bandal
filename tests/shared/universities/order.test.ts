/**
 * `serviceOrder` helpers are pure and drive what the store persists, so a
 * no-op must hand back an equal list, never a scrambled one.
 */

import { describe, expect, test } from 'vitest'
import {
  applyServiceOrder,
  moveServiceBefore,
  moveServiceBy,
  moveServiceToEnd
} from '../../../src/shared/universities/order'

const BASE = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
const idsOf = (items: readonly { id: string }[]): string[] => items.map((i) => i.id)

describe('applyServiceOrder', () => {
  test('an empty order keeps catalog order and returns a copy', () => {
    const result = applyServiceOrder(BASE, [])
    expect(idsOf(result)).toEqual(['a', 'b', 'c', 'd'])
    expect(result).not.toBe(BASE)
  })

  test('ranked ids come first in order, the rest follow in base order', () => {
    expect(idsOf(applyServiceOrder(BASE, ['c', 'a']))).toEqual(['c', 'a', 'b', 'd'])
  })

  test('unknown ids in the order are ignored', () => {
    expect(idsOf(applyServiceOrder(BASE, ['zzz', 'd', 'nope']))).toEqual([
      'd',
      'a',
      'b',
      'c'
    ])
  })

  test('a duplicated id ranks by its first occurrence', () => {
    expect(idsOf(applyServiceOrder(BASE, ['b', 'a', 'b']))).toEqual(['b', 'a', 'c', 'd'])
  })

  test('is stable for entries sharing an id', () => {
    const twins = [{ id: 'x', n: 1 }, { id: 'y', n: 2 }, { id: 'x', n: 3 }]
    expect(applyServiceOrder(twins, ['x']).map((t) => t.n)).toEqual([1, 3, 2])
  })

  test('does not mutate the input', () => {
    const input = [...BASE]
    applyServiceOrder(input, ['d', 'c'])
    expect(idsOf(input)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('moveServiceBefore', () => {
  const ids = ['a', 'b', 'c', 'd']

  test('moves the source directly before the target, either direction', () => {
    expect(moveServiceBefore(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveServiceBefore(ids, 'a', 'd')).toEqual(['b', 'c', 'a', 'd'])
  })

  test('is a no-op for the same id or an unknown id', () => {
    expect(moveServiceBefore(ids, 'b', 'b')).toEqual(ids)
    expect(moveServiceBefore(ids, 'zzz', 'b')).toEqual(ids)
    expect(moveServiceBefore(ids, 'b', 'zzz')).toEqual(ids)
  })

  test('returns a new array and leaves the input alone', () => {
    const result = moveServiceBefore(ids, 'c', 'a')
    expect(result).not.toBe(ids)
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('moveServiceToEnd', () => {
  test('appends the source after everything else', () => {
    expect(moveServiceToEnd(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
  })

  test('is a no-op when already last or unknown', () => {
    expect(moveServiceToEnd(['a', 'b'], 'b')).toEqual(['a', 'b'])
    expect(moveServiceToEnd(['a', 'b'], 'zzz')).toEqual(['a', 'b'])
  })
})

describe('moveServiceBy', () => {
  const ids = ['a', 'b', 'c']

  test('swaps with the neighbour in the given direction', () => {
    expect(moveServiceBy(ids, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveServiceBy(ids, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  test('is a no-op at either edge or for an unknown id', () => {
    expect(moveServiceBy(ids, 'a', -1)).toEqual(ids)
    expect(moveServiceBy(ids, 'c', 1)).toEqual(ids)
    expect(moveServiceBy(ids, 'zzz', 1)).toEqual(ids)
  })

  test('does not mutate the input', () => {
    moveServiceBy(ids, 'a', 1)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})
