# Paddle Sandbox 구독 결제

반달 자체 PC·iPad 동기화 이용권의 **Sandbox 결제 검증 단계**다. 월 4,900원·연 49,000원(VAT 포함), 계정당 5 GiB를 시험한다. 실제 금액 청구나 기존 동기화 권한 변경은 없다. 기존 Toss `/checkout`과 `study_market_*`는 별개다. 환경 변수만 Live로 바꿔 운영할 수 없도록 서버·DB 모두 Sandbox만 허용한다.

## 구성과 계정 연결

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

Sandbox의 Checkout → Checkout configuration → Default payment link가 필요하면 운영자가 `https://bandal.io/billing/sandbox`로 설정한다. 이 페이지는 계정에 저장된 거래만 직접 여는 전용 테스트 페이지이며, 외부 `_ptxn` URL 값을 자동 결제에 사용하지 않는다. Paddle 대시보드에서 임의로 만든 거래의 payment link를 지원한다고 가정하지 않는다.

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

실제 Sandbox 검증은 허용된 사용자의 정상 로그인 → 월간/연간 결제창 가격 확인 → 테스트 카드 결제 → Paddle 알림 delivered 확인 → 서버의 Sandbox 활성 권한 확인 → 갱신 해지 예약 확인 순서다. 실패 카드에서는 권한이 생기지 않아야 한다. 알림 재전송에서는 중복 원장이 생기지 않아야 한다. 테스트 카드·3DS·갱신 시뮬레이션은 [Paddle Sandbox 문서](https://developer.paddle.com/concepts/sell/sandbox/)의 현재 값을 사용한다. 사용자의 실제 카드로 결제하지 않는다.

## Live 이전 전 남은 범위

환불·adjustment에 따른 권한 처리, 고객 포털, 누락 이벤트 재처리·상태 복구, 미완료 결제 만료·요금제 전환, 실제 동기화 권한/용량 연결은 후속 단계다. 현재 소스는 이 기능들의 완료나 정식 출시를 의미하지 않는다. Live 전환 시 별도 상품·키·서명 비밀·원장 분리, 사업자 검증·결제 수단·정산 정보 확인과 실제 운영 보안 검토가 필요하다. 웹훅 IP 제한은 신뢰할 수 있는 게이트웨이의 발신 IP와 Paddle 공식 IP 목록을 사용해야 하며, 클라이언트가 임의로 보낸 forwarded 헤더로 판정하면 안 된다.

참조: [웹훅 서명](https://developer.paddle.com/webhooks/signature-verification/), [완료 거래](https://developer.paddle.com/webhooks/transactions/transaction-completed/), [API 권한](https://developer.paddle.com/api-reference/about/permissions/).
