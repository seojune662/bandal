# Paddle 구독 결제: Sandbox와 Live

반달 자체 PC·iPad 동기화 이용권이다. 월 4,900원·연 49,000원(VAT 포함), 계정당 5 GiB를 제공한다. Live와 Sandbox는 별도 진입점·상품·키·웹훅 비밀·계정/결제 원장을 사용한다. 기존 Toss `/checkout`과 `study_market_*`는 별개다. Sandbox 구매는 실제 동기화 권한을 주지 않는다.

## Live 구성

- 웹: `https://bandal.io/billing`
- API: `https://ukacrkcwiqafwpppshxb.supabase.co/functions/v1/paddle-billing-live`
- 웹훅: `https://ukacrkcwiqafwpppshxb.supabase.co/functions/v1/paddle-webhook-live`
- 상품: `pro_01m4zcnhpwxmem4p8fq6z6kcw7`
- 월간: `pri_01m4zcnj1x9cjr5wabtxsfr85z`, KRW 4,900
- 연간: `pri_01m4zcnjb4v9n8zea01hmk2x8j`, KRW 49,000
- 공개 클라이언트 토큰 리소스: `ctkn_01m4zcrd4rqfwq84vcknp1qpvq`
- 웹훅 목적지: `ntfset_01m4zcrder06gcwkkgsysqvxpa`, `traffic_source=platform`

두 가격은 세금 포함(`internal`), 수량 1, 체험 기간 없음이다. 2026-10-15에 Live 심사 완료·`bandal.io` 승인과 저장된 기본 결제 링크를 확인했다. 국내 카드·네이버페이·카카오페이를 켰다. 결제 수단 노출은 구매자의 국가·통화와 Paddle 조건에 따른다. 사용자가 모든 고객에게 공개를 선택했으며, iPad 앱이 개발 배포 단계라는 사실을 가격·구독 화면에 고지한다. 공개 App Store 배포나 실제 두 기기 동시 편집 검증이 완료됐다는 의미는 아니다.

### Live 배포 설정

`supabase/paddle-billing.env.example`의 Live 설정을 사용한다. 실제 키와 서명 비밀은 저장소·로그·채팅에 남기지 않는다. 서버 키에는 Transactions/Subscriptions/Customer portal sessions Write와 Adjustments Read가 필요하다. 상품·가격·토큰·목적지 생성용 권한은 운영 서버 키와 분리한다.

- `PADDLE_LIVE_BILLING_ENABLED`: 새 결제 시작 허용. 꺼져도 기존 고객의 상태 조회·포털·해지·웹훅은 유지한다.
- `PADDLE_LIVE_CHECKOUT_PUBLIC_ENABLED`: 모든 로그인 계정에 결제 허용. false면 `PADDLE_LIVE_CHECKOUT_ALLOWED_USER_IDS`에 명시된 계정만 허용한다.
- `PADDLE_LIVE_MONTHLY_PRICE_ID`, `PADDLE_LIVE_ANNUAL_PRICE_ID`: 위 검증된 Live 가격. DB 카탈로그와 동일해야 한다.
- `PADDLE_LIVE_API_KEY`, `PADDLE_LIVE_CLIENT_TOKEN`, `PADDLE_LIVE_WEBHOOK_SECRET`: Live 전용 값.

진입점에서 환경을 고정하므로 공용 `PADDLE_ENVIRONMENT` 변경으로 Sandbox를 Live로 전환할 수 없다. Live는 Simulator의 `ntfsimevt_` 이벤트를 거부한다. 기존 Sandbox 목적지는 유지하며 Live 목적지는 구독 이벤트 8개·`transaction.completed`·`adjustment.created`·`adjustment.updated` 총 11개만 받는다.

