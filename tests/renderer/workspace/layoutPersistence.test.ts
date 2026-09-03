import { describe, expect, test } from 'vitest'
import type { TabDescriptor } from '../../../src/shared/tabs'
import {
  descriptorFor,
  tabPanelId
} from '../../../src/renderer/src/features/workspace/tabIdentity'
import {
  persistentLayout,
  structuralKey,
  tabsFromLayout,
  validateLayout
} from '../../../src/renderer/src/features/workspace/layoutPersistence'
import { createDuplicatePanelId } from '../../../src/renderer/src/features/workspace/tabDuplication'

// -- serialized-layout builders (mirrors dockview's SerializedDockview) ------

function panelState(descriptor: TabDescriptor): Record<string, unknown> {
  return {
    id: tabPanelId(descriptor),
    contentComponent: descriptor.kind,
    title: 'title',
    params: { descriptor }
  }
}

function leaf(
  id: string,
  views: string[],
  activeView?: string
): Record<string, unknown> {
  const data: Record<string, unknown> = { id, views }
  if (activeView !== undefined) data['activeView'] = activeView
  return { type: 'leaf', data, size: 100 }
}

function branch(children: Record<string, unknown>[]): Record<string, unknown> {
  return { type: 'branch', data: children, size: 100 }
}

function layoutDoc(
  root: Record<string, unknown>,
  panels: Record<string, unknown>,
  activeGroup?: string
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    grid: { root, width: 800, height: 600, orientation: 'HORIZONTAL' },
    panels
  }
  if (activeGroup !== undefined) doc['activeGroup'] = activeGroup
  return doc
}

const pdfA = descriptorFor('pdf', { courseId: 'c1', relPath: 'a.pdf' })
const pdfB = descriptorFor('pdf', { courseId: 'c1', relPath: 'b.pdf' })
const note = descriptorFor('note', { courseId: 'c1', relPath: 'n.md' })
const idA = tabPanelId(pdfA)
const idB = tabPanelId(pdfB)
const idNote = tabPanelId(note)

