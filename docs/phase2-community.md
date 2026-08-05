# Bandal Phase 2 — 커뮤니티 / 조별과제 설계

> ⚠️ **정정 필수 — 이 문서보다 `supabase/README.md` §8이 우선한다.**
> P2-B에서 실제 Postgres로 스키마를 검증하는 과정에서 아래 설계 오류가 드러났고 SQL은 정정된 형태로 구현됐다.
> 구현자는 반드시 `supabase/README.md` §8을 먼저 읽을 것.
> - **§6.1 레이트리밋이 원안대로는 동작하지 않는다.** `check_rate()`가 `rate_events`에 기록한 뒤 RPC가 `raise`하면 트랜잭션 롤백으로 **시도 기록이 함께 사라진다** → "5회 시도 후 잠금"이 영원히 누적되지 않고 §2.4의 "12년" 안전 계산이 무효가 된다. `join_group_with_code()`는 예외를 던지지 않고 `{ok:false, error, retryAfter}`를 **반환**한다. **P2-C 주의: `groups:joinWithCode`는 예외가 아니라 반환값의 `ok`를 검사해야 한다.**
> - **§2.7의 "UPDATE는 RLS로 author 한정 + 관리자 삭제는 트리거"는 성립 불가.** RLS가 먼저 0행으로 끝내 트리거에 도달하지 못한다 → 관리자 삭제는 `delete_message()` RPC로 분리.
> - **§2.9 `rate_events`는 3컬럼으로 "그룹당" 한도를 표현할 수 없다** → `scope` 컬럼 추가.
> - **§2.4 base32 축약 방식 미정** → 바이트 6개에 `& 31` 마스크(나머지 연산 없음). 2000개 표본 상대편차 0.12로 확인.
> - `invite_codes`는 SELECT 정책을 **하나도 만들지 않는다**(`currentCode`도 RPC 경유) — 게이트 ② 증명이 단순해진다.
> - 검증이 잡은 실제 취약점 2건: ① Supabase의 `alter default privileges`가 새 함수 EXECUTE를 `authenticated`에게 **직접** 부여해 `is_blocked_either_way()`가 클라이언트에 노출됐다(§6.4 "차단 사실 비노출" 위반) → 내부 함수는 `authenticated`까지 회수 + 허용목록 전수 검사. ② 가드 트리거의 GUC 플래그를 `authenticated`가 `set_config()`로 위조해 역할 승격이 가능했다 → `current_user = 테이블 소유자` 판별로 교체.
> - 문서에 없던 결정: 오너 탈퇴 시 승계 규칙, `mark_read` 상한, system 메시지는 이벤트 코드만 저장(문구는 렌더러), 잠금 순서 규약.

> 범위: Supabase Auth + Postgres(RLS) + Realtime으로 **과목 단위 공유 스페이스**와 **그룹 채팅**을 붙인다.
> 비범위: 자료/PDF/주석/노트/AI 대화 동기화 (§3.4에서 이유 명시).
> **철칙: 로그아웃·오프라인 상태에서 Phase 1 기능은 100% 그대로 동작한다.** 이 문서의 어떤 결정도 이 철칙을 이긴다.

---

## 0. 결정 요약

| # | 항목 | 결정 | 근거 |
|---|---|---|---|
| 1 | 인증 플로우 | **시스템 브라우저 OAuth(PKCE) + `bandal://` 딥링크** | 임베디드 OAuth는 Google이 차단(`disallowed_useragent`), 매직링크는 무료 SMTP가 시간당 2~3통 |
| 2 | 세션 저장 | **Electron `safeStorage`** + `userData/auth/session.enc` (0600, 원자적 쓰기) | keytar는 아카이브된 네이티브 모듈 — better-sqlite3 리빌드 고통을 또 사지 않는다 |
| 3 | Supabase 클라이언트 소유 | **메인 프로세스 단독** | 리프레시 토큰이 `<webview>`가 사는 렌더러에 절대 들어가지 않는다 |
| 4 | 초대 코드 | **6자 Crockford Base32** (32^6 ≈ 1.07e9) | 숫자 6자리는 활성코드 1만 개일 때 추측 성공률 1% — 즉시 뚫린다 (§2.4) |
| 5 | 실시간 전송 | **Broadcast from Database** (`realtime.send()` 트리거) + private channel | `postgres_changes`는 클라이언트×변경 건마다 RLS 재평가 → 무료 티어에서 먼저 죽는다 |
| 6 | 타이핑 인디케이터 | **P2에서 안 만든다** | 실시간 메시지 볼륨 ~10배. 2M/월 쿼터를 기능값 0에 태울 수 없다 |
| 7 | 프레즌스 | **만든다** (채널 Presence, DB 쓰기 0) | 체감 가치 대비 비용 0 |
| 8 | 과목↔그룹 결합 | **로컬 매핑 테이블** `course_group_links` | 1:N(전체방+우리조) + `courses`를 순수 로컬로 남겨 오프라인 보장이 구조로 성립 |
| 9 | 공유 태스크 보드 | **P2에서 구현 안 함** (스키마만 스케치) | sort_order 동시 편집 충돌은 별도 난제. 예산은 채팅이 가져간다 |
| 10 | 아바타 | **이미지 업로드 없음** — 색 + 이모지 | Storage 1GB를 아바타로 태울 수 없다 |
| 11 | 차단 | **P2에 넣는다** (1테이블 + 필터) | 채팅 제품에 차단이 없는 건 무책임 |
| 12 | 신고 | 테이블 + 컨텍스트 메뉴만. 트리아지는 대시보드 수동 | 모더레이션 큐 UI는 P3 |

---

## 1. 인증 (Auth)

### 1.1 플로우: 시스템 브라우저 + PKCE + 커스텀 스킴 딥링크

| 후보 | 판정 | 이유 |
|---|---|---|
| 매직링크(이메일) | ❌ | Supabase 내장 SMTP는 **시간당 2~3통** 하드 리밋. 강의실에서 20명 동시 가입 시 그냥 안 된다 |
| 임베디드 `BrowserWindow` OAuth | ❌ | Google이 embedded user-agent 거부. 되더라도 로그인 폼을 우리 프로세스에서 렌더하는 건 피싱 내성 0 |
| **시스템 브라우저 + PKCE + 딥링크** | ✅ **채택** | 이미 로그인된 브라우저를 그대로 쓴다 → 클릭 2번. client_secret 불필요, 데스크톱 표준 |

**프로바이더**: 커버리지는 카카오가 압도적(초대코드를 공유할 매체 자체가 카톡)이나 개발자 앱 등록·동의항목·검수가 선행된다. **권장: 구글 먼저 열고 카카오는 P2-E에 추가** — 심사가 마일스톤을 블로킹하지 않게.

**시퀀스**

```
renderer  →  invoke('auth:signIn', { provider })
main      →  supabase.auth.signInWithOAuth({ provider, options: {
                redirectTo: 'bandal://auth/callback', skipBrowserRedirect: true }})
main      →  shell.openExternal(url)               // 시스템 브라우저
OS        →  bandal://auth/callback?code=...
main      →  'open-url'(macOS) / 'second-instance' argv(Win·Linux)
main      →  exchangeCodeForSession(code) → safeStorage 저장 → broadcast('auth:changed')
```

