# Apple 구독과 계정 삭제 운영 계약

2026-10-17 구현·백엔드/웹 운영 배포 확인. 실제 Apple 상품 심사, 운영 키 등록, 기기 결제는 아직 진행하지 않았다.

## 공통 구독

`bandal_subscription_status()`는 로그인 사용자의 Paddle Live와 Apple Production 원장으로 `{active,sources,validUntil,duplicateSubscription,storageLimitBytes}`를 반환한다. source는 `{provider,environment,active,plan,status,validUntil,cancelAtPeriodEnd,canManage}`다. 어느 결제수단으로 구독해도 같은 Supabase 계정의 동기화 쓰기를 허용한다. 용량은 월 4,900원/연 49,000원 모두 5 GiB이며 중복 결제로 합산하지 않는다. `bandal_sync_status()`의 기존 필드는 유지된다. 만료 후 다운로드 정책도 유지된다.

Apple의 active 상태는 미취소 구매 소유권 + 유효한 만료일, 또는 서버가 확인한 grace period로만 인정한다. 자동갱신 해지는 만료일까지 접근을 유지한다. billing retry/만료/전액 취소는 유효한 grace period가 없으면 허용하지 않는다. 부분 환불의 revocation 정보도 원장에 남긴다. 과거 signedDate의 응답은 새 상태를 되돌리지 않는다.

`apple-billing`은 Production, `apple-billing-sandbox`는 Sandbox로 고정되어 요청 본문으로 환경을 바꿀 수 없다. Sandbox 권한은 Production 공통 구독과 무관하다. Sandbox 호출은 `APPLE_SANDBOX_ALLOWED_USER_IDS`로 한 번 더 제한한다.

- `POST {action:'prepare'}`: 신규 구매 직전 예약. 서버가 안정적인 `appAccountToken`, `productIds`, `subscription`, `sync` 반환. 이미 구독 중이거나 다른 결제가 진행 중이면 409. Apple 구매 의도는 15분 동안 Paddle 신규 결제를 차단한다.
- `POST {action:'verify',signedTransaction:JWS}`: StoreKit 검증 JWS를 공식 Apple 서버 라이브러리로 다시 검증한 후 Get All Subscription Statuses로 현재 상태를 확인하고 저장한다. 복원/업데이트에도 이 경로를 직접 사용한다. `prepare`가 복원에 필요하지 않다.
- `POST {action:'refresh'}`: 해당 계정에 이미 연결된 구매만 재조회한다.
- `apple-notifications`와 `apple-notifications-sandbox`: Notifications V2 `signedPayload` 검증, 내부 transaction/renewal JWS 검증, 현재 서버 상태 조회, notificationUUID+원문 해시 멱등 적용. 클라이언트나 webhook payload의 이메일/금액/임의 사용자 ID로 권한을 부여하지 않는다.

기존 계정에 연결된 originalTransactionId/appAccountToken은 다른 계정으로 이전되지 않는다. 계정 삭제 뒤 token과 결제 식별자는 계속 예약된다. TEST 알림은 권한을 만들지 않는다. Apple의 online certificate revocation check를 켠 공식 `@apple/app-store-server-library@3.1.0`과 Apple PKI 공개 root 인증서를 사용한다.

## 설정과 활성화

기본값은 신규 Apple 구매 비활성이다. App Store Connect 계정 생성·계약 동의·가격/상품 생성·심사 제출은 자동 수행하지 않았다.

