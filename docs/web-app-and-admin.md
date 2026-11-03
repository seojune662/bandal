# 웹 반달(bandal.io/app)과 운영 대시보드(bandal.io/admin)

2026-11-03 첫 구현. 웹 앱은 1단계(보기 전용)이고, 대시보드는 Supabase에 이미 있는 데이터만 집계한다.

## 웹 반달 — `web-app/`

데스크톱 렌더러(AppShell, Dockview, PDF.js, Milkdown)를 그대로 쓴다. `web-demo/`와 같은 방식으로 `src/renderer/src/lib/ipc.ts`의 어댑터만 바꾼다.

- **데이터**: 사용자의 Google Drive 동기화 루트를 브라우저가 직접 읽는다. 우리 서버에는 아무것도 올리지 않는다(동기화 스펙의 원칙).
  - 파싱과 머지는 데스크톱의 `src/main/features/sync/format.ts`와 `merge.ts`를 그대로 쓴다.
  - `node:crypto`와 `node:zlib`은 `web-app/shims/`로 바꾼다. 비동기로 미리 계산해 두고 동기 호출에는 그 결과를 돌려준다.
  - `web-app/workspace.test.ts`가 적합성 예제 19개 전부를 이 경로로 돌린다. PDF와 asset의 해시는 데스크톱 `pull.ts`처럼 열 때 검사한다.
- **iCloud**: 브라우저에서 읽을 수 없다. Drive로 동기화하는 사용자만 쓸 수 있다.
- **보기 전용(1단계)**
  - Drive에는 아무것도 쓰지 않는다.
  - `<html data-read-only="true">`를 켜면(`src/renderer/src/lib/readOnlyWorkspace.ts`) 노트가 편집 불가로 열리고 저장하지 않는다.
  - 그 밖의 쓰기 채널은 "보기 전용" 안내를 띄운다.
  - 예외는 렌더러가 화면에 맞추려고 고치는 값이다. 글상자 높이와 이미지 비율이 그렇다. 이 값은 메모리에서만 받는다.
  - 쓰기를 열려면 브라우저가 스펙의 기기 하나로 참여해야 한다(device_id, seq, clock, 쓰기 순서). 다음 단계에서 다룬다.
- **동기화에 없는 것**: 보드, 과제, 달력, 페이지 링크, 채팅, 설정은 동기화 형식에 없다. 웹에서는 빈 상태로 보인다. 레이아웃, PDF 위치, 설정은 이 브라우저의 localStorage에만 둔다.
- **로그인**
  - "Web application" 종류의 OAuth 클라이언트로 token 흐름을 쓴다. 클라이언트는 데스크톱 클라이언트와 같은 Cloud 프로젝트에 있어야 한다. 그래야 `drive.file`로 반달 폴더가 보인다(스펙 v2.6 실측).
  - 토큰은 그 탭의 sessionStorage에만 둔다. localStorage에는 이메일만 `login_hint`로 남긴다. 그래서 다음 방문 때 조용히 로그인되고 바로 내 화면이 열린다.
  - 로그아웃은 토큰을 지우기만 하고 revoke하지 않는다(스펙의 연결 해제 규칙).
- **파일 전달**: `web-app/public/media-sw.js` 서비스 워커가 `/app/media/...` 요청을 받는다. 페이지가 Drive에서 받은 바이트를 메모리에서 넘겨준다. Cache Storage나 디스크에는 남기지 않는다.

### 배포에 필요한 설정

1. Google Cloud(데스크톱 클라이언트와 같은 프로젝트)에서 "웹 애플리케이션" OAuth 클라이언트를 만든다.
   - 승인된 JavaScript 원본: `https://bandal.io`
   - 승인된 리디렉션 URI: `https://bandal.io/app/`
   - 동의 화면에 `drive.file` 범위가 있어야 한다.
2. 그 클라이언트 ID로 빌드한다.
   - 실행: `VITE_GOOGLE_WEB_CLIENT_ID=<id> pnpm sync:app` (bandal-web에서)
   - 결과물은 `public/app/`이다. 이 디렉터리를 커밋한다.
   - 클라이언트 ID 없이 빌드하면 로그인 대신 "준비 중" 카드가 나온다.

## 운영 대시보드 — `supabase/functions/admin`, `supabase/migrations/20261103000000_admin_dashboard.sql`

- **승인된 관리자**: `admin_operators` 테이블의 행이다. API로는 쓸 수 없다. SQL(서비스 롤)로만 추가하고 지운다.
- **권한 확인**
  - Edge Function이 `auth.getUser`로 세션을 확인하고 `bandal_admin_is_operator`를 묻는다.
  - SQL 함수 `bandal_admin_overview`도 같은 확인을 다시 한다.
  - 함수 실행 권한은 service_role에만 있다. anon과 authenticated는 테이블도 함수도 쓸 수 없다.
- **감사 기록**: 성공한 조회마다 `admin_audit`에 남긴다. 남기지 못하면 데이터를 돌려주지 않는다.
- **집계 범위**: 개수와 합계만 낸다. 예외는 최근 피드백 본문 10개(280자까지)다. 이메일, 사용자 id, 결제 키는 나가지 않는다. 날짜는 한국 시간 기준이다.
- **검증**
  - `tests/backend/admin/service.test.ts`
  - bandal-web의 `tests/admin.spec.ts`(Chrome, WebKit)
  - SQL은 필요한 테이블만 흉내 낸 PGlite(Postgres 17 WASM)에서 23개 검사를 통과했다. 실제 Supabase DB에서는 아직 실행하지 않았다.

### 배포 순서

```sh
supabase db push                       # 마이그레이션
supabase functions deploy admin
```

Supabase Auth의 Redirect URLs에 `https://bandal.io/admin/`을 더한다. 등록하지 않은 주소는 Site URL로 조용히 돌아간다.

관리자 승인:

```sql
insert into public.admin_operators (user_id, note)
select id, '운영' from auth.users where email = '<관리자 이메일>';
```

로컬 미리보기(`http://127.0.0.1:4321/admin/`)에서 쓰려면 함수 secret `ADMIN_EXTRA_ORIGINS=http://127.0.0.1:4321`을 둔다.
