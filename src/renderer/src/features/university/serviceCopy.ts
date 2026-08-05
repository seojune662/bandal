/**
 * Korean copy for university shortcuts (pure — no React, no IPC).
 *
 * Tone: 앱 본체는 해요체 (docs/STYLEGUIDE.md §7). Every string that explains
 * *why* something leaves the app has to answer the student's real question —
 * "왜 여기서 안 열려요?" — in one line, without blaming them or the school.
 */

import type { ExternalReason, VerificationLevel } from '../../../../shared/types/university'

/** Tooltip on a shortcut that opens in the system browser. */
export function externalReasonMessage(reason: ExternalReason | undefined): string {
  switch (reason) {
    case 'federated-login':
      return '이 사이트는 앱 안에서 로그인이 막혀 있어 기본 브라우저로 열려요.'
    case 'ua-sniffing':
      return '이 사이트는 앱 안의 브라우저를 알아보지 못해서 기본 브라우저로 열려요.'
    case 'native-plugin':
      return '이 사이트는 따로 설치하는 보안 프로그램이 필요해서 기본 브라우저로 열려요.'
    default:
      return '이 사이트는 앱 안에서 열리지 않아 기본 브라우저로 열려요.'
  }
}

/** Short badge next to a shortcut whose URL we could not fully verify. */
export function verificationBadge(level: VerificationLevel): string | null {
  switch (level) {
    case 'verified':
      return null
    case 'partial':
      return '확인 중'
    case 'unverified':
      return '미확인'
  }
}

/** 설정 창 톤(합니다체)으로 쓰는 확인일 문구. */
export function verifiedAtLabel(verifiedAt: string): string {
  return verifiedAt.length === 0 ? '확인일 정보 없음' : `확인일 ${verifiedAt}`
}

/** Message for a pasted URL we could not use at all. */
export function courseUrlErrorMessage(
  reason: 'empty' | 'unsupported-scheme' | 'malformed'
): string {
  switch (reason) {
    case 'empty':
      return '주소를 붙여넣어 주세요.'
    case 'unsupported-scheme':
      return 'http 또는 https로 시작하는 주소만 넣을 수 있어요.'
    case 'malformed':
      return '주소 형태가 아니에요. 브라우저 주소창을 통째로 복사해 붙여넣어 보세요.'
  }
}