**딥링크 배선 (필수)**

- `app.setAsDefaultProtocolClient('bandal')` — dev에서는 `process.defaultApp ? [path.resolve(process.argv[1])] : []` 인자 필요 (electron-vite dev에서 스킴이 안 잡히는 전형적 함정)
- macOS: `app.on('open-url')` — **`app.whenReady()` 전에 등록**해야 콜드 스타트 URL을 놓치지 않는다
- Windows/Linux: `app.on('second-instance')` — `src/main/index.ts`에 이미 단일 인스턴스 가드가 있으므로 argv 파싱만 얹는다
- `electron-builder.yml` `mac:` 아래 `protocols: [{ name: Bandal, schemes: [bandal] }]`
- 대시보드 **Authentication → URL Configuration → Redirect URLs**에 `bandal://auth/callback` 등록

동일 핸들러가 `bandal://join/ABC123`도 처리한다 (§5.2 재활용).

### 1.2 세션 저장: `safeStorage`

`userData/auth/session.enc` — `safeStorage.encryptString()`, tmp→fsync→rename 원자적 쓰기, `chmod 0600`.

- `isEncryptionAvailable()`가 false면 **리프레시 토큰을 디스크에 쓰지 않는다.** 메모리 전용 → 재시작마다 재로그인. 설정 창에 안내(합니다체). 현재 배포 타깃 macOS arm64에서는 실전 영향 없음
- keytar 기각(아카이브됨 + 네이티브 모듈), 평문 기각(리프레시 토큰은 장기 자격증명)

supabase-js 커스텀 storage 어댑터로 물린다:
```ts
createClient(url, publishableKey, {
  auth: { flowType: 'pkce', detectSessionInUrl: false,
          persistSession: true, autoRefreshToken: true, storage: safeStorageAdapter }
})
```
PKCE code_verifier도 같은 어댑터를 타므로 자동으로 같은 보호를 받는다.

### 1.3 렌더러 ↔ 메인 인증 상태 공유

렌더러는 **토큰을 절대 보지 않는다.** 투영된 상태만 받는다.

```ts
// src/shared/types/auth.ts
export type AuthPhase = 'unconfigured' | 'signed-out' | 'signing-in' | 'signed-in' | 'error'

export interface AuthState {
  phase: AuthPhase
  profile: MyProfile | null          // 토큰·이메일 없음
  online: boolean
  errorCode: 'oauth-cancelled' | 'network' | 'provider' | 'storage' | null
}

export interface MyProfile {
  id: string
  nickname: string | null            // null = 닉네임 미설정
  avatarColor: string
  avatarEmoji: string
}
```

IPC: `auth:getState` + push `auth:changed` — `settings:get`/`settings:changed`와 1:1 동형. 렌더러 `authStore`는 명시적 하이드레이션 + push 무효화(persist 미들웨어 금지). 설정 창도 같은 push를 받는다.

### 1.4 로그아웃/미구성 상태 — 비협상 조건

**하드 룰 (코드 리뷰 게이트로 강제)**

1. **`src/main/features/group/` 밖의 어떤 IPC 핸들러도 Supabase를 호출하지 않는다.** `registerHandlers.ts`의 기존 섹션은 P2에서 **한 줄도 바뀌지 않는다**
2. `GroupService`는 **지연 생성**. 부팅 경로에 네트워크가 끼지 않는다
3. 세션 복원 실패(네트워크·만료·파일 손상)는 전부 비치명적 → `phase='signed-out'`, 앱 정상 부팅
4. 키가 없는 빌드는 `phase='unconfigured'` → 커뮤니티 UI가 **렌더 자체를 안 한다**(비활성화가 아니라 부재)
5. **회귀 게이트**: 기존 E2E 3종을 `BANDAL_SUPABASE_URL=''`에서 그린 유지 + "네트워크 차단 상태 부팅" E2E 신규 1종

| 표면 | 로그아웃 시 |
|---|---|
| 좌측 레일 "함께하기" | "친구들과 같이 하려면 로그인해요" + [로그인] 버튼 1개 |
| 과목 컨텍스트 "그룹 만들기" | 항목은 보이되 로그인 카드로 라우팅 (숨기지 않는다 — 발견성) |
| 저장된 `group-chat` 탭 | 하이드레이션에서 **드롭** (dangling 프루닝 규칙 그대로) |
| `unconfigured` 빌드 | "함께하기" 섹션 자체가 없음 |

---

## 2. 데이터 모델 (Postgres + RLS)

> 규약: `id uuid`, `created_at/updated_at timestamptz`, 소프트 삭제 `deleted_at` — 로컬 `schema.sql`과 동일 규약.

### 2.0 RLS 재귀 함정 — 먼저 읽을 것

`study_groups` 정책이 `group_members`를 참조하고 그 반대도 참조하면 **RLS 무한 재귀**로 모든 쿼리가 죽는다. Supabase에서 가장 흔한 사고다.

```sql
create or replace function public.is_group_member(gid uuid, uid uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.group_members m
                 where m.group_id = gid and m.user_id = uid and m.left_at is null);
$$;
revoke execute on function public.is_group_member(uuid, uuid) from public;
grant  execute on function public.is_group_member(uuid, uuid) to authenticated;
```

`is_group_admin(gid, uid)`도 같은 꼴로. **모든 그룹 스코프 정책은 이 두 함수만 호출한다.**

### 2.1 `profiles`

```sql
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nickname      text not null,
  nickname_key  text generated always as (lower(nickname)) stored,
  avatar_color  text not null default 'moon',
  avatar_emoji  text not null default '🌙',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint nickname_shape check (nickname ~ '^[가-힣a-zA-Z0-9_]{2,16}$')
);
create unique index profiles_nickname_key_uq on public.profiles (nickname_key)
  where deleted_at is null;
```

- **전역 유일 닉네임** (카카오식 `#4821` 디스크리미네이터 없음). "별명으로 친구추가"가 **한 필드 1스텝**으로 끝나야 하기 때문. 대가는 이름 선점이지만 대학생 규모에선 실질 문제가 아니고, 규모가 커지면 P3에서 디스크리미네이터 **추가**는 가능(제거는 불가) — 지금 유일 제약을 거는 게 안전한 방향
- **아바타 이미지 없음.** 색 + 이모지 → Storage 비용 0, 이미지 모더레이션 부담 0
- 프로필 행은 `auth.users` 트리거로 자동 생성, `nickname`은 임시값(`user_<8hex>`) → 렌더러가 "닉네임 정하기" 스텝을 띄운다

| 동작 | 정책 |
|---|---|
| SELECT | `id = auth.uid()` OR `is_friend(...)` OR `shares_group_with(...)` — 디렉토리 스크래핑 차단 |
| 닉네임 검색 | 테이블 SELECT 아님. `find_profile_by_nickname(text)` **SECURITY DEFINER RPC, 완전일치 전용**(prefix/LIKE 금지) + 레이트리밋 |
| UPDATE | `id = auth.uid()`, 컬럼 화이트리스트는 트리거 |
| INSERT / DELETE | 정책 없음 (트리거 생성 / 소프트 삭제) |

### 2.2 `study_groups`