describe('validateLayout', () => {
  test('accepts a healthy document and returns its tabs', () => {
    // Arrange
    const doc = layoutDoc(
      branch([leaf('g1', [idA, idB], idB), leaf('g2', [idNote])]),
      { [idA]: panelState(pdfA), [idB]: panelState(pdfB), [idNote]: panelState(note) },
      'g1'
    )

    // Act
    const result = validateLayout(doc)

    // Assert
    expect(result).not.toBeNull()
    expect(Object.keys(result!.tabs).sort()).toEqual([idA, idB, idNote].sort())
    expect(result!.droppedPanelIds).toEqual([])
    expect((result!.layout as unknown as Record<string, unknown>)['activeGroup']).toBe('g1')
  })

  test('drops panels with unknown TabKind and prunes their group', () => {
    // Arrange: g2 only holds the unknown-kind panel.
    const alien = {
      id: 'terminal:x',
      contentComponent: 'terminal',
      params: { descriptor: { kind: 'terminal', payload: {} } }
    }
    const doc = layoutDoc(
      branch([leaf('g1', [idA], idA), leaf('g2', ['terminal:x'], 'terminal:x')]),
      { [idA]: panelState(pdfA), 'terminal:x': alien },
      'g2'
    )

    // Act
    const result = validateLayout(doc)

    // Assert
    expect(result).not.toBeNull()
    expect(result!.tabs).toEqual({ [idA]: pdfA })
    expect(result!.droppedPanelIds).toContain('terminal:x')
    const grid = (result!.layout as unknown as { grid: { root: { data: unknown[] } } }).grid
    expect(grid.root.data).toHaveLength(1)
    // activeGroup pointed at the pruned group → stripped.
    expect(
      (result!.layout as unknown as Record<string, unknown>)['activeGroup']
    ).toBeUndefined()
  })

  test('drops panels whose id does not match their descriptor identity', () => {
    // Arrange: descriptor says a.pdf but the panel is registered as b.pdf.
    const doc = layoutDoc(leaf('g1', [idB, idA], idA), {
      [idB]: { ...panelState(pdfA), id: idB },
      [idA]: panelState(pdfA)
    })

    // Act
    const result = validateLayout(doc)

    // Assert
    expect(result).not.toBeNull()
    expect(Object.keys(result!.tabs)).toEqual([idA])
    expect(result!.droppedPanelIds).toEqual([idB])
  })

  test('drops only a legacy group-chat panel that has no courseId', () => {
    const legacyGroupPanelId = 'group-chat:g1'
    const doc = layoutDoc(leaf('g1', [idA, legacyGroupPanelId]), {
      [idA]: panelState(pdfA),
      [legacyGroupPanelId]: {
        id: legacyGroupPanelId,
        contentComponent: 'group-chat',
        params: {
          descriptor: { kind: 'group-chat', payload: { groupId: 'g1' } }
        }
      }
    })

    const validate = (): ReturnType<typeof validateLayout> => validateLayout(doc)

    expect(validate).not.toThrow()
    const result = validate()
    expect(result).not.toBeNull()
    expect(result!.tabs).toEqual({ [idA]: pdfA })
    expect(result!.droppedPanelIds).toEqual([legacyGroupPanelId])
  })

  test('silently drops a legacy group-whiteboard panel', () => {
    const legacyPanelId = 'group-whiteboard:g1'
    const doc = layoutDoc(leaf('g1', [idA, legacyPanelId]), {
      [idA]: panelState(pdfA),
      [legacyPanelId]: {
        id: legacyPanelId,
        contentComponent: 'group-whiteboard',
        params: {
          descriptor: { kind: 'group-whiteboard', payload: { groupId: 'g1' } }
        }
      }
    })

    const validate = (): ReturnType<typeof validateLayout> => validateLayout(doc)

    expect(validate).not.toThrow()
    const result = validate()
    expect(result).not.toBeNull()
    expect(result!.tabs).toEqual({ [idA]: pdfA })
    expect(result!.droppedPanelIds).toEqual([legacyPanelId])
  })

  test('accepts a course-scoped group-chat descriptor', () => {
    const groupChat = descriptorFor('group-chat', { courseId: 'c1' })
    const groupChatPanelId = tabPanelId(groupChat)
    const doc = layoutDoc(leaf('g1', [groupChatPanelId]), {
      [groupChatPanelId]: panelState(groupChat)
    })

    const result = validateLayout(doc)

    expect(result).not.toBeNull()
    expect(result!.tabs).toEqual({ [groupChatPanelId]: groupChat })
    expect(result!.droppedPanelIds).toEqual([])
  })

  test('keeps an explicit duplicate view of the same descriptor', () => {
    const duplicateId = createDuplicatePanelId(pdfA)
    const doc = layoutDoc(leaf('g1', [idA, duplicateId], duplicateId), {
      [idA]: panelState(pdfA),
      [duplicateId]: { ...panelState(pdfA), id: duplicateId }
    })

    const result = validateLayout(doc)

    expect(result).not.toBeNull()
    expect(result!.tabs).toEqual({
      [idA]: pdfA,
      [duplicateId]: pdfA
    })
    expect(result!.droppedPanelIds).toEqual([])
  })

  test('fixes a dangling activeView after dropping a panel', () => {
    const doc = layoutDoc(leaf('g1', [idA, 'ghost'], 'ghost'), {
      [idA]: panelState(pdfA),
      ghost: { bogus: true }
    })

    const result = validateLayout(doc)

    expect(result).not.toBeNull()
    const root = (result!.layout as unknown as {
      grid: { root: { data: { views: string[]; activeView?: string } } }
    }).grid.root
    expect(root.data.views).toEqual([idA])
    expect(root.data.activeView).toBe(idA)
  })

  test('drops valid panels not referenced by the grid (floating leftovers)', () => {
    const doc = layoutDoc(leaf('g1', [idA]), {
      [idA]: panelState(pdfA),
      [idNote]: panelState(note) // referenced by no group
    })

    const result = validateLayout(doc)

    expect(result).not.toBeNull()
    expect(Object.keys(result!.tabs)).toEqual([idA])
    expect(result!.droppedPanelIds).toContain(idNote)
  })

  test('returns null when nothing valid remains or the doc is malformed', () => {
    expect(validateLayout(null)).toBeNull()
    expect(validateLayout('garbage')).toBeNull()
    expect(validateLayout({})).toBeNull()
    expect(validateLayout({ grid: {}, panels: {} })).toBeNull()
    expect(
      validateLayout(layoutDoc(leaf('g1', ['x']), { x: { nope: 1 } }))
    ).toBeNull()
    expect(
      validateLayout({
        grid: { root: { type: 'weird' }, width: 1, height: 1, orientation: 'HORIZONTAL' },
        panels: { [idA]: panelState(pdfA) }
      })
    ).toBeNull()
  })
})