| 설정 | 의미 |
| --- | --- |
| `APPLE_BILLING_ENABLED` | 신규 Production 구매 허용. 키 설정 후 실제 검증을 통과하기 전에는 false |
| `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | App Store Server API용 In-App Purchase 키. private key는 실제 줄바꿈이 포함된 PKCS8 PEM |
| `APPLE_APP_ID` | App Store Connect의 숫자 Apple app ID |
| `APPLE_SUBSCRIPTION_GROUP_ID` | 두 상품이 속한 숫자 subscription group ID |
| `APPLE_MONTHLY_PRODUCT_ID` | 기본 `app.bandal.ipad.sync.monthly` |
| `APPLE_ANNUAL_PRODUCT_ID` | 기본 `app.bandal.ipad.sync.yearly` |
| `APPLE_SANDBOX_BILLING_ENABLED`, `APPLE_SANDBOX_ISSUER_ID`, `APPLE_SANDBOX_KEY_ID`, `APPLE_SANDBOX_PRIVATE_KEY` | Sandbox endpoint의 별도 설정 |
| `APPLE_SANDBOX_ALLOWED_USER_IDS` | Sandbox 테스트 Supabase UUID 목록, 쉼표 구분 |

번들 ID는 `app.bandal.ipad`로 고정한다. 키가 없으면 503 `apple_billing_unavailable`로 실패한다. 유효한 키가 있는 상태에서 enabled만 false로 변경하면 기존 구매 검증/복원/환불 알림은 계속 작동한다. Production과 Sandbox 알림 URL을 App Store Connect에서 각각 지정해야 한다. 실제 App Store/TestFlight의 Sandbox 구매는 Production 구독 권한으로 바뀌지 않으므로 테스트 계정의 동기화 검증에는 한시적인 베타 권한을 따로 사용한다.

## 탈퇴

`POST account-delete {confirm:true}`. Supabase `getUser`와 서명을 검증한 `getClaims`의 AMR timestamp를 함께 검사한다. 10분 이내의 oauth/password/OTP/TOTP/SAML/magiclink 인증만 허용한다. access-token `iat`나 token_refresh는 재인증 근거가 아니다. 401 `reauthentication_required`이면 다시 로그인한 뒤 확인해야 한다.

DB의 삭제 작업을 만든 뒤 새 사용자 쓰기와 개인 파일 업로드를 차단한다. DB의 Storage object metadata에서 소유 객체, 개인 UUID 경로의 고아 파일, 해당 사용자의 화이트보드 asset 참조를 찾아 **Storage API**로 삭제한다. 실패/배치 초과 시 계정은 남고 삭제 작업은 재시도할 수 있다. 파일이 남은 상태에서 성공을 반환하지 않는다. 공유 그룹은 남은 멤버에게 이전하거나 비어 있으면 해산하고, 개인 메시지/프로필/친구 관계/피드백/작성한 도형 등은 정리한다. 공유 보드는 다른 멤버의 자료를 유지하며 작성자 연결만 제거한다. 마지막으로 Auth 사용자 삭제를 호출한다.

진행 중 주문(pending/refund_pending/refund_due/review), 정산(reserved/requested/review), 열린 환불/회수 케이스(refund/receivable), 아직 정산되지 않은 순잔액은 변경 전에 409 `account_deletion_pending_transactions`와 역할별 상태/건수/잔액을 반환한다. 완료된 과거 거래만으로 탈퇴를 막지 않는다. 결제 원장/공개 배포 패키지/다른 사람이 구매한 자료의 필요한 참조는 보존하고 이름·로그인 연결·자유형 감사 사유를 제거한다. 보존 기간에 대한 법적 판단이나 자동 삭제 기간은 이 코드에서 확정하지 않는다. 삭제는 구독 자동해지를 의미하지 않으므로 확인 화면에서 Apple/Paddle 관리 경로를 안내해야 한다.

### Apple 로그인 연결 해제

Native Apple 로그인 후 Supabase 세션으로 `POST account-delete {action:'registerAppleAuthorization',authorizationCode}`를 호출한다. 서버가 Apple token endpoint에서 코드를 교환하고 서명/issuer/audience를 검증한 Apple ID token의 sub를 인증된 Supabase Apple identity의 sub와 대조한다. refresh token은 AES-256-GCM으로 암호화하며 사용자 UUID를 AAD로 묶고 service-only 테이블에만 저장한다.

| 설정 | 의미 |
| --- | --- |
| `APPLE_AUTH_TEAM_ID`, `APPLE_AUTH_KEY_ID`, `APPLE_AUTH_PRIVATE_KEY` | Sign in with Apple용 팀/키/PKCS8 PEM. IAP 키와 구분 |
| `APPLE_AUTH_TOKEN_ENCRYPTION_KEY` | 32바이트 무작위 키의 base64. 브라우저/앱/로그에 넣지 않는다 |

탈퇴 시 저장된 refresh token을 Apple `/auth/revoke`로 해제한 뒤 삭제한다. 해제 실패는 계정을 남겨 재시도한다. 암호화 키 변경/유실 시 기존 값을 복호화할 수 없으므로 백업과 별도 회전 절차가 필요하다. 기존 tokenless Apple 계정은 [Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)에 따라 계정을 삭제하고 `appleRevocation:'manual_required'`를 반환한다. 앱은 Apple 계정의 Sign in with Apple 연결을 직접 해제하는 안내를 표시한다. 정상 자동 해제는 `revoked`, Apple 연결 없음은 `not_applicable`다.

## 마이그레이션과 검증

`20261013005000_personal_sync.sql`이 개인 동기화의 기본 스키마를 버전 관리한다. 기존 DB에 원래 개인 스키마가 온전히 있으면 이를 재작성하지 않고 통과한다. 부분 설치는 중단한다. 기존 Production의 직접 적용 기록은 먼저 `migration list`와 실제 schema diff를 확인하고, 검토 없이 `--include-all`로 재적용하지 않는다. 아래 운영 검증 기록은 이번 세 마이그레이션 배포 결과다. 이미 적용한 SQL을 수정해 재적용하지 않고 후속 변경은 새 마이그레이션으로 추가한다.

검증 명령:

```sh
node node_modules/vitest/vitest.mjs run tests/backend/appleBilling/service.test.ts tests/backend/appleBilling/deletion.test.ts tests/backend/paddleBilling/service.test.ts
deno check --config supabase/functions/deno.json supabase/functions/apple-billing/index.ts supabase/functions/apple-notifications/index.ts supabase/functions/account-delete/index.ts
deno test --config supabase/functions/deno.json tests/backend/appleBilling/provider.deno.ts
BANDAL_ACCOUNT_DELETE_FULL_SCHEMA=1 node tests/backend/syncAccess/run-local.mjs
```

로컬 runner는 고정 loopback 포트의 별도 일회용 Supabase 프로젝트만 사용하고 종료 시 삭제한다. 새 계정/고아 파일/권한 격리/결제 원장/전체 기존 마이그레이션의 탈퇴 FK를 검사한다. 실제 Apple 결제, Apple 계정 설정, provider code 교환/해제는 공급자 설정과 기기에서 별도 확인해야 한다.

## 2026-10-17 운영 검증 기록

프로젝트 `ukacrkcwiqafwpppshxb`에서 배포 전 migration history와 현재 함수/테이블/권한을 읽기 전용으로 대조했다. 직접 적용됐던 개인 동기화의 원본 push/pull 본문이 로컬 원본과 바이트 단위로 일치하고 기존 RLS·유료 게이트가 유지됨을 확인한 뒤 dry-run 결과가 아래 세 파일만 포함하는 것을 검토했다. history repair 없이 `db push --linked --include-all`로 세 파일만 적용했다.

- `20261013005000_personal_sync.sql`: 기존 개인 스키마를 감지해 재작성하지 않고 버전 기록 추가.
- `20261017000000_apple_billing.sql`: 공통 구독·Apple 결제 원장·소유권/중복 구매 게이트.
- `20261017010000_account_deletion.sql`: 삭제 작업·쓰기 중지·완료 거래 익명화·Apple 로그인 토큰 보관.

배포 후 세 migration 기록, 기존 유료 동기화 강제, private 파일 버킷 설정, 인증 사용자의 공통 상태 RPC 접근, service-only 내부 RPC와 신규 6개 테이블 RLS를 다시 확인했다. 개인 동기화 원본 함수 SHA-256은 배포 전후 동일했다.

| 원본 함수 | SHA-256 |
| --- | --- |
| `bandal_push_unmetered` | `ffa0d21746877f7c985717f7b5a0575acaa911937e4ae1a2a240dba66827dfb4` |
| `bandal_pull` | `d2e19a3ef0d96908672452f0824e73f309d0172ea19e13ad232c77d311744bf6` |

`apple-billing`, `apple-billing-sandbox`, `apple-notifications`, `apple-notifications-sandbox`, `account-delete`, `paddle-billing-live`를 배포했다. Apple 이름의 설정 키가 아직 없으며 Apple 4개 endpoint가 HTTP 503 `apple_billing_unavailable`을 반환해 미설정 구매를 차단한다. `account-delete`는 비인증 요청을 HTTP 401 `sign_in_required`로 거절하고, 기존 Paddle Live config는 HTTP 200/live/enabled를 유지한다. 운영 사용자 로그인·파일 삭제·구매·계정 삭제 요청을 실행하지 않았다.

웹은 [a88e715688346349e3de4faf4cbba40f1f63d709](https://github.com/seojune662/bandal_web/commit/a88e715688346349e3de4faf4cbba40f1f63d709)에서 공통 구독 표시·Apple 관리 경로·중복 구매 차단을 배포했다. [Vercel 배포](https://vercel.com/krunchmallow/bandal-web/Epii1vJRshhtKizZumpS2GWqbbdb) 성공 후 [운영 결제 페이지](https://bandal.io/billing)의 HTTP 200 및 새 공통 상태 UI를 확인했다. 실제 계정 정보나 로그는 이 문서에 저장하지 않는다.

검증 결과: Apple/삭제/Paddle 서비스 단위 51개, 공식 Apple JWS 거절 검사 1개, 격리 Supabase 동기화·Apple 통합 17개와 전체 기존 스키마를 사용한 삭제 통합 5개, 변경 검사 선택 56개 통과. 웹 Chromium/WebKit 38개와 Astro 진단 75개 파일(오류·경고 없음)을 확인했다. 실제 Apple 상품·알림 설정·Sandbox 기기 결제·Apple 코드 교환/해제는 설정 완료 후 별도 검증이 필요하다.

### 데스크톱 삭제·백업 접근 보강

데스크톱은 삭제 요청 전에 로컬 접근 기록을 원자적으로 잠근다. 서버가 명확히 거절한 401 재인증/409 진행 거래 응답만 이전 접근 상태로 되돌리고, 응답이 불명확하거나 서버 삭제가 시작된 오류는 세션을 비우고 잠금을 유지한다. 재시작이나 자동 token refresh로 이 잠금을 풀 수 없으며 새 로그인 검증이 필요하다. 세션 파일뿐 아니라 메모리 캐시도 비우고, 다른 계정의 SDK 세션이 남아 있어도 원래 로컬 프로필 계정과 일치하는 인증 클라이언트만 외부 기능에 전달한다.

백업은 목적지 선택부터 중복 작업을 차단하고 심볼릭 링크를 거친 원본 내부 경로도 거절한다. 동기화 중단은 Python만 강제 종료하지 않고 취소 marker를 전달해 진행 중인 Node 변환기의 파일·DB 작업이 끝난 뒤 종료하게 한다. PDF 사전 준비와 하위 프로세스 종료를 모두 기다리고 시간 초과 시 백업 성공을 반환하지 않는다. 이로써 Windows에서도 변환기가 남아 있는 동안 백업을 완료한 것으로 처리하지 않는다.