```sql
create table public.study_groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 40),
  color         text not null default 'moon',
  owner_id      uuid not null references public.profiles(id),
  member_count  int  not null default 1,      -- 트리거 유지 (N+1 회피)
  last_msg_seq  bigint not null default 0,    -- §4.3 그룹별 단조 시퀀스
  last_msg_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
```

**`course_id`가 없다는 점이 핵심이다.** 과목은 각자 디스크의 폴더고 경로·과목명은 사적 정보다. 결합은 전적으로 로컬에서 한다(§3).

SELECT `is_group_member(id, auth.uid())` / INSERT는 `create_group()` RPC 전용 / UPDATE `is_group_admin(...)` + 컬럼 화이트리스트 / DELETE 정책 없음.

### 2.3 `group_members` (읽음 상태 포함)

```sql
create table public.group_members (
  group_id      uuid not null references public.study_groups(id),
  user_id       uuid not null references public.profiles(id),
  role          text not null default 'member' check (role in ('owner','admin','member')),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  muted         boolean not null default false,
  last_read_seq bigint not null default 0,     -- ★ 읽음 상태를 여기 접는다
  msg_tokens    real not null default 20,      -- 토큰 버킷 (§6.1)
  tokens_at     timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_live_idx on public.group_members (user_id) where left_at is null;
```

**별도 `read_states` 테이블을 만들지 않는다.** 읽음 상태는 (그룹, 사용자)당 정확히 한 행이고 그건 이미 `group_members`다. 안읽음 수는 `messages.seq > last_read_seq` 카운트.

INSERT **정책 없음** — 가입은 `join_group_with_code()`/`respond_group_invite()` RPC 전용(직접 INSERT 허용 시 group_id만 알면 무단 입장). UPDATE는 본인 행의 `last_read_seq`/`muted`만.

### 2.4 `invite_codes` — 6자리 코드와 그 수학

```sql
create table public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[0-9A-HJ-KM-NP-TV-Z]{6}$'),
  group_id    uuid not null references public.study_groups(id),
  created_by  uuid not null references public.profiles(id),
  expires_at  timestamptz not null,
  max_uses    int  not null default 0,          -- 0 = 무제한
  use_count   int  not null default 0,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index invite_codes_live_per_group_uq
  on public.invite_codes (group_id) where revoked_at is null;
```

| 방식 | 공간 | 활성 1,000개 시 1회 적중률 | 활성 10,000개 시 |
|---|---|---|---|
| 숫자 6자리 `10^6` | 1,000,000 | 1/1,000 | **1/100** |
| Crockford Base32 6자 `32^6` | 1,073,741,824 | 1/1,073,741 | 1/107,374 |

- **숫자 6자리는 안전하지 않다.** 활성 1만 개면 100번당 1번 남의 방에 들어간다. 분당 5회 제한에도 하루 7,200회 → 기대 적중 72회. 폐기
- **Crockford Base32 채택.** `0-9 A-Z`에서 혼동문자 `I L O U` 제거 = 32개. 입력 시 대문자화 + `O→0, I/L→1` + 공백/하이픈 제거 → **체감은 여전히 "6자리"**이고 오타는 오히려 준다
- 탈취 저항: 활성 1만 개, 적중률 9.3e-6. §6.1의 5회/5분이면 기대 1회 적중까지 **약 12년**
- 충돌: 동시 활성 1만 개 → 쌍 충돌 확률 ≈ 4.7%지만 `unique(code)` + 생성 시 최대 5회 재시도로 흡수(재시도 확률 1e-5)
- 생성은 `gen_random_bytes(8)` → base32 (모듈로 바이어스 회피)

**정책**: 그룹당 살아있는 코드는 항상 1개(부분 유니크 인덱스) — "코드 새로 만들기"가 사실상 **초대 잠금 장치**. 기본 **TTL 7일, 다회용**(1시간 TTL은 "코드 만료됐대"를 낳고 그건 "카톡보다 빠르게"를 배신한다). 옵션 "1명만 초대" → `max_uses=1`.

**`code`로 SELECT하는 경로는 존재하지 않는다.** 코드→그룹 해석은 `join_group_with_code()` RPC 내부에서만. 클라이언트가 code로 조회 가능하면 레이트리밋을 걸 지점이 사라진다.

### 2.5 `friendships` — 정규 페어 저장

```sql
create table public.friendships (
  user_a uuid not null references public.profiles(id),
  user_b uuid not null references public.profiles(id),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint canonical_pair check (user_a < user_b)
);
create index friendships_user_b_idx on public.friendships (user_b, status);
```

`user_a < user_b` 정규화로 A→B / B→A 중복 행이 원천 차단(방향은 `requested_by`가 기억). **차단은 여기 넣지 않는다** — `status`에 `blocked`를 섞으면 누가 누구를 차단했는지 구분이 안 된다(§2.8).

### 2.6 `group_invites` — 닉네임 직접 초대

```sql
create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups(id),
  invitee_id uuid not null references public.profiles(id),
  inviter_id uuid not null references public.profiles(id),
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create unique index group_invites_pending_uq
  on public.group_invites (group_id, invitee_id) where status = 'pending';
create index group_invites_invitee_idx on public.group_invites (invitee_id) where status = 'pending';
```

**친구여야 초대할 수 있는 게 아니다.** 닉네임만 알면 바로 초대가 간다. 친구 관계는 "예전에 같이 한 사람"을 **자동완성 상단에 띄우는 캐시**일 뿐이고, 그게 §5.3의 속도를 만든다.

### 2.7 `messages`

```sql
create table public.messages (
  id         uuid primary key,                 -- ★ 클라이언트 생성 (멱등 재전송)
  group_id   uuid not null references public.study_groups(id),
  seq        bigint not null,                  -- ★ 그룹별 단조 (트리거 할당)
  author_id  uuid not null references public.profiles(id),
  kind       text not null default 'text' check (kind in ('text','system')),
  body       text not null check (char_length(body) between 1 and 4000),
  reply_to   uuid references public.messages(id),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  unique (group_id, seq)
);
create index messages_group_seq_idx on public.messages (group_id, seq desc);
create index messages_author_idx    on public.messages (author_id);
```

- **PK를 클라이언트가 생성한다**(uuid v4) → 오프라인 아웃박스가 `on conflict do nothing`으로 무한 재시도해도 중복이 안 생긴다
- **정렬은 `created_at`이 아니라 `seq`.** 클라이언트 시계 오차는 실재하고 채팅 순서가 뒤집히면 제품이 망가진다. `seq`는 BEFORE INSERT 트리거가 `last_msg_seq + 1`로 할당 → 그룹 단위 연속 정수. 대가로 (a) 키셋 페이지네이션 (b) `seq != last+1` 갭 감지 — **`chat:event-batch`의 seq 로직을 그대로 복사**할 수 있다
- 삭제는 소프트. UI는 "삭제된 메시지"로 렌더

INSERT는 `author_id = auth.uid() AND kind='text' AND is_group_member(...)`. UPDATE는 RLS로 `author_id = auth.uid()`, "5분 내 본문만"·"관리자 소프트삭제"는 트리거가 강제(RLS는 컬럼/시간 표현이 빈약하므로 역할 분담).

### 2.8 `blocks` / `reports`

