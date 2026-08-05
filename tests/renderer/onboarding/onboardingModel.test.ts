import { describe, expect, test } from 'vitest'
import {
  DEFAULT_ONBOARDING,
  ONBOARDING_FLOW_VERSION,
  type OnboardingState
} from '../../../src/shared/types/settings'
import {
  closeOnboarding,
  completeStep,
  initialStep,
  ONBOARDING_STEP_COUNT,
  reopenedOnboarding,
  shouldShowOnboarding
} from '../../../src/renderer/src/features/onboarding/onboardingModel'

const NOW = new Date('2026-08-05T12:00:00.000Z')

function closedState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    flowVersion: ONBOARDING_FLOW_VERSION,
    closedAt: '2026-08-01T00:00:00.000Z',
    lastCompletedStep: 3,
    ...overrides
  }
}

describe('shouldShowOnboarding', () => {
  test('shows on first run (missing or default state)', () => {
    expect(shouldShowOnboarding(undefined)).toBe(true)
    expect(shouldShowOnboarding(null)).toBe(true)
    expect(shouldShowOnboarding(DEFAULT_ONBOARDING)).toBe(true)
  })

  test('stays closed once dismissed on the current flow version', () => {
    expect(shouldShowOnboarding(closedState())).toBe(false)
  })

  test('reopens once when the flow version advanced past the dismissal', () => {
    expect(
      shouldShowOnboarding(
        closedState({ flowVersion: ONBOARDING_FLOW_VERSION - 1 })
      )
    ).toBe(true)
  })

  test('a future flow version never re-triggers', () => {
    expect(
      shouldShowOnboarding(
        closedState({ flowVersion: ONBOARDING_FLOW_VERSION + 1 })
      )
    ).toBe(false)
  })
})

describe('initialStep', () => {
  test('starts from the top with no prior progress', () => {
    expect(initialStep(undefined)).toBe(0)
    expect(initialStep(DEFAULT_ONBOARDING)).toBe(0)
  })

  test('resumes after the last completed step', () => {
    expect(
      initialStep({ ...DEFAULT_ONBOARDING, lastCompletedStep: 1 })
    ).toBe(1)
    expect(
      initialStep({ ...DEFAULT_ONBOARDING, lastCompletedStep: 2 })
    ).toBe(2)
  })

  test('clamps fully-completed progress to the last step', () => {
    expect(
      initialStep({ ...DEFAULT_ONBOARDING, lastCompletedStep: 3 })
    ).toBe(ONBOARDING_STEP_COUNT - 1)
    expect(
      initialStep({ ...DEFAULT_ONBOARDING, lastCompletedStep: 99 })
    ).toBe(ONBOARDING_STEP_COUNT - 1)
  })

  test('an older flow version restarts from step 0', () => {
    expect(
      initialStep({
        flowVersion: ONBOARDING_FLOW_VERSION - 1,
        closedAt: null,
        lastCompletedStep: 2
      })
    ).toBe(0)
  })
})

describe('completeStep', () => {
  test('advances lastCompletedStep past the finished step', () => {
    const next = completeStep(DEFAULT_ONBOARDING, 0)
    expect(next.lastCompletedStep).toBe(1)
    expect(next.closedAt).toBeNull()
    expect(next.flowVersion).toBe(ONBOARDING_FLOW_VERSION)
  })

  test('is monotonic — revisiting an earlier step never regresses', () => {
    const advanced = { ...DEFAULT_ONBOARDING, lastCompletedStep: 2 }
    expect(completeStep(advanced, 0).lastCompletedStep).toBe(2)
    expect(completeStep(advanced, 2).lastCompletedStep).toBe(3)
  })

  test('returns a new object (no mutation)', () => {
    const before = { ...DEFAULT_ONBOARDING }
    const next = completeStep(before, 1)
    expect(next).not.toBe(before)
    expect(before.lastCompletedStep).toBe(0)
  })
})

describe('closeOnboarding', () => {
  test('stamps closedAt and the current flow version', () => {
    const closed = closeOnboarding(DEFAULT_ONBOARDING, NOW)
    expect(closed.closedAt).toBe(NOW.toISOString())
    expect(closed.flowVersion).toBe(ONBOARDING_FLOW_VERSION)
    expect(shouldShowOnboarding(closed)).toBe(false)
  })

  test('keeps completed-step progress for a later deliberate reopen', () => {
    const closed = closeOnboarding(
      { ...DEFAULT_ONBOARDING, lastCompletedStep: 2 },
      NOW
    )
    expect(closed.lastCompletedStep).toBe(2)
  })
})

describe('reopenedOnboarding', () => {
  test('produces a fresh, visible state starting at step 0', () => {
    const reopened = reopenedOnboarding()
    expect(shouldShowOnboarding(reopened)).toBe(true)
    expect(initialStep(reopened)).toBe(0)
  })
})
