import { describe, expect, test } from 'vitest'
import {
  createScrollMemory,
  pdfScrollMemory,
  SCROLL_MEMORY_CAPACITY,
  type ScrollMemoryEntry
} from '../../../src/renderer/src/features/pdf/lib/scrollMemory'

const entry = (scrollTop: number): ScrollMemoryEntry => ({
  scrollTop,
  scrollHeight: 10000,
  zoom: 1
})

describe('createScrollMemory', () => {
  test('returns stored entries per (courseId, relPath) key', () => {
    // Arrange
    const memory = createScrollMemory(3)

    // Act
    memory.set('c1', 'week1/os.pdf', entry(1200))

    // Assert
    expect(memory.get('c1', 'week1/os.pdf')).toEqual(entry(1200))
    expect(memory.get('c1', 'week2/os.pdf')).toBeNull()
    expect(memory.get('c2', 'week1/os.pdf')).toBeNull()
  })

  test('overwriting a key keeps a single entry', () => {
    const memory = createScrollMemory(3)

    memory.set('c1', 'a.pdf', entry(100))
    memory.set('c1', 'a.pdf', entry(999))

    expect(memory.size()).toBe(1)
    expect(memory.get('c1', 'a.pdf')?.scrollTop).toBe(999)
  })

  test('evicts the least recently used entry beyond capacity', () => {
    const memory = createScrollMemory(3)
    memory.set('c', 'a.pdf', entry(1))
    memory.set('c', 'b.pdf', entry(2))
    memory.set('c', 'c.pdf', entry(3))

    memory.set('c', 'd.pdf', entry(4))

    expect(memory.size()).toBe(3)
    expect(memory.get('c', 'a.pdf')).toBeNull()
    expect(memory.get('c', 'd.pdf')?.scrollTop).toBe(4)
  })

  test('get refreshes recency, protecting the entry from eviction', () => {
    const memory = createScrollMemory(3)
    memory.set('c', 'a.pdf', entry(1))
    memory.set('c', 'b.pdf', entry(2))
    memory.set('c', 'c.pdf', entry(3))

    // Act: touch the oldest, then push one beyond capacity.
    memory.get('c', 'a.pdf')
    memory.set('c', 'd.pdf', entry(4))

    // Assert: 'b' (now oldest) was evicted instead of 'a'.
    expect(memory.get('c', 'a.pdf')?.scrollTop).toBe(1)
    expect(memory.get('c', 'b.pdf')).toBeNull()
  })

  test('set on an existing key also refreshes recency', () => {
    const memory = createScrollMemory(2)
    memory.set('c', 'a.pdf', entry(1))
    memory.set('c', 'b.pdf', entry(2))

    memory.set('c', 'a.pdf', entry(11))
    memory.set('c', 'c.pdf', entry(3))

    expect(memory.keys()).toEqual(['c\u0000a.pdf', 'c\u0000c.pdf'])
  })
})

describe('pdfScrollMemory singleton', () => {
  test('exists with the documented ~20-entry capacity', () => {
    expect(SCROLL_MEMORY_CAPACITY).toBe(20)

    for (let index = 0; index < SCROLL_MEMORY_CAPACITY + 5; index += 1) {
      pdfScrollMemory.set('course', `file-${index}.pdf`, entry(index))
    }

    expect(pdfScrollMemory.size()).toBe(SCROLL_MEMORY_CAPACITY)
  })
})