```sql
create table public.blocks (
  blocker_id uuid not null references public.profiles(id),
  blocked_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  target_type text not null check (target_type in ('message','profile','group')),
  target_id uuid not null,
  reason text not null check (char_length(reason) <= 500),
  snapshot jsonb,        -- 신고 시점 본문 사본 (삭제 후에도 트리아지 가능)
  created_at timestamptz not null default now()
);
```

- `blocks`: 전부 `blocker_id = auth.uid()`. **차단 사실은 차단당한 쪽에 노출되지 않는다**(SELECT가 blocker 한정이라 자동 성립)
- `reports`: **INSERT 정책 하나만.** SELECT/UPDATE/DELETE 정책이 **없다** = 누구도 못 읽는다. 대시보드(service_role)에서만 확인 → 신고자 보호와 남용 억제를 동시에

### 2.9 `rate_events`

```sql
create table public.rate_events (
  user_id uuid not null references public.profiles(id),
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events (user_id, action, created_at desc);
```
RPC들이 `check_rate(action, limit, window)` 헬퍼로 카운트. pg_cron 일 1회 2일 초과분 삭제.

### 2.10 RPC 목록 (전부 `security definer` + `set search_path = ''`)

| RPC | 하는 일 |
|---|---|
| `create_group(name, color)` | 그룹 + 오너 멤버십 + 초대코드를 한 트랜잭션에. 10/일 |
| `regenerate_invite_code(group_id, max_uses, ttl)` | 기존 revoke + 신규. 관리자만. 10/시간 |
| `join_group_with_code(code)` | 정규화 → 조회 → TTL/max_uses/revoked 검사 → 멤버십 → system 메시지. **레이트리밋 핵심 지점** |
| `invite_by_nickname(group_id, nickname)` | 멤버 확인 → 완전일치 → 차단 검사 → pending invite |
| `respond_group_invite(invite_id, accept)` | 수락 시 멤버십 생성 |
| `send_friend_request` / `respond_friend_request` | 차단 검사 + 레이트리밋 |
| `find_profile_by_nickname(nickname)` | 완전일치 전용, 30/분 |
| `leave_group` / `kick_member` / `set_member_role` | |
| `mark_read(group_id, seq)` | `last_read_seq = greatest(...)` |
| `unread_counts()` | 사이드바 배지를 **왕복 1회**로 |

---

## 3. 로컬 ↔ 원격 결합

### 3.1 결합 방식: 로컬 매핑 테이블 (컬럼 아님)

**로컬 마이그레이션 003** (`src/main/db/migrations.ts` 추가 — 적용된 마이그레이션 수정 금지 규약 준수):

```sql
-- 과목(로컬 폴더) ↔ 스터디 그룹(원격) 결합. 이 테이블은 절대 동기화되지 않는다.
CREATE TABLE IF NOT EXISTS course_group_links (
  id                 TEXT PRIMARY KEY,
  course_id          TEXT REFERENCES courses(id),   -- NULL 허용: 아직 과목에 안 붙인 그룹
  remote_group_id    TEXT NOT NULL UNIQUE,
  name_cache         TEXT NOT NULL,
  color_cache        TEXT NOT NULL,
  member_count_cache INTEGER NOT NULL DEFAULT 0,
  unread_cache       INTEGER NOT NULL DEFAULT 0,
  last_msg_at_cache  TEXT,
  joined_at          TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_course_group_links_course
  ON course_group_links (course_id) WHERE deleted_at IS NULL;
```

**컬럼이 아니라 매핑 테이블인 이유 4가지**

1. **1:N이다.** 한 과목에 "전체 공지방"과 "우리 3조"가 동시에 있는 게 정상. 컬럼은 못 담고 나중에 바꾸는 마이그레이션은 아프다
2. **`courses` 테이블이 순수 로컬로 남는다.** Phase 1 코드가 한 줄도 안 바뀐다 → 오프라인 보장이 논증이 아니라 **구조로** 성립
3. **캐시 컬럼 자리가 생긴다.** 그룹 이름·색·안읽음이 로컬에 있어 사이드바가 **네트워크 0회**로 즉시 렌더
4. **철회가 `DROP TABLE` 하나.** `course_id` NULL 허용도 중요 — 코드로 먼저 참여하고 과목은 나중에 붙이는 게 §5.2의 스텝 수를 지킨다

**역방향은 없다.** 원격 `study_groups`는 당신의 폴더 경로도 과목명도 모른다.

### 3.2 로컬 미러 테이블 (마이그레이션 003 계속)

```sql
CREATE TABLE IF NOT EXISTS group_messages_cache (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL, seq INTEGER NOT NULL,
  author_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, reply_to TEXT,
  created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT,
  UNIQUE (group_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_gmc_group_seq ON group_messages_cache (group_id, seq DESC);

CREATE TABLE IF NOT EXISTS group_outbox (
  id TEXT PRIMARY KEY,                          -- 그대로 원격 messages.id가 된다
  group_id TEXT NOT NULL, body TEXT NOT NULL, reply_to TEXT,
  state TEXT NOT NULL DEFAULT 'pending',        -- 'pending'|'sending'|'failed'
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_outbox_state ON group_outbox (state, created_at);

CREATE TABLE IF NOT EXISTS group_profiles_cache (
  user_id TEXT PRIMARY KEY, nickname TEXT NOT NULL,
  avatar_color TEXT NOT NULL, avatar_emoji TEXT NOT NULL, fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members_cache (
  group_id TEXT NOT NULL, user_id TEXT NOT NULL,
  role TEXT NOT NULL, joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
```

**진실의 원천이 Phase 1과 반대다.**

| 데이터 | 진실의 원천 | SQLite 역할 |
|---|---|---|
| Phase 1 (과목·자료·주석·노트·보드·AI대화) | **로컬** | 그 자체 |
| Phase 2 (그룹·멤버십·메시지) | **원격 Postgres** | **렌더 캐시 + 아웃박스** |

`materials_index`(디스크가 진실, DB는 캐시)와 동형이라 코드베이스에 이미 있는 개념이다. 캐시 상한 **그룹당 500개**, 초과분은 채널 종료 시 정리.

### 3.3 동기화 대상

메시지 ✅ · 멤버십/역할/초대 ✅ · 프로필 ✅ · 읽음 상태 ✅ · 친구 관계 ✅ · 프레즌스 ✅(휘발성) · 공유 태스크 보드 ❌(설계만).

### 3.4 동기화하지 **않는** 것 — 그리고 이유

**① 강의 자료 / PDF / 이미지 — 안 한다.**
- **비용**: 무료 Storage 1GB. 20MB 슬라이드 × 그룹 200개 = 4GB → 첫 달에 유료 전환이고 그 순간 "무료" 전제가 무너진다
- **저작권**: 교수 저작물을 우리 서버에 올려 재배포하는 구조다. 개인 기기에서 개인이 읽는 것과 우리가 호스팅해 배포하는 것은 법적으로 완전히 다른 행위다
- **복잡도**: 부분 다운로드·중복 제거·충돌 해소·재개 가능 업로드를 요구하는 별개 제품. 채팅 예산을 통째로 먹는다
- **대신**: 카톡처럼 "파일은 각자, 대화만 여기서". P3에서 **링크만 공유**(URL이 채팅에 붙으면 브라우저 탭으로 여는 기존 동선)로 우회 — 비용 0

