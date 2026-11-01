# Bandal Sync 종료 — D0 진행표

- **D0**: 2026-11-10(화). PR #2(로그인 선택화, 계정 동기화 숨김)를 릴리스하는 날이다.
- **D0+30**: 2026-12-10(목). 반달 서버에 남은 동기화 사본을 지우는 날이다.
- **Paddle 구독자**: 0명(2026-10-30 확인). 환불 절차가 없으므로 공지에도 환불 문장을 넣지 않는다.
- 근거: `docs/sync-desktop-phase2-design-2026-10-30.md` 8.4–8.6

## D0 당일 순서

| # | 할 일 | 누가 | 준비물 |
|---|---|---|---|
| 1 | Paddle 대시보드에서 Bandal Sync 판매를 중지한다 | 사람 | — |
| 2 | 앱을 릴리스한다(태그 → `release.yml`). 설치 파일과 업데이트 피드가 올라왔는지 확인한다 | 개발 | `docs/release.md` |
| 3 | 사전 확인 쿼리를 실행하고 결과를 이 문서 끝에 적는다 | 사람 | 아래 "사전 확인" |
| 4 | SQL Editor에서 `supabase/operations/sync-write-block.sql` 파일 전체를 실행한다. 오류 없이 끝나면 차단이 확인된 것이다 | 사람 | SQL 파일 |
| 5 | bandal_web PR을 머지하고 Vercel 배포를 확인한다. `/sync`, `/pricing`, `/billing`을 열어 본다 | 사람 | seojune662/bandal_web#3(날짜 반영됨). main에 머지하면 곧바로 Vercel 프로덕션 배포가 된다 |
| 6 | 공지를 올린다(웹사이트, 커뮤니티). 3단계에서 사본 보유자가 있었다면 그들에게 메일을 보낸다 | 사람 | 아래 "공지 문안" |

- 2와 4는 같은 날 한다. 새 버전은 서버에 올리지 않으므로 둘의 순서는 상관없다.
- 4를 실행하면 업데이트하지 않은 옛 데스크톱 앱은 동기화 오류를 표시한다. 공지에 업데이트 안내가 들어 있다.
- iPad 배포판은 서버에 올린 적이 없다(iPad 2단계 설계안 7.2). 차단해도 영향은 개발·TestFlight 빌드뿐이다.

## 사전 확인 (읽기 전용)

서버 사본이 있는 사용자 수와 메일 대상을 확인한다.

```sql
select
  (select count(distinct user_id) from public.bandal_records) as users_with_records,
  (select count(distinct split_part(name, '/', 1)) from storage.objects where bucket_id = 'bandal-assets') as users_with_assets,
  (select count(*) from storage.objects where bucket_id = 'bandal-assets') as asset_files,
  (select count(*) from public.bandal_sync_beta_access) as beta_grants,
  (select count(*) from public.apple_billing_subscriptions
    where environment = 'production' and revoked_at is null
      and ((status = 1 and expires_at > now()) or (status = 4 and grace_expires_at > now()))) as app_store_active;
```

`app_store_active`는 App Store 구독으로 Sync 이용권을 받은 사용자 수다(`20261017000000_apple_billing.sql`). 0이 아니면 공지와 환불 안내를 다시 정한다. App Store 환불은 Apple이 처리하고, iPad의 Bandal Pro 구독과도 관계가 있으므로 iPad 팀과 함께 정한다.

```sql
-- 메일 대상. 위 결과가 모두 0이면 실행하지 않아도 된다.
select u.email
from auth.users u
where exists (select 1 from public.bandal_records r where r.user_id = u.id)
   or exists (select 1 from storage.objects o
              where o.bucket_id = 'bandal-assets' and split_part(o.name, '/', 1) = u.id::text);
```

## 쓰기 차단

- 파일: `supabase/operations/sync-write-block.sql`
- 닫는 것: `bandal_push(jsonb)` 실행 권한, `bandal-assets` 업로드 정책
- 남기는 것: `bandal_pull`, 자산 읽기. D0+30까지 사본을 돌려줄 수 있게 한다.
- 파일 끝의 검사가 실패하면 오류를 내고 변경 전체가 취소된다. 여러 번 실행해도 결과가 같다.
- 되돌리기: `supabase/operations/sync-write-block-rollback.sql`
- 로컬 검증: 빈 PostgreSQL 14에서 `psql -X -v ON_ERROR_STOP=1 -d <빈 DB> -f supabase/tests/sync_write_block.sql`. 실제 마이그레이션을 적용한 뒤 차단 전 쓰기 가능, 차단 후 쓰기 불가와 읽기 가능, 되돌리기, 재실행을 확인한다.

