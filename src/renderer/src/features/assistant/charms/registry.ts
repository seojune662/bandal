import type { OrbCharmId } from '../../../../../shared/orbCharm'
import { ORB_CHARM_IDS } from '../../../../../shared/orbCharm'
import { balloonTheme } from './themes/balloon'
import { bungeeTheme } from './themes/bungee'
import { catTheme } from './themes/cat'
import { chainTheme } from './themes/chain'
import { lanternTheme } from './themes/lantern'
import { slothTheme } from './themes/sloth'
import { spiderTheme } from './themes/spider'
import { teruTheme } from './themes/teru'
import { windchimeTheme } from './themes/windchime'
import { yoyoTheme } from './themes/yoyo'
import type { CharmTheme, CharmThemeId } from './types'

export const CHARM_THEMES: Record<CharmThemeId, CharmTheme> = {
  spider: spiderTheme,
  balloon: balloonTheme,
  cat: catTheme,
  chain: chainTheme,
  sloth: slothTheme,
  bungee: bungeeTheme,
  lantern: lanternTheme,
  teru: teruTheme,
  windchime: windchimeTheme,
  yoyo: yoyoTheme
}

/** Picker order — `none` first, then the registry order. */
export const CHARM_OPTIONS: readonly OrbCharmId[] = ORB_CHARM_IDS

export function getCharmTheme(id: OrbCharmId): CharmTheme | null {
  return id === 'none' ? null : CHARM_THEMES[id]
}