**② 주석 / 노트 — 안 한다.** 주석 앵커는 `{courseId, relPath, page, rects, quote}`라 **상대가 그 파일을 갖고 있지 않으면 렌더 자체가 불가능**하다(①을 풀지 않으면 논리적으로 성립 불가). 하이라이트는 "내가 뭘 몰랐는가"의 기록이라 프라이버시 문제도 있다. 공동 편집은 CRDT급 병합(Yjs)이 필요한 P3 프로젝트.

**③ AI 튜터 대화 — 절대 안 한다.** 파일 본문·개인적 질문이 그대로 들어 있고, **사용자 본인의 Claude 구독**으로 생성된 콘텐츠다. 우리 서버로 옮길 근거가 없다.
(로컬 `messages`와 원격 `messages` 이름 충돌 주의 — 코드에서 `chatRepo`(로컬 AI) vs `groupRepo`(원격), 타입은 `ChatMessage` vs `GroupMessage`.)

**④ 과목명 / 폴더 구조 / 설정 — 안 한다.** 사적 정보이고 동기화 이익 0.

### 3.5 공유 태스크 보드 — 설계만

칸반 공유의 어려운 부분은 CRUD가 아니라 **`sort_order` 동시 편집 충돌**이다(두 명이 같은 카드를 다른 칸으로 끌면?). Fractional indexing이나 LWW 정책을 제대로 하려면 마일스톤 하나가 든다. 그 예산은 채팅이 가져간다. 현재 보드가 창 단위 전역 싱글턴이라 그룹 스코프 개념 자체가 없다는 점도 있다.

P3 스케치: `sort_order INTEGER`가 아니라 처음부터 `rank text`(LexoRank류 fractional index)로 가야 한다.

---

## 4. 실시간 채팅

### 4.1 Realtime 방식: Broadcast from Database

| 후보 | 판정 |
|---|---|
| `postgres_changes` | ❌ Realtime 서버가 **구독 클라이언트마다 RLS 재평가** → 비용이 `클라이언트 수 × 변경 건수`. 무료 티어 동시 200에서 가장 먼저 무너진다. 페이로드가 원시 row diff라 닉네임 조인이 클라이언트 몫 |
| **Broadcast from Database** ✅ | AFTER INSERT 트리거가 `realtime.send(payload, 'msg', 'group:'||group_id, private := true)` → 변경 1건당 **1회 발행**(O(1)), 페이로드 모양을 우리가 정한다(닉네임 포함 → 조인 왕복 제거) |
| Broadcast만 (클라이언트 발신) | ❌ 메시지 유실 = 영구 유실. DB가 발신원이어야 "저장된 것만 방송된다"가 보장 |

**private 채널 인가** — `realtime.messages`에 정책 2개:
```sql
create policy "group members can receive" on realtime.messages
for select to authenticated using (
  realtime.topic() like 'group:%'
  and public.is_group_member((substring(realtime.topic() from 7))::uuid, auth.uid())
);
-- insert 정책도 동일 조건 (presence track / 향후 broadcast)
```
클라이언트는 `supabase.realtime.setAuth()`로 JWT를 채널에 실어야 한다 — **빼먹으면 조용히 아무것도 안 온다**(대표적 디버깅 지옥).

**폴백**: `realtime.send()`가 없는 버전이면 `postgres_changes` + filter로 내려간다. `GroupEvent` 인터페이스는 동일 유지 → 어댑터 교체로 끝.

### 4.2 어느 프로세스가 Supabase 클라이언트를 소유하는가 — **메인**

1. **토큰 격리가 유일하게 진지한 이유다.** 이 렌더러는 임의 웹을 로드하는 `<webview>` 게스트와 원격 마크다운을 렌더하는 Milkdown을 품는다. 렌더러에 리프레시 토큰이 있으면 XSS 한 방이 계정 탈취다. 메인에 있으면 XSS가 얻는 최대치는 **타입드 IPC 호출권**이고 그건 RLS와 메인측 레이트리밋으로 이미 좁혀져 있다
2. **기존 아키텍처 정합** — "main이 진실의 원천, renderer는 하이드레이션 + push 무효화". 렌더러 소유는 두 번째 진실의 원천을 만든다
3. **아웃박스가 렌더러 리로드를 견뎌야 한다** — 큐는 SQLite에 있고 SQLite는 메인에만 있다
4. **장수명 프로세스 관리 패턴이 이미 메인에 있다** — Realtime 채널은 `SessionManager`의 CLI 프로세스와 수명 특성이 같다(유휴 회수, LRU, 갑작스러운 종료)
5. **CSP** — 렌더러 CSP에 `*.supabase.co`를 열 필요가 없다

*반대 논거(기록)*: 렌더러 소유면 supabase-js 재연결을 공짜로 쓰고 프레즌스에 IPC 홉이 없다. → 재연결은 어차피 감쌀 로직이고 타이핑은 안 만든다. 기각.

**파일 배치** (`src/main/features/agent/`와 대칭):
```
src/main/features/group/
  supabaseClient.ts        # 싱글턴 + safeStorage 어댑터 + setAuth
  authService.ts           # OAuth/딥링크/세션 복원/auth:changed
  GroupRealtimeManager.ts  # ★ SessionManager의 형제: 채널 수명·유휴 회수·LRU
  groupRepo.ts             # SQLite 캐시 + course_group_links
  OutboxUploader.ts        # 지수 백오프 드레인
  groupEventBatcher.ts     # createEventBatcher 재사용
  rateGuard.ts             # 메인측 1차 방어선
```

### 4.3 페이지네이션 · 갭 감지

- **첫 렌더**: 로컬 캐시 tail **50개**를 IPC 1회·네트워크 0회로 그린다
- **정합**: 이어서 실제 최신 50을 받아 upsert → 조용히 리컨사일
- **위로 스크롤**: 키셋 `where seq < $cursor order by seq desc limit 50` (오프셋 금지 — 신규 메시지에 미끄러진다)
- **갭 감지**: `incoming.seq !== lastSeq + 1` → `group:open` 재수화. `useChatSession`의 `checkBatchSeq` → `open({discardQueue:true})`와 **완전히 같은 모양**
- 재연결 시 `where seq > localMaxSeq` 한 번으로 따라잡는다

### 4.4 오프라인 / 큐

```
send(body)
 ├─ group_outbox INSERT (id = crypto.randomUUID(), state='pending')
 ├─ 로컬 에코 push → 렌더러가 즉시 pending 버블
 └─ OutboxUploader 깨우기

drain()
 ├─ insert → 성공: outbox 삭제 (실제 행은 broadcast로 seq와 함께 돌아옴)
 │           409/중복: 이미 들어감 → 삭제 (멱등)
 │           네트워크: attempts++, 1s→2s→4s→…→60s 캡
 │           attempts>=6: state='failed' → "전송하지 못했어요 · 다시 시도"
 └─ ★ 재연결 순서: 아웃박스 드레인 먼저, 그 다음 seq>local 페치
      (역순이면 내 메시지가 남의 메시지 뒤로 밀려 보인다)
```

