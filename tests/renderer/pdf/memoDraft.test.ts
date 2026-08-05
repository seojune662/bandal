import { describe, expect, test, vi } from 'vitest'
import {
  createMemoDraft,
  normalizeMemo
} from '../../../src/renderer/src/features/pdf/lib/memoDraft'

/**
 * Models the highlight popover's lifecycle around a memo draft, mirroring how
 * HighlightPopover wires createMemoDraft:
 *
 * - `clickOutside` is the capture-phase `pointerdown` dismiss path. It commits
 *   explicitly and then unmounts. Crucially it does NOT fire `blur` — Chrome
 *   fires no blur for a focused element removed from the DOM, which is exactly
 *   how memos used to disappear.
 * - `unmount` runs the cleanup effect's `commit()` safety net.
 */
function openPopover(
  savedComment: string | null,
  onSave: (comment: string | null) => void
) {
  const memo = createMemoDraft(savedComment, onSave)
  let discardArmed = false

  return {
    visibleValue: () => memo.value(),
    isSaveEnabled: () => memo.isDirty(),
    isDiscardArmed: () => discardArmed,
    type(text: string) {
      memo.setValue(text)
      discardArmed = false
    },
    /** Capture-phase outside pointerdown → commit → unmount, with no blur. */
    clickOutside() {
      memo.commit()
      this.unmount()
    },
    /** ⌘↩ and the 저장 button take the same path. */
    saveAndClose() {
      memo.commit()
      this.unmount()
    },
    escape() {
      if (!memo.isDirty()) {
        this.unmount()
        return
      }
      if (!discardArmed) {
        discardArmed = true
        return
      }
      this.discardAndClose()
    },
    discardAndClose() {
      memo.abandon()
      this.unmount()
    },
    deleteHighlight() {
      memo.abandon()
      this.unmount()
    },
    /** React cleanup effect. */
    unmount() {
      memo.commit()
    }
  }
}

describe('normalizeMemo', () => {
  test('trims surrounding whitespace', () => {
    expect(normalizeMemo('  중간고사 범위  ')).toBe('중간고사 범위')
  })

  test.each(['', '   ', '\n\t '])('collapses blank memo %j to null', (blank) => {
    expect(normalizeMemo(blank)).toBeNull()
  })
})

describe('highlight memo draft', () => {
  test('type → click outside → reopen keeps the memo', () => {
    // Arrange: a highlight with no memo yet. `store` stands in for the
    // annotation row the popover reads back on reopen.
    let store: string | null = null
    const save = vi.fn((comment: string | null) => {
      store = comment
    })

    // Act: type a memo, then click somewhere in the page. No blur fires.
    const first = openPopover(store, save)
    first.type('감가상각은 3장 시험 범위')
    first.clickOutside()

    // Assert: it was persisted exactly once...
    expect(save).toHaveBeenCalledTimes(1)
    expect(store).toBe('감가상각은 3장 시험 범위')

    // ...and reopening the same highlight shows it back.
    const reopened = openPopover(store, save)
    expect(reopened.visibleValue()).toBe('감가상각은 3장 시험 범위')
    expect(reopened.isSaveEnabled()).toBe(false)
  })

  test('does not save the same edit twice when several exit paths run', () => {
    const save = vi.fn()
    const popover = openPopover(null, save)
    popover.type('메모')
    // dismiss handler commits, then the unmount cleanup commits again
    popover.clickOutside()
    popover.unmount()
    expect(save).toHaveBeenCalledTimes(1)
  })

  test('closing without edits saves nothing', () => {
    const save = vi.fn()
    const popover = openPopover('기존 메모', save)
    popover.clickOutside()
    expect(save).not.toHaveBeenCalled()
  })

  test('trims the memo and stores an emptied memo as null', () => {
    const save = vi.fn()
    const popover = openPopover('지울 메모', save)
    popover.type('   ')
    popover.saveAndClose()
    expect(save).toHaveBeenCalledWith(null)
  })

  test('an unmount with no other exit path still lands the memo', () => {
    const save = vi.fn()
    const popover = openPopover(null, save)
    popover.type('탭이 닫혀도 남아야 하는 메모')
    popover.unmount()
    expect(save).toHaveBeenCalledWith('탭이 닫혀도 남아야 하는 메모')
  })

  test('Escape with unsaved edits asks before discarding', () => {
    const save = vi.fn()
    const popover = openPopover(null, save)
    popover.type('실수로 지우면 안 되는 메모')

    popover.escape()
    expect(popover.isDiscardArmed()).toBe(true)
    expect(save).not.toHaveBeenCalled()

    // Confirmed: the memo is dropped on purpose, and the unmount safety net
    // must not resurrect it.
    popover.escape()
    expect(save).not.toHaveBeenCalled()
  })

  test('typing again disarms the discard confirmation', () => {
    const save = vi.fn()
    const popover = openPopover(null, save)
    popover.type('메모')
    popover.escape()
    popover.type('메모 추가')
    expect(popover.isDiscardArmed()).toBe(false)

    popover.clickOutside()
    expect(save).toHaveBeenCalledWith('메모 추가')
  })

  test('Escape with no unsaved edits just closes', () => {
    const save = vi.fn()
    const popover = openPopover('기존 메모', save)
    popover.escape()
    expect(popover.isDiscardArmed()).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  test('deleting the highlight does not resurrect its memo on unmount', () => {
    const save = vi.fn()
    const popover = openPopover(null, save)
    popover.type('곧 지울 하이라이트의 메모')
    popover.deleteHighlight()
    expect(save).not.toHaveBeenCalled()
  })

  test('a late round trip of the saved value never clobbers live typing', () => {
    const save = vi.fn()
    const memo = createMemoDraft(null, save)

    memo.setValue('첫 메모')
    memo.commit()
    memo.setValue('첫 메모 + 이어서 타이핑')

    // The annotation prop finally catches up with the earlier save.
    memo.syncSaved('첫 메모')

    expect(memo.value()).toBe('첫 메모 + 이어서 타이핑')
    expect(memo.isDirty()).toBe(true)
    memo.commit()
    expect(save).toHaveBeenLastCalledWith('첫 메모 + 이어서 타이핑')
  })

  test('adopts an externally edited memo while the draft is clean', () => {
    const memo = createMemoDraft('원래 메모', vi.fn())
    memo.syncSaved('다른 곳에서 고친 메모')
    expect(memo.value()).toBe('다른 곳에서 고친 메모')
    expect(memo.isDirty()).toBe(false)
  })

  test('revert restores the last persisted value', () => {
    const memo = createMemoDraft('원래 메모', vi.fn())
    memo.setValue('망친 메모')
    memo.revert()
    expect(memo.value()).toBe('원래 메모')
    expect(memo.isDirty()).toBe(false)
  })
})