웹훅은 매 요청 원문 HMAC을 검증한다. 신뢰할 수 있는 발신 IP를 보증하는 게이트웨이 규약은 확인되지 않았으므로 임의 `X-Forwarded-For` 값을 보안 경계로 사용하지 않는다. 추가 IP 제한을 도입하려면 [Paddle의 현재 Live IP 목록](https://developer.paddle.com/api-reference/ip-addresses/)과 신뢰할 수 있는 앞단을 함께 구성해야 한다. 현재 IP 허용 목록이 적용됐다고 가정하지 않는다.

### 구독·환불·복구

고객 포털은 인증된 계정에 저장된 Paddle customer ID로만 짧게 유효한 URL을 발급한다. 공개 config에는 customer ID가 없고, 인증된 상태 응답의 ID만 Paddle Retain `pwCustomer.id`에 사용한다. 로그인/로그아웃 시 계정 상태를 분리한다.

미완료 결제는 Paddle에서 취소됐다는 응답을 확인한 뒤에만 다른 요금제로 시작할 수 있다. `refresh`는 이미 저장한 거래/구독 소유권을 사용해 현재 상태·최근 완료 거래 두 건·해당 adjustments를 복구한다. 과거 전체 원장 backfill 작업은 아니다. 복구 결제와 환불은 한 SQL 트랜잭션으로 반영한다.

승인된 전액 환불·누적 전액 환불 또는 chargeback/warning은 해당 결제 기간을 권한 계산에서 제외한다. 부분 환불은 남은 기간을 유지한다. 원래 adjustment가 `reversed`로 확정되면 반영하며, 오래된 이벤트가 최신 상태를 되돌리지 못한다. **환불은 자동갱신 해지와 별개**다. 운영자가 전액 환불 후 갱신도 중단하려는 경우 구독 해지를 별도로 확인한다. 기존 구독이 존재하면 무료 중복 구독을 새로 만들지 않는다.

Live 상태 응답의 `sync`는 로그인 계정의 사용량·권한만 반환한다. 5 GiB 용량과 만료 후 다운로드 정책, 개발용 만료 예외는 [동기화 접근·용량 운영 안내](sync-paid-access.md)를 따른다.

### 정산 및 실제 결제 검증

Live 심사 승인과 정산 수단 등록은 별개다. 2026-10-15 확인 당시 Payout Settings의 Account Type은 미선택이었다. 대표자·계좌 등 정산 정보는 운영자가 직접 입력한다. 실결제 테스트는 운영자가 정상 계정으로 결제하고 결과를 확인해야 하며, 서버·Sandbox 자동 검사만으로 Live 청구 성공을 주장하지 않는다.


## 2026-10-15 Live 배포 확인

- 서버·데스크톱 커밋 `f9d7902626af7a8595e6ba0370894cd073273977`, 앱 버전 `0.84.6`. [동일 커밋 CI](https://github.com/seojune662/bandal/actions/runs/38712030783)와 [릴리스 작업](https://github.com/seojune662/bandal/actions/runs/38712047053)이 성공했고, [v0.84.6](https://github.com/seojune662/bandal/releases/tag/v0.84.6)이 정식 공개됐다. macOS arm64·x64의 Developer ID 서명·공증과 양쪽 플랫폼의 영향 기능 패키지 검사를 통과했다. Windows 설치 파일은 기존 배포 설정대로 미서명이며 서명 완료로 간주하지 않는다.
- 공개 산출물 12개(총 953,452,538 bytes)를 인증 없이 다운로드해 크기와 GitHub SHA-256이 모두 일치함을 확인했다. `latest-mac.yml`·`latest.yml`은 `0.84.6`이며 설치 파일 5개의 SHA-512·크기가 실제 파일과 일치했다. `/releases/latest/download`의 두 피드도 공개된 이번 릴리스와 일치한다.
- 웹 구현 커밋 `e81076f345b2cd7c559014c8f76fe5684fd6d7b9`, 기존 공개 버전 동기화를 합친 Production 커밋 `da9063df192f7947e3d67b0c3d57daa309348133`. Vercel 배포 `7088674634` 성공. 릴리스 공개 뒤 다운로드 버전을 `0.84.6`으로 동기화한 커밋 `86531c62431b3d2cd603533afb4527b370b4b2af`와 Production 배포 `7089013143`도 성공했다. 실제 홈페이지의 `0.84.6` 표시와 결제·가격 페이지 HTTP 200을 확인했다.
- Live 원장·동기화 권한·안전한 Storage 오류 전달의 새 마이그레이션 3개만 적용했다. 과거 개인 동기화 스키마와 이력은 재적용·변경하지 않았다. Sandbox와 Live 함수 4개를 배포했다.
- 실제 HTTPS config에서 `environment=live`, `enabled=true`, `accessMode=public`을 확인했고, Sandbox는 `environment=sandbox`, 기존 tester 조건을 유지한다.
- `bandal_sync_configuration.enforce_paid_access=true`를 적용했다. 적용 전 서버 자료·자산·크기 미확인 사용량은 모두 0건이었다. 별도 무료 사용자나 가짜 Live 결제 권한은 만들지 않았다.
- 실제 `bandal.io/billing`에서 정상 Google 로그인 후 구독 없음·0 MiB 보관 상태를 확인했다. 약관 동의나 실결제는 대신 실행하지 않았다. 공개 가격·Sync·약관·개인정보·환불 페이지 HTTP 200과 CSP를 확인했다.
- 한국 주소·KRW 조건의 Paddle Live 가격 미리보기에서 월간 4,455+VAT445=4,900원, 연간 44,545+VAT4,455=49,000원을 확인했다. 카드·국내 카드·네이버페이·카카오페이·Apple Pay가 가능 수단으로 반환됐다. 이 계산 검증은 실제 청구나 각 수단의 결제 성공 검증이 아니다.
- 허용하지 않은 origin은 403, 서명 없는 Live 웹훅은 401로 거부했다. 계정·결제 원장에 테스트용 사용자/이벤트를 주입하지 않았다.
- 로컬 검증: 결제 정책·서비스 61개, 실제 Auth/Postgres 16개, Storage HTTP·동시 용량 10개, PC 연결 Python 10개, Electron 메뉴 1개, 영향 선택기 53개 통과. Deno 4개 진입점·메인 타입·앱 빌드 통과. 웹 Live 36개·기존 Sandbox 24개·Toss 10개와 관련 사이트/모바일 회귀를 통과했다.
- 실카드 Live 청구·환불·포털의 실제 고객 세션, 정산 수단 등록 완료와 두 기기 실제 동시 편집은 자동 검사 결과와 구분한다. API 키·서명 비밀의 임시 파일은 서버 등록 후 제거했다.

## Sandbox 구성과 계정 연결

- 웹: `https://bandal.io/billing/sandbox` — 검색 제외, 공개 가격 페이지에서 연결하지 않음.
- API: `https://ukacrkcwiqafwpppshxb.supabase.co/functions/v1/paddle-billing`
- 알림: `https://ukacrkcwiqafwpppshxb.supabase.co/functions/v1/paddle-webhook`
- 상품: `pro_01m4tkddadhjv80nygr42ytf6q`
- 월간 가격: `pri_01m4tkfz9fnqcsq4ah67e092j8`
- 연간 가격: `pri_01m4tkhwzp9bhpq2yt03em2c7g`

웹은 반달과 같은 Supabase의 Google/Kakao 로그인(PKCE)을 사용한다. 인증 코드는 교환 전 주소창에서 제거하고, 세션·PKCE 검증자는 해당 탭의 sessionStorage에만 둔다. JWT를 URL에 전달하지 않는다. Supabase Auth의 Site URL 또는 Redirect URLs가 정확한 `https://bandal.io/billing/sandbox` 복귀를 허용해야 한다. 원격 설정 전체를 덮어쓰는 `supabase config push`로 수정하지 않는다.

서버는 Auth `getUser`와 테스트 사용자 UUID 허용 목록을 모두 확인한다. 사용자 이메일이나 Paddle `custom_data`로 계정을 연결하지 않는다. 서버가 가격을 선택하고 생성한 거래 ID를 로그인 계정에 저장한 뒤 결제창에 전달한다. 동일 계정의 미결제 거래는 한 개만 허용하고 같은 요금제의 재시도는 이를 재사용한다. 진행 중인 거래가 있으면 다른 요금제로 바꾸지 못한다.

웹의 `checkout.completed`는 상태 새로고침만 시작한다. 서버는 원문 본문 HMAC과 5초 시각 허용 범위, 금액·통화·가격·수량·청구기간·실제 captured 결제를 확인한다. 이벤트 영수증과 권한 원장은 한 DB 트랜잭션에서 처리한다. 중복 이벤트는 무시하고, 같은 이벤트 ID에 다른 본문이 오면 거부한다. 오래된 구독 상태는 최신 상태를 덮어쓸 수 없다. 유효 결제와 활성 구독을 모두 확인해야 Sandbox 권한이 생긴다. 취소 예약은 결제 기간까지 유지하고, 실제 canceled/paused는 권한을 중단한다.

모든 `paddle_billing_*` 테이블과 RPC는 service_role 전용이다. 공개 config 응답은 공개 Supabase URL·anon 키·Sandbox 클라이언트 토큰만 포함한다. API 키, webhook 서명 비밀, 허용 사용자 목록은 반환하지 않는다.

## 계정 설정과 배포

1. Sandbox API 키에 `Transactions: Write`, `Subscriptions: Write`가 필요하다(Write는 Read 포함). 초기 설정 자동화에는 `Client-side tokens: Write`, `Notification settings: Write`, `Notification simulations: Write`, `Notifications: Read`가 추가로 필요하다. 실제 운영 런타임 키는 준비용 권한과 분리한다.
2. Sandbox 클라이언트 토큰과 위 webhook URL의 알림 목적지를 준비한다. 기존 항목을 먼저 조회하고 재사용한다. 서명 비밀은 생성 응답에서 안전하게 저장하며 채팅·로그·저장소에 출력하지 않는다.
3. 구독 이벤트 `created`, `activated`, `updated`, `canceled`, `paused`, `resumed`, `past_due`, `trialing`과 `transaction.completed`를 구독한다. 웹훅은 공개 HTTPS이며 Supabase gateway JWT 대신 Paddle 서명을 직접 검증한다.
4. `supabase/paddle-billing.env.example`을 저장소 밖 권한 600 파일로 복사해 실제 값을 채운다. 로그인한 테스트 사용자가 페이지에서 자신의 UUID를 확인한 뒤 허용 목록에 등록한다. 비어 있으면 모든 결제 요청을 거부한다.
5. 다음 명령의 dry-run에서 이 마이그레이션만 나오는지 확인한 뒤 적용한다. 연결 프로젝트는 `ukacrkcwiqafwpppshxb`다.

```sh
supabase db push --linked --dry-run
supabase db push --linked
supabase secrets set --project-ref ukacrkcwiqafwpppshxb --env-file /protected/path/paddle.env
supabase functions deploy paddle-billing --project-ref ukacrkcwiqafwpppshxb --use-api --import-map supabase/functions/deno.json
supabase functions deploy paddle-webhook --project-ref ukacrkcwiqafwpppshxb --use-api --import-map supabase/functions/deno.json
```

비밀 등록 후 임시 환경 파일을 제거한다. 준비가 끝났을 때만 `PADDLE_BILLING_ENABLED=true`를 설정한다. 꺼져 있거나 비밀이 불완전하면 config는 `enabled:false`이며 결제를 시작하지 않는다. 공개 가격 페이지는 출시 전 상태를 유지한다.

Sandbox의 Checkout → Checkout configuration → Default payment link는 운영자가 `https://bandal.io/billing/sandbox`로 설정한다. 이 페이지는 계정에 저장된 거래만 직접 여는 전용 테스트 페이지이며, 외부 `_ptxn` URL 값을 자동 결제에 사용하지 않는다. Paddle 대시보드에서 임의로 만든 거래의 payment link를 지원한다고 가정하지 않는다.

## 검증

```sh
node node_modules/vitest/vitest.mjs run tests/backend/paddleBilling/policy.test.ts tests/backend/paddleBilling/service.test.ts
node tests/backend/paddleBilling/run-local.mjs
deno check --frozen --config supabase/functions/deno.json supabase/functions/paddle-billing/index.ts supabase/functions/paddle-webhook/index.ts
node scripts/test-affected-checks.mjs
# bandal-web 저장소에서
pnpm exec playwright test tests/paddle-sandbox.spec.ts tests/checkout.spec.ts
```

통합 검사는 임시 Docker Supabase(56720–56722)의 실제 Auth/Postgres/RLS를 사용한다. 결제 공급자 응답은 fixture이므로 이 검사만으로 실제 Paddle 결제 성공을 주장하지 않는다. 운영 DB에 가짜 사용자나 서명 이벤트를 주입하지 않는다.

실제 Sandbox 검증은 허용된 사용자의 정상 로그인 → 월간/연간 결제창 가격 확인 → 테스트 카드 결제 → Paddle 알림 delivered 확인 → 서버의 Sandbox 활성 권한 확인 → 갱신 해지 예약 확인 순서다. 실패 카드에서는 권한이 생기지 않아야 한다. 알림 재전송에서는 중복 원장이 생기지 않아야 한다. 테스트 카드·3DS·갱신 시뮬레이션은 [Paddle Sandbox 문서](https://developer.paddle.com/sdks/sandbox/)의 현재 값을 사용한다. 사용자의 실제 카드로 결제하지 않는다.

## 2026-10-14 배포 확인

- 서버 구현 커밋 `9bc498458f369458fcbb26b36a79859d721945d1`, [CI 통과](https://github.com/seojune662/bandal/actions/runs/38419282056).
- 웹 구현 커밋 `992087f8a8cb3d93fbd5685ce9f85ea59f1f83fb`, Vercel Production 배포 `7042190081` 성공, `https://bandal.io/billing/sandbox` HTTP 200 및 전용 CSP 확인.
- `20261013010000_paddle_billing_sandbox.sql`과 `paddle-billing`·`paddle-webhook`을 연결 프로젝트에 배포했다. 다른 마이그레이션은 적용하지 않았다.
- 서버 정책·서비스 43개, 실제 SQL/Auth 9개, 검사 선택 스크립트 50개, 웹 Paddle 24개·기존 Toss 10개 검사를 통과했다. Astro·Deno 검사와 정적 빌드도 통과했다.
- 초기 배포에서 실제 HTTPS config의 `environment:sandbox`, `enabled:false`, 빈 클라이언트 토큰과 미설정 요청의 503, 허용하지 않은 origin의 403을 확인했다. 아래 계정 연결을 마친 뒤 Sandbox 기능 설정을 활성화했다.
- Supabase 대시보드의 Site URL은 `https://bandal.io`, 기존 추가 복귀 주소는 `bandal://auth/callback`이었다. URL 설정을 변경하지 않고 실제 Google 로그인과 테스트 페이지 복귀를 확인했다.
- 사용자가 Sandbox 키의 추가 권한을 승인했고, 클라이언트 토큰과 알림 목적지를 생성해 Supabase에 Sandbox 설정을 등록했다. 클라이언트 토큰의 리소스 ID는 `ctkn_01m4tyhwpff72csyb1ccy1fsft`, 알림 목적지 ID는 `ntfset_01m4tyhx0gnm3f7yztga78wpw3`다. 토큰 값과 API 키·웹훅 서명 비밀은 이 문서에 기록하지 않는다.
- 실제 Paddle 서명 비밀의 base64 형식을 허용하도록 수정한 커밋 `137045923465ddab38d8bd2019ec93b1213f2dc5`를 배포했고, [CI가 통과했다](https://github.com/seojune662/bandal/actions/runs/38424052219). 수정 후 서버 정책·서비스 45개와 Deno 진입점 검사를 통과했다.
- `PADDLE_BILLING_ENABLED=true`, `PADDLE_ENVIRONMENT=sandbox`로 설정했다. 정상 로그인한 사용자의 페이지에 표시된 계정 ID를 확인해 테스터 한 명을 허용 목록에 등록했다. 사용자 UUID는 저장소에 기록하지 않는다. 등록 전에는 인증된 사용자도 `sandbox_tester_required`로 차단되는 것을 확인했다.
- 사용자가 Sandbox Default payment link를 `https://bandal.io/billing/sandbox`로 저장했고, 대시보드를 새로 불러온 뒤 해당 값과 Approved 표시를 확인했다.
- 공식 Simulator는 일반 이벤트의 `evt_` 대신 `ntfsimevt_` ID를 보낸다. 웹훅 이벤트에만 두 형식을 허용한 커밋 `be7a31865128b093e05b3f95f20b6eddc440135b`를 두 함수에 배포했고, 서버 정책·서비스 47개와 Deno 진입점 검사 및 [CI](https://github.com/seojune662/bandal/actions/runs/38426447778)를 통과했다. 실제 Simulator 실행 `ntfsimrun_01m4tzmm1az025gpb50mwshta4`는 서명 검증을 거쳐 외부 예제 가격을 `409 price_mismatch`로 거부했다. 이 거부 검증은 아래 실제 테스트 카드 결제 검증과 별개다.

## 실제 Sandbox 결제 결과

2026-10-14 한국 시간에 실제 배포 페이지, 사용자 본인의 정상 로그인, Paddle 공식 테스트 카드로 확인했다. 실제 카드와 실제 청구는 사용하지 않았다.

| 검증 | 결과 |
| --- | --- |
| 월간 실패 카드 | `declined`, 결제 원장 0건, 구독 권한 비활성·용량 0 |
| 월간 성공 재시도 | 같은 거래에서 KRW 4,900 captured, 결제 원장 1건, 월간 권한·5 GiB 활성 |
| 월간 갱신 해지 예약 | 2026-11-14 01:03:04까지 권한 유지, `cancelAtPeriodEnd=true` |
| 완료 알림 재전송 | 새 알림 ID·같은 이벤트 ID로 HTTP 200, 결제·이벤트 영수증 각각 1건 유지 |
| 월간 즉시 종료 | 연간 시험을 위해 Sandbox 구독만 즉시 종료, `canceled`·권한 비활성·용량 0, 결제 기록 보존 |
| 연간 성공 결제 | KRW 49,000 captured, 연간 권한·5 GiB 활성, 2027-10-14 01:11:02까지 |
| 연간 갱신 해지 예약 | 결제 기간·권한 유지, `cancelAtPeriodEnd=true`, 해지 예약 알림 HTTP 200 |

월간 거래는 `txn_01m4tzx7rtpgrne2hzdb8vzkfd`, 구독은 `sub_01m4v01k9s7w29efmwv9qnaaf8`다. 연간 거래는 `txn_01m4v0e4fqpfhvqnc9xtv48dhs`, 구독은 `sub_01m4v0g6mjh3e7gtvdd7xbyj79`다. 두 거래 모두 실제 완료 응답의 `billing_period`·`subscription_id`와 captured 금액을 확인했다.

월간의 completed·created·activated 알림은 첫 시도 HTTP 200이었다. 연간 activated 알림 `ntf_01m4v0g8g9f8ca7hb9nax1tnf7`은 created보다 먼저 처리되어 `checkout_binding_pending` 503을 반환한 뒤, 약 21초 후 Paddle 자동 재시도로 HTTP 200·delivered가 됐다. 이 과정에서 권한을 미리 부여하거나 결제 기록을 중복 생성하지 않았다.

재전송한 월간 완료 이벤트는 `evt_01m4v01mm6w7yd8gg662fvydwb`다. 원본 알림 `ntf_01m4v01n3p4tcjegwxqa0kvrp3`와 재전송 알림 `ntf_01m4v08ewwewj8gw589gwsaeej`가 모두 HTTP 200으로 처리됐고, 원장과 결제 기간은 그대로 유지됐다.

최종 상태는 월간 테스트 구독 종료, 연간 테스트 구독 활성·다음 갱신 해지 예약이다. 카카오 로그인, 3DS, 실제 날짜 경과에 따른 갱신·결제 실패·기간 만료, 환불은 이번 실제 결제 검증에 포함하지 않았다. 공개 판매와 기존 동기화 권한은 활성화하지 않았다.

Paddle 재전송은 같은 이벤트에 새 `notification_id`를 발급할 수 있다. HMAC은 원문으로 검증하고, 이벤트 중복 해시는 `event_id`, `event_type`, `occurred_at`, `data`만 키 순서를 정렬해 계산한다. 초기 완료 거래의 `billing_period` 또는 `subscription_id`가 없는 공급자 응답은 권한을 부여하지 않는다. 실제 Sandbox에서 이런 응답이 나오면 검증된 후속 이벤트/공급자 조회를 통한 복구를 구현해야 한다.

참조: [웹훅 서명](https://developer.paddle.com/webhooks/signature-verification/), [완료 거래](https://developer.paddle.com/webhooks/transactions/transaction-completed/), [API 권한](https://developer.paddle.com/api-reference/about/permissions/), [알림 재전송](https://developer.paddle.com/api-reference/notifications/replay-notification/).