로컬 에코는 `seq`가 없으므로 항상 리스트 맨 아래. 브로드캐스트가 같은 `id`로 돌아오면 **치환**(id 매칭이라 중복 없음). 실패 메시지는 앱을 껐다 켜도 남는다(아웃박스가 SQLite) — 카톡의 빨간 느낌표와 같은 계약.

### 4.5 채널 수명 (GroupRealtimeManager)

`SessionManager` 규칙을 그대로 옮긴다.
- 구독은 **`group-chat` 탭이 열려 있을 때만**. 탭 닫기 → 소프트(2분 유예)
- **동시 구독 채널 상한 5개, LRU 축출** — 무료 티어 동시 200이 앱당 채널 수에 곱해지는 걸 막는다
- 창 blur **5분** → 전 채널 unsubscribe (배터리 + 접속 슬롯 반납), 포커스 복귀 시 재구독 + 캐치업
- `before-quit`에서 `groupRuntime.dispose()` — 기존 정리 훅 옆에 추가

### 4.6 프레즌스 · 타이핑

- **프레즌스: 만든다.** 같은 채널에 `channel.track({user_id})`. 탭 헤더에 "3명 접속 중". DB 쓰기 0, join/leave 시에만 메시지
- **타이핑: P2에서 안 만든다.** 한 문장 칠 때 스로틀해도 3~5건 × 5명 팬아웃 = **메시지 1건당 실시간 15~25건**(실제 메시지의 ~10배). 2M/월 쿼터를 여기 태우면 실 채팅 용량이 1/10로 준다. 조별과제 채팅은 실시간 대화보다 **비동기 조율**에 가까워 기능값도 낮다. 인프라(private channel)는 깔려 있으므로 P3 추가 비용은 작다

### 4.7 탭 레지스트리 통합 — `'group-chat'` TabKind

`src/shared/tabs.ts` 헤더가 이미 이 확장을 예고하고 있다.

```ts
export type TabKind = 'pdf' | 'note' | 'browser' | 'chat' | 'board' | 'group-chat'
export interface GroupChatTabPayload { groupId: string }   // 로컬 courseId 아님
```

| 파일 | 변경 |
|---|---|
| `tabIdentity.ts` `TAB_KINDS` | `'group-chat'` 추가 |
| `isTabDescriptor` | `case 'group-chat': isNonEmptyString(payload['groupId'])` |
| `tabPanelId` | `` `group-chat:${groupId}` `` → **그룹당 싱글턴 자동 성립** |
| `tabTitle` | `course_group_links.name_cache`, 없으면 `'그룹 채팅'` |
| `tabRegistry.tsx` | `{ component: GroupChatTab, icon: null, defaultTitle: tabTitle }` |
| 레이아웃 하이드레이션 | 비멤버 그룹 탭은 **드롭**. 로그아웃이면 전부 드롭 |
| `NewTabMenu` | "그룹 채팅" 항목, 로그아웃 시 로그인 카드 |

### 4.8 IPC 계약 확장 [C6]

```ts
// auth
'auth:getState'   { req: {}; res: AuthState }
'auth:signIn'     { req: { provider: 'kakao'|'google' }; res: { ok: true } }  // 브라우저 열고 즉시 반환
'auth:signOut'    { req: {}; res: { ok: true } }
'auth:setNickname'{ req: { nickname: string }; res: MyProfile }
'auth:setAvatar'  { req: { color?: string; emoji?: string }; res: MyProfile }

// groups — 로컬 캐시 기반. 네트워크 미도달이어도 성공한다.
'groups:list' 'groups:create' 'groups:joinWithCode' 'groups:currentCode'
'groups:regenerateCode' 'groups:linkCourse' 'groups:leave' 'groups:members' 'groups:kick'

// invites / friends
'groups:inviteByNickname' 'invites:listPending' 'invites:respond'
'friends:list' 'friends:request' 'friends:respond'

// group chat
'groupChat:open' 'groupChat:send' 'groupChat:loadOlder' 'groupChat:markRead'
'groupChat:retry' 'groupChat:deleteMessage' 'groupChat:close'

// safety
'safety:block' 'safety:report'
```

```ts
// events.ts
'auth:changed':       AuthState
'group:event-batch':  { groupId: string; seq: number; events: GroupEvent[] }
'groups:invalidated': { reason: 'membership'|'invite'|'unread'|'profile' }

// shared/types/group-events.ts  [C8]
export type GroupEvent =
  | { type: 'message'; message: GroupMessage }
  | { type: 'message-updated'; messageId: string; body: string | null; deleted: boolean }
  | { type: 'local-echo'; localId: string; body: string; createdAt: string }
  | { type: 'local-echo-settled'; localId: string; messageId: string; seq: number }
  | { type: 'local-echo-failed'; localId: string; reason: 'network'|'rate-limit'|'rejected' }
  | { type: 'presence'; online: { userId: string }[] }
  | { type: 'member-joined'; member: GroupMember }
  | { type: 'member-left'; userId: string }
  | { type: 'connection'; state: 'connected'|'reconnecting'|'degraded-polling'|'offline' }
```

preload `PUSH_CHANNELS`에 3개 추가. 그 외 `src/preload/index.ts`는 변경 없음(제네릭 브리지).

---

## 5. "카톡보다 빠르게" — 스텝 카운트

> 기준: 로그인 이후 스텝(로그인은 평생 1회).
> 비교군 — 카톡 조별방: 열기→채팅탭→새채팅→일반채팅→친구 5명 체크→확인→방 이름→저장 = **8+ 스텝**, 애초에 친구 등록이 선행돼야 한다.

### 5.1 (a) 과목용 그룹 만들고 코드 받기 — **1 스텝**

```
[과목 hover → "함께" 아이콘 클릭]          ← 1
   ↓ 다이얼로그 없음
그룹 생성(이름=과목명, 색=과목색) + 초대코드 + group-chat 탭 열림
★ 코드가 자동으로 클립보드에 복사됨
토스트: "코드 K7M2QX 복사됐어요 · 카톡에 붙여넣으면 돼요  [되돌리기]"
```

**다이얼로그를 없앤 게 핵심.** 이름/색을 물으면 그 자체로 2~3스텝이 된다. 기본값이 99% 맞으므로 먼저 만들고 탭 헤더에서 인라인 편집. 실수 방어는 확인창이 아니라 **토스트 안 [되돌리기] 10초**(스텝 0). `toast.tsx`가 이미 있으므로 액션 슬롯만 추가.

### 5.2 (b) 코드로 참여 — **2 스텝 (클립보드에 코드가 있으면 1)**

```
[좌측 레일 "코드로 참여" 또는 ⌘⇧J]        ← 1
   ↓ 6칸 오버레이
   ★ 열리는 순간 클립보드를 읽어 /^[0-9A-Z]{6}$/ 매칭 시 자동 채움 → 총 1 스텝
[6자 입력]                                ← 2
   ★ 6번째 글자에서 자동 제출 (버튼 없음)
   ↓ 참여 완료 → group-chat 탭 즉시 열림
탭 상단 비모달 바: "이 그룹을 과목에 연결할까요? [자료구조 ▾] [나중에]"
```

