# 대학교 자료 마켓플레이스 운영

기존 도구 마켓플레이스와 분리된 `study_market_*` 스키마다. 앱은 `study-market` Edge Function에 `POST {action,input}`을 보낸다. 데이터베이스와 Storage는 익명·로그인 사용자에게 직접 열리지 않는다. API는 JWT를 Auth 서버로 검증하고 선택한 학교, 판매자, 구매자, 운영자 권한을 각각 확인한다. 학교 선택은 재학 인증이 아니다.

## 배포와 기본 상태

적용 대상은 `supabase/migrations/20261013000000_study_market.sql` 하나다. 기존 연결 프로젝트가 의도한 프로젝트인지 먼저 확인하고 다음 순서로 배포한다.

```sh
supabase db push --dry-run
supabase db push
supabase functions deploy study-market
supabase functions deploy study-market-webhook
supabase functions deploy study-market-cron
```

세 함수의 `verify_jwt=false`와 공통 import map 경로는 `supabase/config.toml`에 명시되어 있다. 원격 번들러는 상위 `deno.json`을 자동 탐색하지 않으므로 이 경로를 유지한다. API는 JWT 또는 결제 전용 토큰을 직접 검증하고, webhook은 PG 조회/서명을 검증하며, cron은 별도 비밀을 검증한다. 서비스 역할 키를 앱·웹에 넣지 않는다. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge 런타임 제공 값이다.

안전한 환경 파일을 Supabase secrets로 등록한다(`supabase secrets set --env-file <보호된-파일>`). 파일은 저장소 밖에 두고 권한 600, 로그 출력 금지, 등록 뒤 안전하게 제거한다. 공개 앱·웹 빌드에는 Supabase URL과 공개 anon 키만 들어간다.

| 비밀 이름 | 배포 기본/의미 |
|---|---|
| `STUDY_MARKET_ENV` | `live` 또는 별도 시험 프로젝트의 `test` |
| `STUDY_MARKET_ENABLED` | **`false` 유지**. `true`와 키 준비가 모두 필요 |
| `STUDY_MARKET_WEB_ORIGIN` | `https://bandal.io` |
| `STUDY_MARKET_CRON_SECRET` | 독립된 암호학적 난수 32자 이상 |
| `TOSS_LIVE_CLIENT_KEY` | 동일 라이브 상점의 `live_ck_…` |
| `TOSS_LIVE_SECRET_KEY` | 결제 조회·승인·취소 `live_sk_…` |
| `TOSS_LIVE_PAYOUT_SECRET_KEY` | 지급대행 계약의 `live_sk_…` |
| `TOSS_LIVE_SECURITY_KEY` | 지급대행 보안 키, 64자 hex |

시험 프로젝트는 네 Toss 키의 접두사를 `TOSS_TEST_`로 바꾸고 실제 `test_` 키를 사용한다. 시험 환경도 가짜 결제 성공을 생성하지 않으며 실제 Toss 테스트 API의 응답을 검증한다. 운영 프로젝트에서 시험 거래를 시작하지 않는다. CORS는 설정한 웹 origin만 허용한다. 로컬 Supabase의 시험 모드에 한해 HTTP localhost/127.0.0.1 개발 origin을 추가 허용한다.

라이브는 환경 변수 외에도 `study_market_readiness` 단일 행의 `live_enabled`, `contracts_verified`, `policies_verified`, `webhook_verified`, `payout_verified`가 모두 참이어야 한다. 마이그레이션은 전부 거짓으로 만든다. 배포만으로 이 값을 올리지 않는다. 미준비 상태에서는 둘러보기와 판매 초안 준비만 가능하다.

## 라이브 활성화 근거

- Toss 결제·플랫폼 지급대행 계약, 개인 셀러 지원/본인 확인/KYC 절차, 상점 및 지급대행 키 연결을 실제 계정에서 확인한다.
- 판매 권리 확인, 환불·공급 시작 동의, 수수료 10%의 원 단위 내림, 개인정보 처리/계좌정보 위탁, 신고·운영 대응 정책을 공개하고 검토한다. 법률 판단을 코드 통과로 대신하지 않는다.
- 결제 승인, 승인 응답 유실 후 조회, 중복 webhook, 전액 취소, 지급 요청 응답 유실/동일 키 재시도, 지급 실패/완료를 Toss 샌드박스에서 확인한다.
- 실제 Toss `seller.changed`, `payout.changed`의 **원문 본문·전송 시각·서명 fixture**로 HMAC을 확인한다. 공식 문서는 HMAC 키의 UTF-8/hex 디코딩 예제를 명확히 제공하지 않는다. 현재 구현은 보안 키 문자열의 UTF-8 바이트를 사용한다. JWE는 명시된 대로 hex를 32바이트로 디코딩한다. 자체 생성 서명 테스트만으로 `webhook_verified`를 올리지 않는다.
- 실환경 최대 50MiB 파일의 최종 복사·다운로드·SHA-256 검증이 Edge CPU/메모리 제한 안에 드는지 확인한다. 정적 형식 검사와 OOXML 위험 항목 거부는 백신 검사가 아니다. 문서 무해화를 제공한다고 표시하지 않는다.
- 아래 은행 영업일 달력과 cron을 설정하고 실제 운영자 계정의 조회·환불·보류·감사 로그 동작을 확인한다.

