/**
 * 오브 참(orb charm) — 반달 AI 오브에 매달려 물리에 따라 흔들리는 장식 테마.
 * 식별자만 공유한다(main 의 sanitizer 와 renderer 가 함께 import).
 * 테마의 그림·물리 파라미터는 renderer 의 charms/registry.ts 가 소유한다.
 */

export const ORB_CHARM_IDS = [
  'none',
  'spider',
  'balloon',
  'cat',
  'chain',
  'sloth',
  'bungee',
  'lantern',
  'teru',
  'windchime',
  'yoyo'
] as const

export type OrbCharmId = (typeof ORB_CHARM_IDS)[number]

/** 기존 사용자에게 변화가 없도록 기본은 꺼짐. */
export const DEFAULT_ORB_CHARM: OrbCharmId = 'none'

export function isOrbCharmId(value: unknown): value is OrbCharmId {
  return (
    typeof value === 'string' &&
    (ORB_CHARM_IDS as readonly string[]).includes(value)
  )
}