**과목 연결을 모달로 묻지 않는다** — 모달이면 3스텝이고 아직 과목을 안 만들었을 수도 있다. `course_group_links.course_id`가 NULL 허용인 이유가 정확히 이것.
**보너스**: `bandal://join/K7M2QX` 딥링크 → 카톡에 링크를 함께 복사하면 받는 쪽은 **1클릭 = 참여 완료**(짧은 랜딩 페이지 필요, P2-E 선택).
입력 정규화: 대문자화, `O→0 · I,L→1`, 공백/하이픈 제거.

### 5.3 (c) 닉네임으로 초대 — **2~3 스텝, 재초대는 1~2 스텝**

```
[탭 헤더 "+ 초대"]                         ← 1
   ↓ 초대 팔레트 (⌘P와 같은 컴포넌트 계열)
   ★ 열자마자 비어 있지 않다: "최근에 같이 한 사람"(로컬 캐시, 네트워크 0)
     → 여기 있으면 클릭 1번 = 총 2 스텝, 타이핑 0
[닉네임 타이핑]                            ← 2
   ★ 로컬 캐시 즉시 프리픽스 필터(오프라인 동작)
   ★ 캐시에 없으면 300ms 디바운스 후 완전일치 RPC 1회
[결과 클릭] = 즉시 초대 발송                ← 3
```

1. **친구가 아니어도 바로 초대할 수 있다.** "친구추가→수락 대기→초대"는 3단 왕복이라 카톡보다 느리다
2. **친구 목록은 자동완성 캐시일 뿐** → **두 번째 조별과제부터 타이핑 0**. 이게 진짜 속도다
3. **서버 검색은 완전일치 전용** — 프리픽스를 서버에 열면 닉네임 디렉토리가 통째로 긁힌다

### 5.4 요약

| 플로우 | Bandal | 카카오톡 |
|---|---|---|
| 그룹 만들고 코드 배포 | **1** (+자동 복사) | 8+ (친구 등록 선행) |
| 코드로 참여 | **2** (클립보드 1, 딥링크 1클릭) | 3~4 |
| 닉네임 초대 | **3** (재초대 2) | 6+ |

---

## 6. 남용 / 안전 / 비용

### 6.1 레이트리밋

**2단 방어**: ① 메인 `rateGuard`(왕복 없이 즉시 거절, UX용) ② RPC 내부 `check_rate()`(진짜 방어, 우회 불가). ①만 있으면 무의미하고 ②만 있으면 UX가 나쁘다.

| 액션 | 제한 | 초과 시 |
|---|---|---|
| `join_group_with_code` | **5회/5분**, 20회/시간, 연속 실패 10회 → 1시간 잠금 | "잠시 후 다시 시도해요 · 12분 남음" |
| 같은 그룹 가입 | 30회/시간/그룹 | 코드 자동 revoke + 오너에게 system 메시지 |
| 메시지 전송 | **토큰 버킷** 용량 20, 초당 2 리필 | 전송 비활성 + "조금만 천천히 보내요" |
| `invite_by_nickname` | 20/일/사용자, 10/시간/그룹 | |
| `send_friend_request` | 20/일 | |
| `find_profile_by_nickname` | 30/분 | |
| `create_group` | 10/일 | |

**메시지 제한은 RPC가 아니라 트리거의 토큰 버킷.** 전송 경로를 `insert` 그대로 둬야 브로드캐스트 트리거와 RLS가 단순하게 유지되고, `rate_events` 스캔과 달리 자기 행 UPDATE 하나로 **O(1)**다.

```sql
new_tokens := least(20, msg_tokens + extract(epoch from now() - tokens_at) * 2);
if new_tokens < 1 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
update group_members set msg_tokens = new_tokens - 1, tokens_at = now() where …;
```

본문 4,000자 상한. **첨부 없음** → Storage 남용 표면 0. URL 자동 프리뷰(unfurl) 안 함 — SSRF·egress·프라이버시가 한꺼번에 붙는 기능이다.

### 6.2 무료 티어 용량 — 실제 숫자

| 자원 | 무료 한도 | 소비 모델 | 한계 규모 |
|---|---|---|---|
| 동시 Realtime 접속 | **200** | 탭이 열려 있고 창이 포커스된 사용자만 | 피크≈MAU의 5% → **MAU 약 4,000** |
| Realtime 메시지 | **2M/월** | 5인 그룹 1건 = 5건 소비 → 400,000 전송/월 ≈ **13,000/일** | 활성 그룹 200개 × 65건/일 |
| DB 용량 | **500 MB** | 행 ≈ 200B + 인덱스 ≈ 300B | **약 80만 메시지** → 13,000/일이면 **약 60일** ⚠ |
| Egress | 5 GB/월 | 텍스트만 | 여유 |
| Auth MAU | 50,000 | | 여유 |
| Storage | 1 GB | **사용 안 함** | — |

**병목은 DB 용량이다**(동시접속이 아니라). 대응: pg_cron 주 1회 — 그룹당 최근 **5,000건** 초과 + **180일** 초과 삭제(앱 내 고지 필수). 그래도 넘으면 Pro $25/월. **무료 실용 한계 ≈ 등록 1,500~2,000명 / 활성 그룹 300개** — 파일럿(한 학교 한 학기)엔 충분하고 넘으면 이미 유료화를 논할 시점.

⚠ **무료 프로젝트는 7일 무활동 시 일시정지.** 방학에 트래픽이 끊기면 개강일에 죽어 있다. (a) 수용+수동 재개 (b) 주 1회 외부 크론 핑 (c) Pro. **권장 (b)** — GitHub Actions 스케줄로 P2-E에서 5분.

### 6.3 한계 도달 시 동작

| 상황 | 동작 |
|---|---|
| WS 끊김 | `degraded-polling` → **15초 폴링** 자동 강등. "실시간 연결이 불안정해요 · 15초마다 새로고침 중" (accent-muted, danger 아님) |
| 완전 오프라인 | 입력창은 살아 있다. pending 누적. "오프라인이에요 · 연결되면 전송돼요" |
| DB 용량 초과 | 아웃박스 `failed`. "지금은 보낼 수 없어요". **조용히 삼키지 않는다** |
| 레이트리밋 | 전송 비활성 + 남은 시간 카운트다운 |
| 세션 만료 | `signed-out` + 재로그인 카드. **Phase 1 무영향** |

### 6.4 차단 · 신고

**차단은 P2에 넣는다** — 테이블 1개 + 필터이고 없는 채로 배포하는 건 무책임하다. 멤버/메시지 컨텍스트 메뉴 → 2단 확인. 효과: (a) 해당 작성자 메시지를 "차단한 사용자의 메시지" 접힌 행으로 대체 (b) 친구요청·초대 RPC가 양방향 차단 시 거절 (c) 그룹 강제 분리는 안 함(P3). 차단 사실은 상대에게 노출되지 않는다.

**신고는 스텁이다 — 명시적으로.** 사유 선택 + 자유 서술 → `reports` INSERT(`snapshot` 포함해 삭제 후에도 확인 가능). **모더레이션 큐 UI 없음, 자동 조치 없음, 트리아지는 대시보드 수동.** 현 규모에선 이게 정직한 수준이고 접수 경로 자체는 존재한다. 오너의 실질 1차 대응은 강퇴 + 코드 재발급.

---

## 7. 마일스톤 & 병렬 워크스트림