운영자는 관리자가 검증된 Auth UUID만 `study_market_operators(user_id)`에 삽입해 지정한다. 앱에서 자신의 운영자 권한을 만들 수 없다. 보고 처리와 환불은 별개의 조치이며 모든 운영 조치에 사유를 남긴다. 부분 취소와 이미 정산 배정된 거래의 외부 환불은 판매자를 보류하고 미수금 검토 건을 남긴다. 운영자가 환불 검토를 반려하면 사유와 함께 구매 권한이 복구된다.

## 파일과 초안

100개 원본 및 최대 3개 PNG 미리보기, 파일당 50MiB, 미리보기당 4MiB, 총합 200MiB. PDF/MD/TXT/PNG/JPEG/WEBP/DOCX/PPTX/XLSX만 허용한다. 0바이트 UTF-8 텍스트는 허용한다. 경로는 휴대 가능한 상대 경로이며 정규화 중복·부모/자식 충돌·Windows 예약 이름을 거부한다.

클라이언트는 서명된 staging 경로에만 업로드한다. TUS는 `x-signature`와 공개 API 키를 보내며 **`/storage/v1/upload/resumable/sign`** 경로를 사용한다. 일반 `/upload/resumable`은 사용자 RLS 경로라 서명 grant만으로 허용되지 않는다([Supabase 공식 signed Uppy 예제](https://github.com/supabase/supabase/blob/master/examples/storage/resumable-upload-signed-uppy/index.html)). 서버는 별도 final 버킷으로 복사한 **최종 바이트**의 크기·SHA-256·형식과 미리보기 차원을 검증한다. 최종 버킷에는 사용자 쓰기 정책이 없다. 서명된 이전 staging 토큰은 final에 권한이 없다. 확정된 파일 manifest는 DB 트리거도 변경/추가/삭제를 거부한다. 새 파일 수정은 새 version을 만들고 기존 구매는 구버전을 유지한다. 같은 manifest의 초안 재저장과 이미 검증된 업로드 재시도는 멱등적이다. 게시 중단한 최신 버전은 판매자 권한 재검증 후 재게시한다. 게시 학교는 변경할 수 없다.

계정당 새 version 15회/시간, 미완성 version 30개, 미완성 총량 1GiB를 DB 잠금 아래 검사한다. 일반 API는 300회/분, 결제 토큰 API는 60회/분 제한한다. 구매 다운로드 URL은 300초이며 미리보기는 구매 파일에서 제외된다. 모든 URL 발급에 성공한 뒤 잠금 RPC가 구매/차단 상태를 최종 확인하고 공급 시작을 기록한다. 다운로드 완료/실패 보고는 감사 사건이며 실패가 자동으로 공급 시작을 지우지 않는다.

## 결제와 정산

웹 결제는 `/checkout#token=<opaque-token>`을 받는다. 토큰은 30분, DB에는 SHA-256만 저장한다. 사용자 JWT를 URL에 넣지 않는다. `checkoutSession`과 `confirmPayment`는 동일 `{action,input}` API를 사용한다. 주문 금액·학교·판매자·version은 서버가 고정하며 승인된 PG 원장을 다시 확인한다. `orderStatus({orderId,refreshCheckout:true})`만 결제 토큰을 회전시킨다. 단순 폴링은 회전하지 않는다.

미공급·결제 7일 이내 환불은 동일 환불 키로 전액 취소한다. 공급 후/7일 경과는 잠금 아래 검토 상태로 전환해 다운로드·정산을 보류한다. 만료 주문에 늦은 결제가 도착하면 `refund_due`에 증빙을 저장하고 재조정 cron이 취소한다. 대체 주문의 유일성에 충돌하지 않는다. 취소 확인 없이 환불 완료로 기록하지 않는다.

정산은 결제 후 **7일 초과** 잔액만 사용한다. 금요일 12시 KST부터 15시 직전까지, 금요일이 은행 휴일이면 첫 확인된 영업일의 같은 시간에 실행한다. 후보 ledger ID와 금액은 한 스냅샷으로 확정하고 동일 ID만 배정한다. 환불·정산은 판매자 잠금을 공유한다. 신고/차단/검토 거래는 새 배정 및 발송 직전 재검사에서 제외한다. 건당 10억원 미만으로 묶으며 미수금은 먼저 차감하고 남은 양수 매출은 다음 회차로 남긴다.

예약 이후 잔액 부족/네트워크 모호성은 예약을 보존한다. 다음 지급 회차에 **원래 UUID/idempotency key**로 재시도하고 14일을 넘긴 미확정 건은 검토 보류한다(동일 키의 Toss 유효 기간 15일보다 짧게 제한). 검증된 지급 실패만 ledger 배정을 해제한다. 완결 상태를 뒤늦은 webhook이 되돌릴 수 없다. 셀러 `PARTIALLY_APPROVED`의 주간 한도는 PG의 실제 승인 결과에 따르며 실패/보류를 운영자가 확인한다.

## 달력과 cron 프로비저닝

`study_market_calendar_years(year,source,verified_at)`에 검토 완료한 연도를 등록하고, `study_market_business_days(date,is_business_day,source,verified_at)`에는 그 연도의 **모든 날짜**를 채운다. 주말/공휴일/임시공휴일/연말 은행 휴무를 승인된 은행 영업일 출처로 검토한다. 날짜 또는 연도 인증이 없으면 지급하지 않는다. 연도 경계에는 양쪽 연도 데이터가 필요하다. 변경된 임시공휴일은 배치 전에 갱신한다. 저장소에 추정 휴일 seed는 없다. 시험 fixture를 운영에 복사하지 않는다.

Supabase Vault에 `study_market_cron_url`과 Edge와 같은 `study_market_cron_secret`을 등록한 뒤 `supabase/operations/study-market-cron.sql`을 적용한다. 이 SQL은 값이 없으면 중단하며 5분 주기의 이름 있는 job을 만든다. 운영 URL은 배포한 프로젝트의 `/functions/v1/study-market-cron`이다. cron 비밀은 공개 anon 키/서비스 역할 키와 분리한다.

각 tick은 다음을 수행한다: 7일 지난 미구매 미완성 스냅샷 최대 20개 삭제, 게시 스냅샷의 3시간 지난 staging 정리, 2일 지난 요청 제한 기록 정리, 최종 조회 시각이 가장 오래된 pending/paid/refund/review 주문 30개 재조회, 미확정 지급 30개 재조회. 정리는 Storage API를 사용하며 완료 표식으로 다음 대상을 진행한다. 지급 시간에는 판매자 100명을 영속 cursor로 순회한다. 거래를 비활성화해도 정리와 기존 결제 재조정은 수행한다.

`cron.job_run_details`, `net._http_response` HTTP 상태, Edge 오류, 열린 환불/신고/정산/미수금 건, 오래된 pending/refund_due/reserved, 공급 실패를 운영 모니터링에 포함한다. HTTP 요청 발송 성공만으로 금융 작업 성공을 보고하지 않는다. Toss webhook 대상은 `/functions/v1/study-market-webhook`이며 `PAYMENT_STATUS_CHANGED`, `seller.changed`, `payout.changed`를 등록한다.

## 재현 가능한 검증

```sh
node node_modules/vitest/vitest.mjs run tests/backend/studyMarket/policy.test.ts
node tests/backend/studyMarket/run-local.mjs
deno check --frozen --config supabase/functions/deno.json supabase/functions/study-market/index.ts supabase/functions/study-market-cron/index.ts supabase/functions/study-market-webhook/index.ts
```

통합 검사는 Docker와 Supabase CLI를 사용해 고유 임시 프로젝트의 실제 Auth/Postgres/private Storage를 포트 56620–56622에 띄우고 종료 시 삭제한다. 기존 프로젝트나 운영 DB를 사용하지 않는다. PG HTTP만 테스트 fixture이며 실결제·실지급 검증을 주장하지 않는다. 실제 앱 main client의 signed TUS POST/PATCH/HEAD, 6MiB 저장 후 응답 유실 및 새 호출 재개, 최종 SHA-256, Auth/RLS, private bucket, 변조/중복 승인, 불변 버전, 초안 재개, 게시 중단/재게시, 늦은 결제, 동시 환불·다운로드·정산, 할당 원장 합계 및 업로드 quota를 확인한다.

참조: [Toss 지급대행](https://docs.tosspayments.com/guides/v2/payouts), [API 상세](https://docs.tosspayments.com/reference/additional), [웹훅 검증](https://docs.tosspayments.com/reference/using-api/webhook-events), [공식 LLM API 참조](https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference).

## 2026-10-13 배포 확인

운영 프로젝트에 마이그레이션과 API·webhook·cron 세 함수를 배포했다. 18개 학교와 익명 목록 조회, 로그인 없는 구매 내역 거부(401), 준비 전 결제 거부(503), 외부 origin 거부(403), 위조 webhook 거부(401)를 실제 HTTPS 응답으로 확인했다. 독립 cron 비밀과 Vault 참조를 연결했으며 인증한 유지 작업은 지급 비활성 상태로 정상 종료했다. 직접 클라이언트 접근이 가능한 마켓 테이블은 0개다. Toss 키와 은행 영업일·운영 승인 증빙은 등록하지 않았고 실거래는 열지 않았다.