## 공지 문안

### 전체 (웹사이트, 커뮤니티, 메일)

> **Bandal Sync 종료 안내**
>
> 반달 서버를 거쳐 기기 사이에 자료를 동기화하던 Bandal Sync를 2026년 11월 10일에 종료합니다.
>
> - 자료는 각 기기에 그대로 있습니다. 앱을 업데이트해도 과목, PDF, 필기, 노트는 지워지지 않습니다.
> - 반달 서버에 올라간 동기화 사본은 2026년 12월 10일에 삭제합니다. 그전에 사본이 필요하면 hi@bandal.io로 알려 주세요.
> - 최신 버전에서는 동기화 메뉴가 사라집니다. 이전 버전에서는 동기화 오류가 보일 수 있으니 업데이트해 주세요.
> - iPad로 자료를 옮기려면 [iPad] 메뉴의 "iPad로 자료 내보내기"와 "iPad 자료 가져오기"를 써 주세요.
> - 여러분이 고른 iCloud나 Google Drive로 동기화하는 기능을 준비하고 있습니다. 무료이고, 반달 서버에 자료를 올리지 않으며, 로그인하지 않아도 됩니다.
>
> **함께 바뀌는 점**
>
> - 로그인은 선택입니다. 로그인하지 않아도 자료와 필기 기능을 모두 쓸 수 있습니다. 커뮤니티처럼 계정이 필요한 기능에서만 로그인을 요청합니다.
> - 카카오 로그인은 더 이상 제공하지 않습니다. Apple 또는 Google로 로그인해 주세요. 카카오로 쓰던 계정이 필요하면 hi@bandal.io로 알려 주세요.
> - 메일 위젯의 Gmail 받은편지함은 학교 메일이나 Gmail을 새 탭에서 여는 웹메일 버튼으로 바뀝니다.
>
> 궁금한 점은 hi@bandal.io로 보내 주세요.

### 짧은 판 (배너, SNS)

> Bandal Sync가 2026년 11월 10일에 종료됩니다. 자료는 각 기기에 그대로 있고, 반달 서버에 남은 동기화 사본은 2026년 12월 10일에 삭제합니다. 자세히 보기: bandal.io/sync

### English

> **Bandal Sync has ended**
>
> Bandal Sync, which synced your materials between devices through Bandal's server, ends on November 10, 2026.
>
> - Your materials stay on each device. Updating the app does not delete any courses, PDFs, ink, or notes.
> - Sync copies stored on Bandal's server will be deleted on December 10, 2026. If you need your copy before then, email hi@bandal.io.
> - The latest version removes the sync menu. Older versions may show sync errors, so please update.
> - To move materials to your iPad, use "iPad로 자료 내보내기" and "iPad 자료 가져오기" in the iPad menu.
> - We are preparing free sync through your own iCloud or Google Drive. Nothing goes to Bandal's server, and no sign-in is needed.
>
> **Also changing**
>
> - Signing in is optional. Every materials and ink feature works without an account. Only features that need one, such as the community, ask you to sign in.
> - Kakao sign-in is no longer available. Please sign in with Apple or Google. If you need the account you used with Kakao, email hi@bandal.io.
> - The Gmail inbox in the mail widget becomes a webmail button that opens your school mail or Gmail in a new tab.
>
> Questions? Email hi@bandal.io.

## D0+30

설계안 8.5의 4–6단계를 따른다. 그 무렵 삭제 SQL을 따로 준비한다.

- Storage `bandal-assets`는 Storage API나 대시보드의 "Empty bucket"으로 비운다. SQL로 `storage.objects` 행만 지우면 파일이 남는다.
- 테이블 `bandal_records`, `bandal_changes`, `bandal_operations`, `bandal_sync_usage`, `bandal_sync_beta_access`를 비운다.
- 행 수 0, 버킷 객체 수 0을 확인하고 결과를 이 문서에 적는다.

## 기록

| 날짜 | 항목 | 결과 |
|---|---|---|
| | 사전 확인 | |
| | 쓰기 차단 | |
| | D0+30 삭제 | |