계약: **C6** contract.ts auth/group 채널 + types · **C7** `'group-chat'` TabKind · **C8** `GroupEvent` union · **C9** `supabase/migrations/*.sql` · **C10** 로컬 마이그레이션 003. `[CP]` = 크리티컬 패스.

### P2-A — 계약 + 인증 (직렬) `[CP]`
프로바이더 설정, `@supabase/supabase-js` 추가, `bandal://` 프로토콜 등록(dev/prod), `safeStorage` 세션 스토어, `authService`, `auth:*` IPC + push, **C6~C10 전체 동결**(구현 스텁).
**게이트**: typecheck/build 그린 **AND** `BANDAL_SUPABASE_URL=''`로 기존 E2E 3종 그린 **AND** 네트워크 차단 부팅 E2E 신규 1종.

### P2-B — 원격 스키마 & RLS (C9 확정 후, A와 부분 병렬)
9개 테이블 + 헬퍼 2 + RLS 전수 + RPC 11 + 토큰 버킷 트리거 + 브로드캐스트 트리거 + `realtime.messages` 정책 + pg_cron 3.
**게이트(반드시 증명)**: ① 비멤버 SELECT 0행 ② `invite_codes` code 조회 불가 ③ 6회 시도 시 6번째 거절 ④ 21번째 메시지 `rate_limited` ⑤ **RLS 재귀 없음**.

### P2-C — 메인측 그룹 런타임 (A 이후) `[CP]`
`src/main/features/group/` 전체. `GroupRealtimeManager`(유휴 2분, LRU 5, blur 5분), `groupRepo`, `OutboxUploader`, `groupEventBatcher`(델타 없으므로 debounce 16ms/maxWait 100ms), 폴링 강등, `registerHandlers.ts`에 `// -- groups (P2-C)` 섹션 추가(기존 섹션 불변), `before-quit` 훅.

### P2-D — 렌더러 UI (A 이후, B·C와 **완전 병렬**)
로그인 게이트, 닉네임 온보딩, `GroupChatTab` + `useGroupChat`(**`useChatSession`을 그대로 본뜬다**), 좌측 레일 "함께하기" + 안읽음 배지, 1클릭 그룹 만들기 + 되돌리기 토스트, 6칸 코드 오버레이(자동 제출 + 클립보드 프리필), 초대 팔레트, 멤버 목록 + 프레즌스, 연결 배너, 빈 상태 3종.
**Mock 어댑터로 개발** — P2-C 없이도 `GroupEvent` 스트림을 위조해 UI를 완성할 수 있게 `lib/ipc.ts` 레벨 주입.

### P2-E — 통합 · 안전 · 폴리시
과목↔그룹 연결 바, `bandal://join/<code>` 딥링크, 차단/신고 UI, 레이트리밋 문구, 저하 모드 배너, pg_cron 보존 + 인앱 고지, 무활동 방지 핑, **Phase-1 오프라인 회귀 E2E 전수**, 두 테마 QA. (여유 시 공유 보드 스파이크 — 예산 초과 시 가장 먼저 자를 항목.)

**크리티컬 패스**: `P2-A → P2-C → P2-E` (B는 A와 겹쳐 시작, D는 A 이후 완전 병렬).
**파일 소유권**: P2-B=`supabase/**` / P2-C=`src/main/features/group/**` / P2-D=`src/renderer/src/features/group/**` + 스토어. `registerHandlers.ts`·`tabRegistry.tsx`·`tabIdentity.ts`는 **머지 포인트 — 오케스트레이터가 직접 편집**.

### 7.1 시크릿 / 설정 주입

```
.env.local          (gitignored)
  MAIN_VITE_SUPABASE_URL=https://xxxx.supabase.co
  MAIN_VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
.env.example        (커밋 — 키 이름만)
```

- electron-vite는 `MAIN_VITE_*`만 main 번들에 노출한다. **`VITE_*`(렌더러 노출)를 쓰면 안 된다** — 렌더러는 Supabase를 몰라야 한다(§4.2)
- **publishable key는 비밀이 아니다.** 공개 식별자이며 모든 권한은 RLS와 JWT가 결정한다. 그래서 §2의 RLS가 유일한 방어선이고 P2-B 게이트가 그토록 엄격한 것이다
- 🚨 **`service_role` 키는 절대 앱에 들어가지 않는다.** RLS를 통째로 우회한다. 리포·`.env`·번들·로그 어디에도 없다. 존재 위치는 대시보드와 (CI를 쓴다면) CI 시크릿 두 곳뿐
- 값이 없는 빌드 → `phase='unconfigured'` → 커뮤니티 UI 부재, 앱 정상 동작. **기여자가 키 없이 클론해서 빌드할 수 있어야 한다**는 요구도 여기서 충족
- `@supabase/supabase-js`는 순수 JS → 네이티브 리빌드 없음. `externalizeDepsPlugin` + electron-builder 자동 prod 번들링에 그대로 태워진다. **추가 패키징 설정 불필요**

### 7.2 로컬 마이그레이션

`migrations.ts`에 `version: 3, name: 'phase2-group-links-and-cache'` 추가. **기존 1·2는 절대 수정하지 않는다.**

### 7.3 🚩 계정 소유자만 결정할 수 있는 것

1. **리전** — `ap-northeast-2 (Seoul)` 권장 (실시간 RTT 체감)
2. **OAuth 프로바이더** — 구글(설정 간단) vs 카카오(커버리지 최고, 개발자 앱 등록·동의항목·심사 선행). **권장: 구글 먼저, 카카오는 P2-E**
3. **Redirect URL 등록** — `bandal://auth/callback`. 없으면 로그인이 조용히 실패한다
4. **7일 무활동 일시정지** 수용 여부
5. **메시지 보존 정책 승인** — 그룹당 5,000건 / 180일 + 고지 문구
6. **개인정보처리방침 / 이용약관** — 닉네임과 채팅 기록을 저장하는 순간 필요. 배포 전 필수
7. **CLI access token 발급 여부** — `supabase db push` 자동화 vs 대시보드 SQL 에디터 수동

---

## 8. 위험 목록

| 위험 | 완화 |
|---|---|
| **RLS 무한 재귀**로 전 쿼리 정지 | §2.0 SECURITY DEFINER 헬퍼. P2-B 게이트 ⑤에서 명시 증명 |
| `realtime.setAuth()` 누락 → 조용한 무동작 | P2-C 첫 스모크가 "타 계정 메시지 3초 내 도착"을 검증 |
| dev에서 `bandal://` 미등록 | `process.defaultApp` 분기. P2-A에서 dev/prod 양쪽 수동 확인 |
| macOS 콜드 스타트 `open-url` 유실 | `whenReady()` **전에** 핸들러 등록 |
| 무료 DB 60일 포화 | 보존 정책을 P2-E가 아니라 **P2-B에** 넣는다(pg_cron을 처음부터) |
| Phase 1 회귀 | 매 게이트에 오프라인 E2E. `registerHandlers.ts` 기존 섹션 diff 0 유지 |
| `messages` 이름 충돌(로컬 AI vs 원격) | `chatRepo`/`ChatMessage` vs `groupRepo`/`GroupMessage` |
| 닉네임 선점 | 초기 무시. 유일 인덱스가 있어 P3 디스크리미네이터 **추가** 가능(제거 불가) |