describe('structuralKey', () => {
  const base = (): Record<string, unknown> =>
    layoutDoc(
      branch([leaf('g1', [idA, idB], idA), leaf('g2', [idNote], idNote)]),
      { [idA]: panelState(pdfA), [idB]: panelState(pdfB), [idNote]: panelState(note) },
      'g1'
    )

  test('ignores decorative focus changes (activeGroup / activeView)', () => {
    // Arrange
    const focused = base()
    const refocused = layoutDoc(
      branch([leaf('g1', [idA, idB], idB), leaf('g2', [idNote], idNote)]),
      { [idA]: panelState(pdfA), [idB]: panelState(pdfB), [idNote]: panelState(note) },
      'g2'
    )

    // Act / Assert
    expect(structuralKey(focused)).toBe(structuralKey(refocused))
  })

  test('changes on resize', () => {
    const resized = base()
    const grid = resized['grid'] as { root: { data: { size: number }[] } }
    grid.root.data[0]!.size = 300

    expect(structuralKey(base())).not.toBe(structuralKey(resized))
  })

  test('changes on open/close/move', () => {
    const closed = layoutDoc(
      branch([leaf('g1', [idA], idA), leaf('g2', [idNote], idNote)]),
      { [idA]: panelState(pdfA), [idNote]: panelState(note) },
      'g1'
    )
    const moved = layoutDoc(
      branch([leaf('g1', [idB, idA], idA), leaf('g2', [idNote], idNote)]),
      { [idA]: panelState(pdfA), [idB]: panelState(pdfB), [idNote]: panelState(note) },
      'g1'
    )

    expect(structuralKey(base())).not.toBe(structuralKey(closed))
    expect(structuralKey(base())).not.toBe(structuralKey(moved))
  })
})

describe('tabsFromLayout', () => {
  test('extracts descriptors from a live serialized layout', () => {
    const doc = layoutDoc(leaf('g1', [idA, idNote]), {
      [idA]: panelState(pdfA),
      [idNote]: panelState(note),
      broken: { params: { descriptor: { kind: 'nope' } } }
    })

    expect(tabsFromLayout(doc)).toEqual({ [idA]: pdfA, [idNote]: note })
    expect(tabsFromLayout(null)).toEqual({})
  })
})

describe('persistentLayout', () => {
  const normalBrowser = descriptorFor('browser', {
    tabId: 'normal-browser',
    initialUrl: 'https://bandal.io'
  })
  const privateBrowser = descriptorFor('browser', {
    tabId: 'private-browser',
    initialUrl: 'https://accounts.google.com',
    isPrivate: true
  })
  const normalId = tabPanelId(normalBrowser)
  const privateId = tabPanelId(privateBrowser)

  test('removes only private browser panels and repairs the active view', () => {
    const doc = layoutDoc(
      leaf('g1', [normalId, privateId], privateId),
      {
        [normalId]: panelState(normalBrowser),
        [privateId]: panelState(privateBrowser)
      },
      'g1'
    )

    const persisted = persistentLayout(doc) as ReturnType<typeof layoutDoc>
    const panels = persisted['panels'] as Record<string, unknown>
    const root = (persisted['grid'] as {
      root: { data: { views: string[]; activeView?: string } }
    }).root

    expect(Object.keys(panels)).toEqual([normalId])
    expect(root.data.views).toEqual([normalId])
    expect(root.data.activeView).toBe(normalId)
    expect((doc['panels'] as Record<string, unknown>)[privateId]).toBeDefined()
  })

  test('persists an empty workspace when every open tab is private', () => {
    const doc = layoutDoc(leaf('g1', [privateId], privateId), {
      [privateId]: panelState(privateBrowser)
    })

    expect(persistentLayout(doc)).toEqual({})
  })
})
