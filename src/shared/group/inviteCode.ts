/**
 * Crockford Base32 invite codes (docs/phase2-community.md §2.4 / §5.2).
 *
 * The alphabet is `0-9 A-Z` minus the four look-alikes `I L O U` = 32 symbols,
 * so 6 characters cover 32^6 ≈ 1.07e9 — three orders of magnitude better than
 * six digits, while still *feeling* like a six-digit code.
 *
 * This module is the exact TypeScript twin of the SQL helpers
 * `public.normalize_invite_code()` / the `^[0-9A-HJ-KM-NP-TV-Z]{6}$` check
 * constraint. Keep them in sync: the renderer normalizes for the 6-box overlay
 * and main normalizes before spending a rate-limit attempt, but the server
 * normalizes again and its answer is the one that counts.
 */

export const INVITE_CODE_LENGTH = 6

/** 32 symbols, ordered — index i is the value i. */
export const INVITE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const VALID_CODE = /^[0-9A-HJ-KM-NP-TV-Z]{6}$/
const NON_ALPHABET = /[^0-9A-HJ-KM-NP-TV-Z]/g

/**
 * Uppercase → fold the look-alikes (`O`→`0`, `I`/`L`→`1`) → drop everything
 * else (spaces, hyphens, the `U` nobody should have typed).
 *
 * Note this is intentionally lossy in a *forgiving* direction: a user reading
 * a code aloud over KakaoTalk produces `O`/`I`/`L` constantly, and mapping
 * them means the overlay accepts what people actually type.
 */
export function normalizeInviteCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(NON_ALPHABET, '')
}

/** True only for an already-normalized, complete 6-character code. */
export function isValidInviteCode(code: string): boolean {
  return VALID_CODE.test(code)
}

/**
 * Normalizes then truncates to six characters — what the 6-box overlay binds
 * to. Pasting `k7m2-qx99` yields `K7M2QX`, which auto-submits (§5.2).
 */
export function toInviteCodeInput(raw: string): string {
  return normalizeInviteCode(raw).slice(0, INVITE_CODE_LENGTH)
}

/** Only these may sit between characters of a pasted code. */
const CODE_SEPARATORS = /[\s\-_]/g

/**
 * Does clipboard text look like a code worth prefilling?
 *
 * Deliberately strict, and NOT just `normalizeInviteCode(...)` + validate:
 * normalization discards every character outside the alphabet, so
 * `"코드는 K7M2QX 야"` would reduce to a valid-looking code and auto-submit —
 * spending one of the five attempts per five minutes on a guess the user never
 * made. So the clipboard must be the code and nothing else: strip separators
 * only, then require exactly six characters before normalizing.
 */
export function inviteCodeFromClipboard(text: string): string | null {
  const compact = text.trim().replace(CODE_SEPARATORS, '')
  if (compact.length !== INVITE_CODE_LENGTH) return null
  const normalized = normalizeInviteCode(compact)
  return isValidInviteCode(normalized) ? normalized : null
}

/** Display form used in toasts and the invite panel. */
export function formatInviteCode(code: string): string {
  return normalizeInviteCode(code).slice(0, INVITE_CODE_LENGTH)
}
