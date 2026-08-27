import {
  resolveKeymap,
  type ShortcutActionId
} from '../../../../shared/keymap'

export type KeybindingOverrides = Record<string, string | null>

/** Effective action -> chord view after the shared winner rules are applied. */
export function effectiveChords(
  overrides: KeybindingOverrides
): ReadonlyMap<ShortcutActionId, string> {
  const result = new Map<ShortcutActionId, string>()
  for (const [chord, action] of resolveKeymap(overrides)) {
    result.set(action, chord)
  }
  return result
}

/** The action that would be displaced by assigning `chord`, if any. */
export function conflictingAction(
  overrides: KeybindingOverrides,
  actionId: ShortcutActionId,
  chord: string
): ShortcutActionId | null {
  const owner = resolveKeymap(overrides).get(chord)
  return owner === undefined || owner === actionId ? null : owner
}

/** Assigns a chord and explicitly unbinds its previous owner. */
export function assignChord(
  overrides: KeybindingOverrides,
  actionId: ShortcutActionId,
  chord: string,
  displaced: ShortcutActionId | null
): KeybindingOverrides {
  return {
    ...overrides,
    ...(displaced === null ? {} : { [displaced]: null }),
    [actionId]: chord
  }
}

/** Removes an override so the shared default becomes authoritative again. */
export function restoreDefault(
  overrides: KeybindingOverrides,
  actionId: ShortcutActionId,
  displaced: ShortcutActionId | null
): KeybindingOverrides {
  const next: KeybindingOverrides = {
    ...overrides,
    ...(displaced === null ? {} : { [displaced]: null })
  }
  delete next[actionId]
  return next
}
