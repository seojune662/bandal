# `supabase/` — Bandal Phase 2 원격 스키마 (P2-B / 계약 C9)

`docs/phase2-community.md` §2 (데이터 모델) · §4.1 (Broadcast from Database) ·
§6.1 (레이트리밋) · §6.2 (보존 정책)을 실제 SQL 로 옮긴 것입니다.

> 🚨 **실제 Supabase 프로젝트에서는 아직 한 번도 실행되지 않았습니다.**
> 작성 환경에 프로젝트 자격증명도 CLI 토큰도 없었습니다.
>
> 대신 **로컬 PostgreSQL 14 에 Supabase 모양의 스텁**(`auth.uid()`, `auth.users`,
> `realtime.send()`, `realtime.messages`, `anon`/`authenticated` 롤, Supabase 와
> 동일한 `alter default privileges`)을 세우고 0001~0009 를 전부 적용해
> `tests/rls_verification.sql` 38개 검사 + 별도 공격 시나리오 25개를 전부
> 통과시켰습니다. 마이그레이션 2회 재적용(멱등성)과 `seed.sql` 도 확인했습니다.
>
> 이 검증으로 잡히지 **않는** 것은 다음과 같고, 적용 후 직접 확인해야 합니다:
> - 실제 Realtime 서버의 채널 인가 동작 (스텁은 `realtime.messages` 테이블 RLS 만 흉내냅니다) → **6.3 실시간 스모크 필수**
> - 실제 GoTrue 의 `auth.users` 트리거 타이밍
> - `pg_cron` 등록 (로컬에 확장이 없어 NOTICE 경로만 확인됨) → **6.2 (f) 확인 필수**
> - PostgreSQL 15/17 과 14 의 차이 (문법상 문제 없는 범위만 씀)
>
> **게이트 5종이 실제 프로젝트에서 전부 PASS 해야 P2-B 가 끝납니다.**

> 🚨 **`service_role` 키는 이 디렉토리 어디에도 없고, 있어서도 안 됩니다.**
> 앱은 publishable key 만 씁니다. 모든 권한은 RLS 와 JWT 가 결정합니다(§7.1).

---

## 1. 파일 구성

```
supabase/
├── README.md
├── migrations/
│   ├── 0001_extensions_and_helpers.sql   확장 + ★RLS 재귀 차단 헬퍼 + 레이트리밋 헬퍼
│   ├── 0002_profiles.sql                 profiles + auth 트리거 + 닉네임 완전일치 RPC
│   ├── 0003_groups_and_members.sql       study_groups / group_members + 그룹 RPC 7종
│   ├── 0004_invite_codes.sql             Crockford Base32 코드 + join_group_with_code
│   ├── 0005_friendships_and_invites.sql  친구 + 닉네임 초대 + 응답 RPC
│   ├── 0006_messages.sql                 messages + ★seq 트리거 + ★토큰 버킷
│   ├── 0007_safety_and_rate.sql          blocks / reports / rate_events
│   ├── 0008_realtime_broadcast.sql       realtime.send 트리거 + realtime.messages 정책
│   ├── 0009_cron_retention.sql           pg_cron 보존 정책 (없으면 건너뜀)
│   └── 0010_whiteboards.sql              그룹 보드/도형 + 전용 토큰 버킷 + Broadcast
├── tests/
│   └── rls_verification.sql              P2-B + 화이트보드 게이트 6종 증명
└── seed.sql                              로컬 개발 시드 (로컬 전용)
```

**순서대로, 전부 적용해야 합니다.** 일부만 적용하면 안 됩니다 — 4절 참고.

---

## 2. 적용 방법 A — 대시보드 SQL 에디터 (CLI 토큰 없이)

계정 소유자 결정사항 §7.3-7 에서 "CLI access token 발급 안 함"을 골랐다면 이 경로입니다.

1. Supabase 대시보드 → **SQL Editor** → **New query**
2. `migrations/0001_extensions_and_helpers.sql` **파일 전체**를 붙여넣고 Run
3. 성공을 확인한 뒤 `0002` → `0003` → … → `0009` 를 **같은 순서로 하나씩** 반복
4. 각 실행 후 에디터 하단 **Notices** 를 확인 (`[0001] pgcrypto …`, `[0008] realtime.messages 정책 2종을 생성했습니다`, `[0009] pg_cron 잡 … 등록했습니다`)

### 주의

- **한 파일을 통째로** 실행하세요. 파일 안의 문장을 골라 실행하면 `set check_function_bodies = off` 가 빠져 전방 참조 함수 생성이 실패합니다.
- 0008 과 0009 는 권한/확장 문제 시 **에러가 아니라 NOTICE 를 남기고 통과**합니다. Notices 를 반드시 읽으세요. 조용히 건너뛴 것을 성공으로 착각하면 실시간이 안 오거나 DB 가 60일 만에 포화합니다(§6.2).
- 0008 의 `realtime.messages` 정책은 **`postgres` 롤**로 실행해야 만들어집니다. 대시보드 SQL 에디터가 기본으로 그 롤입니다.

---

## 3. 적용 방법 B — `supabase db push` (CLI)

```bash
# 1) CLI 설치 후 프로젝트 연결 (access token 필요 — §7.3-7)
supabase login
supabase link --project-ref <your-project-ref>

# 2) 적용될 내용 먼저 확인 (실행하지 않음)
supabase db push --dry-run

# 3) 적용
supabase db push
```

`migrations/` 파일명이 `NNNN_name.sql` 형식이라 CLI 는 사전순으로 적용합니다.
Supabase 표준 타임스탬프 형식(`20250805103000_name.sql`)을 쓰고 싶다면 파일명만
일괄 변경하세요 — **내용은 그대로 순서가 유지**됩니다.

### 로컬에서 먼저 돌려보기 (권장)

```bash
supabase start          # 로컬 Postgres + Auth + Realtime
supabase db reset       # migrations 전부 + seed.sql 적용
```

`seed.sql` 은 로컬 전용입니다. 테스트 사용자 `나리`/`달기`(비밀번호 `password123`)와
데모 그룹, 초대 코드 `K7M2QX` 를 만듭니다. **호스팅 프로젝트에 실행하지 마세요.**

---

## 4. 왜 "전부, 순서대로" 인가 — 전방 참조

RLS 정책과 RPC 는 서로를 참조합니다. 예를 들어

- `0002` 의 `profiles` SELECT 정책은 `is_friend()` 를 부르고, 그 함수는 `0005` 의 `friendships` 를 읽습니다.
- `0001` 의 `check_rate()` 는 `0007` 의 `rate_events` 를 씁니다.
- `0003` 의 `create_group()` 은 `0004` 의 `mint_invite_code()` 를 부릅니다.

이걸 피하려고 파일을 잘게 쪼개면 "테이블 전부 → 헬퍼 전부 → 정책 전부" 같은
읽기 어려운 배치가 됩니다. 대신 각 파일 맨 위에서 `set check_function_bodies = off`
로 생성 시 본문 검증을 끄고, 헤더 주석에 의존 관계를 적었습니다.

**결과: 0001만, 또는 0006까지만 적용한 상태는 정상 상태가 아닙니다.**
런타임에 `relation "public.rate_events" does not exist` 같은 오류가 납니다.
`0009` 까지 전부 적용하세요.

---

## 5. 설계상 알아 두면 좋은 것

### 5.1 RLS 무한 재귀 (§2.0) — 이 스키마의 1번 실패 모드

`study_groups` 정책이 `group_members` 를 서브쿼리로 참조하고 그 반대도 참조하면
모든 쿼리가 `42P17 infinite recursion detected in policy` 로 죽습니다.

이 스키마의 **모든 그룹 스코프 정책은 `SECURITY DEFINER` 헬퍼만 호출**합니다:

| 헬퍼 | 쓰는 곳 |
|---|---|
| `is_group_member(gid, uid)` | study_groups / group_members / messages / group_invites / realtime.messages |
| `is_group_admin(gid, uid)` | study_groups UPDATE, 코드 재발급, 강퇴 |
| `is_group_owner(gid, uid)` | 역할 변경, 오너 위임 |
| `shares_group_with(other, uid)` | profiles SELECT |
| `is_friend(a, b)` | profiles SELECT |
| `is_blocked_either_way(a, b)` | 초대·친구요청 RPC (authenticated 에게 노출 안 함) |

전부 `set search_path = ''` + `revoke execute … from public` 입니다.
`tests/rls_verification.sql` 의 게이트 ⑤ 가 **정적으로도**(정책 식에 테이블명이
직접 등장하는지) **동적으로도**(모든 테이블을 실제로 SELECT) 검사합니다.

### 5.2 오류 규약

| 상황 | sqlstate | message |
|---|---|---|
| 레이트리밋(RPC) | `P0001` | `rate_limited` (DETAIL=action, HINT=재시도까지 초) |
| 레이트리밋(메시지 토큰 버킷) | `P0001` | `rate_limited` (DETAIL=`message_send`) |
| 권한 없음 | `P0001` | `not_authorized` / `not_a_member` |
| 닉네임 중복 | `23505` | (unique_violation — `profiles_nickname_key_uq`) |
| RLS 위반 | `42501` | (insufficient_privilege) |

메인 프로세스의 `rateGuard` 는 `sqlstate = 'P0001' AND message = 'rate_limited'`
하나로 분기하면 됩니다.

**예외 하나**: `join_group_with_code()` 는 실패를 `raise` 하지 않고
`{ ok: false, error: 'invalid_code' | 'rate_limited', retryAfter }` 를 **반환**합니다.
이유는 8절(설계 문서와의 차이) ②를 보세요.

### 5.3 클라이언트가 알아야 할 계약

- **메시지 `id` 는 클라이언트가 만듭니다**(uuid v4). 아웃박스가 `on conflict do nothing` 으로 무한 재시도해도 중복이 안 생깁니다(§4.4).
- **`seq` 는 절대 보내지 마세요.** BEFORE INSERT 트리거가 덮어씁니다.
- **`realtime.setAuth()` 를 반드시 호출하세요.** 빼먹으면 구독이 조용히 아무것도 안 받습니다(§8 위험 목록).
- 구독 토픽은 `group:<group_id>`, 이벤트는 `msg`(신규) / `msg_update`(편집·삭제)입니다.
- `msg` 페이로드에는 작성자 `nickname / avatarColor / avatarEmoji` 가 들어 있습니다 — 렌더러는 프로필 조인을 하지 않습니다.

### 5.4 RPC 목록 (전부 `security definer` + `search_path = ''`)

| RPC | 한도 | 파일 |
|---|---|---|
| `create_group(name, color)` | 10/일 | 0003 |
| `leave_group(group_id)` | — | 0003 |
| `kick_member(group_id, user_id)` | — | 0003 |
| `set_member_role(group_id, user_id, role)` | — | 0003 |
| `mark_read(group_id, seq)` | — | 0003 |
| `unread_counts()` | — | 0003 |
| `regenerate_invite_code(group_id, max_uses, ttl)` | 10/시간/그룹 | 0004 |
| `current_invite_code(group_id)` | — | 0004 |
| `join_group_with_code(code)` | 5/5분 · 20/시간 · 연속실패 10 → 1시간 | 0004 |
| `send_friend_request(nickname)` | 20/일 | 0005 |
| `respond_friend_request(requester_id, accept)` | — | 0005 |
| `remove_friend(user_id)` | — | 0005 |
| `invite_by_nickname(group_id, nickname)` | 20/일 · 10/시간/그룹 | 0005 |
| `respond_group_invite(invite_id, accept)` | — | 0005 |
| `find_profile_by_nickname(nickname)` | 30/분 | 0002 |
| `delete_message(message_id)` | — | 0006 |
| `load_messages(group_id, before_seq, after_seq, limit)` | — | 0006 |
| `block_user` / `unblock_user` / `blocked_ids` | 60/일 | 0007 |
| `report_content(target_type, target_id, reason)` | 20/일 | 0007 |
| `run_retention()` | (관리 전용, 클라이언트 EXECUTE 없음) | 0009 |

---

## 6. 적용 후 반드시 확인할 것

### 6.1 게이트 6종 — P2-B + 화이트보드 완료 조건

1. 실제 계정 2개로 앱에 로그인해 프로필을 만듭니다.
2. `select id, nickname from public.profiles order by created_at desc limit 5;` 로 uuid 2개를 확인합니다.
3. `tests/rls_verification.sql` 상단 **"◆ 여기만 고치세요"** 두 줄에 그 uuid 를 넣습니다.
   - `user_a` = 그룹을 만들 사람, `user_b` = **아무 그룹에도 속하지 않은** 사람
4. SQL 에디터에 **파일 전체를 한 번에** 붙여넣고 Run.
5. 마지막 표에서 **모든 행이 `✅ PASS`** 여야 합니다.

스크립트는 검증용 그룹/메시지/화이트보드/`rate_events` 를 실제로 만들었다가 마지막에 지웁니다.
`cleanup` 행이 FAIL 이면 detail 에 찍힌 `group_id` 로 수동 정리하세요.

추가된 ⑥ 게이트는 비멤버 숨김, 멤버 읽기/쓰기, 남의 도형 내용 수정·하드
삭제 차단, 작성자/owner 소프트삭제, 같은 id 재전송의 PK 충돌, 그리고
화이트보드 전용 버킷의 **200건 통과 / 201번째 `rate_limited`** 를 검증합니다.

### 6.2 스키마 위생 점검 (붙여넣어 실행)

```sql
-- (a) public 의 모든 테이블에 RLS 가 켜져 있는가 — rowsecurity 가 전부 true 여야 한다
select relname, relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by 1;

-- (b) 정책 전수 — 의도한 것만 있는가
select schemaname, tablename, policyname, cmd, roles
  from pg_policies where schemaname in ('public', 'realtime') order by 1, 2, 3;

-- (c) anon 에게 새어 나간 권한이 있는가 — 0행이어야 한다
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public';

-- (d) SECURITY DEFINER 함수 중 search_path 가 안 박힌 것 — 0행이어야 한다
select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%';

-- (e) realtime 정책 2종이 실제로 만들어졌는가 — 2행이어야 한다
select policyname, cmd from pg_policies
 where schemaname = 'realtime' and policyname like 'bandal%';

-- (f) pg_cron 잡 — 1행이어야 한다 (없으면 외부 스케줄러 필요, §6.2)
select jobname, schedule, command from cron.job where jobname = 'bandal-retention';
```

### 6.3 실시간 스모크 (P2-C 첫 스모크와 겹칩니다)

두 계정으로 같은 그룹에 들어간 상태에서:

1. 클라이언트 A 가 `group:<group_id>` 채널을 `private: true` 로 구독하고 **`realtime.setAuth()` 호출**
2. 클라이언트 B 가 메시지를 하나 보냄
3. **A 가 3초 안에 `msg` 이벤트를 받아야 합니다.**

아무것도 안 오면 대개 원인은 셋 중 하나입니다:
`setAuth()` 누락 / 채널이 `private: true` 가 아님 / `realtime.messages` 정책이
0008 에서 조용히 건너뛰어짐(6.2 (e) 로 확인).

### 6.4 대시보드에서 직접 해야 하는 설정 (§7.3)

SQL 로는 못 하는 것들입니다:

- [ ] **리전** — `ap-northeast-2 (Seoul)` 권장
- [ ] **Authentication → Providers** — Google 활성화 (카카오는 P2-E)
- [ ] **Authentication → URL Configuration → Redirect URLs** 에 `bandal://auth/callback` 등록 — **없으면 로그인이 조용히 실패합니다**
- [ ] **Database → Extensions** 에서 `pg_cron` 활성화 (0009 가 NOTICE 를 남겼다면)
- [ ] **7일 무활동 일시정지** 수용 여부 결정 — 주 1회 외부 핑 권장(§6.2)
- [ ] 메시지 보존 정책(그룹당 5,000건 / 180일) **앱 내 고지 문구** 준비
- [ ] 개인정보처리방침 / 이용약관 (닉네임·채팅 기록을 저장하므로 배포 전 필수)

---

## 7. 재적용 · 롤백

모든 마이그레이션은 `create … if not exists` / `create or replace` /
`drop policy if exists` 로 되어 있어 **다시 실행해도 안전**합니다.
단, 이미 데이터가 있는 상태에서 컬럼 정의를 바꾸려면 `create table if not exists`
가 그냥 넘어가므로 별도 `alter table` 마이그레이션을 새로 만들어야 합니다.

전체 철회가 필요하면(개발 중에만):

```sql
-- ⚠ 데이터가 전부 사라집니다. 운영에서 실행 금지.
drop table if exists public.reports, public.rate_events, public.blocks,
                     public.group_invites, public.friendships, public.messages,
                     public.invite_codes, public.group_members, public.study_groups,
                     public.profiles cascade;
drop trigger if exists on_auth_user_created on auth.users;
drop policy if exists "bandal group members can receive" on realtime.messages;
drop policy if exists "bandal group members can send"    on realtime.messages;
select cron.unschedule('bandal-retention');
```

---

## 8. `docs/phase2-community.md` 와 달라진 점 (전부 의도된 것)

### ① `rate_events` 에 `scope` 컬럼 추가

§2.9 원안은 `(user_id, action, created_at)` 3컬럼입니다. 그런데 §6.1 에는
"`invite_by_nickname` 10/시간/**그룹**", "같은 그룹 가입 30/시간/**그룹**" 처럼
그룹 단위 한도가 있습니다. `action` 문자열에 `group_id` 를 이어붙여 인코딩하면
인덱스 카디널리티가 망가지고 정리 쿼리도 지저분해집니다. `scope text` 한 컬럼이
정직합니다. 전역 한도는 `scope IS NULL` 입니다.

### ② `join_group_with_code()` 는 실패를 `raise` 하지 않고 반환한다

**설계 문서를 SQL 로 쓰면서 드러난 가장 중요한 결함입니다.**

§6.1 은 "RPC 내부 `check_rate()`" 로 시도를 카운트한다고 합니다. 그런데
`check_rate()` 가 `rate_events` 에 행을 넣은 뒤 RPC 가 `raise` 로 끝나면
**그 트랜잭션 전체가 롤백되어 방금 넣은 시도 기록도 사라집니다.**
즉 원안대로 쓰면 "존재하지 않는 코드로 5회 시도" 가 **한 번도 누적되지 않고**,
공격자는 32^6 공간을 무제한으로 훑을 수 있습니다. §2.4 의 "기대 1회 적중까지
12년" 계산이 통째로 무효가 됩니다.

그래서 이 RPC 만 거절을 **정상 반환값**으로 표현합니다:

```jsonc
{ "ok": true,  "groupId": "…", "name": "…", "alreadyMember": false }
{ "ok": false, "error": "invalid_code" }
{ "ok": false, "error": "rate_limited", "reason": "join_5m", "retryAfter": 214 }
```

다른 RPC(`create_group`, `invite_by_nickname`, `send_friend_request`,
`find_profile_by_nickname`)는 **성공했을 때만 카운트되면 충분**하므로 원안대로
`raise` 합니다(성공은 커밋되므로 누적이 정상 동작합니다).

메시지 전송 토큰 버킷은 이 문제가 없습니다 — `(msg_tokens, tokens_at)` 은 시간
기반 상태라 롤백되어도 정확합니다. §6.1 대로 `raise` 합니다.

**클라이언트(P2-C) 영향**: `groups:joinWithCode` 핸들러는 예외가 아니라
반환값의 `ok` 를 봐야 합니다.

### ③ 메시지 UPDATE RLS 는 작성자 한정, 관리자 삭제는 `delete_message()` RPC

§2.7 은 "UPDATE 는 RLS 로 `author_id = auth.uid()`", "관리자 소프트삭제는 트리거가
강제" 라고 합니다. 그런데 RLS 가 작성자만 통과시키면 **관리자의 UPDATE 는 트리거에
도달하기 전에 0행으로 끝납니다.** 트리거는 RLS 를 되돌릴 수 없습니다.

원안의 의도(작성자 한정 RLS)를 지키기 위해 관리자 삭제 경로를
`delete_message(message_id)` RPC(SECURITY DEFINER)로 분리했습니다.
§4.8 의 `groupChat:deleteMessage` IPC 가 그대로 이 RPC 를 부르면 됩니다.

### ④ `invite_codes` 는 SELECT 정책을 **하나도** 만들지 않았다

§2.4 는 "`code` 로 SELECT 하는 경로는 존재하지 않는다" 이지만, §4.8 에는
`groups:currentCode` 가 있습니다. "관리자면 자기 그룹 행만 SELECT" 정책으로도
게이트 ②는 통과하지만, **정책이 아예 없는 쪽이 증명이 훨씬 단순**합니다
(테이블 권한 자체가 없으므로 어떤 질의도 0행/권한오류).
관리자 조회는 `current_invite_code(group_id)` RPC 로 뺐습니다 —
입력이 `group_id` 이므로 code→group 역방향 조회가 구조적으로 불가능합니다.

### ⑤ 컬럼 화이트리스트를 트리거 + 컬럼 단위 `GRANT` 이중으로

§2.1/§2.2 는 "컬럼 화이트리스트는 트리거" 라고만 합니다. 트리거는 값을 되돌릴 뿐
UPDATE 문 자체는 허용하므로, `GRANT UPDATE (col, …)` 로 문법 수준에서도 막았습니다.
`profiles` 는 `(nickname, avatar_color, avatar_emoji, deleted_at)`,
`study_groups` 는 `(name, color)`, `group_members` 는 `(last_read_seq, muted)`,
`messages` 는 `(body, deleted_at)` 만 열려 있습니다.

### ⑤-2 `revoke … from public, anon` 만으로는 부족하다 — `authenticated` 도 회수해야 한다

**로컬 검증에서 실제로 두 개가 뚫린 지점입니다.** Supabase 프로젝트에는

```sql
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
```

이 걸려 있어서 **새로 만든 함수는 `authenticated` 에게 직접 EXECUTE 가 부여된 채로
태어납니다.** `revoke execute … from public, anon` 은 PUBLIC 경유 권한만 없애므로
`authenticated` 의 직접 권한이 남습니다. 처음 작성본에서는 그 결과

- `check_rate()` 를 클라이언트가 직접 호출 → 남의 레이트리밋을 소모시키는 공격 가능
- `is_blocked_either_way()` 를 직접 호출 → **"내가 차단당했는지" 탐지 가능**(§6.4 위반)

이 상태였습니다. 지금은 내부 전용 함수를 전부
`from public, anon, authenticated` 로 회수하고, `tests/rls_verification.sql` 에
**허용 목록 기반 전수 검사**(`⑤ authenticated 는 허용 목록 밖 함수를 EXECUTE 할 수 없다`)를
넣었습니다. **RPC 를 추가할 때마다 그 허용 목록을 갱신하세요.** 안 하면 게이트가 잡습니다.

같은 함정이 테이블에도 있어 모든 테이블을 `revoke all … from public, anon, authenticated`
후 필요한 것만 다시 GRANT 합니다.

### ⑥ 가드 트리거의 "RPC 경로" 판별을 GUC 로 하지 않는다

처음에는 `set_config('bandal.membership_write', 'on')` 플래그로 RPC 경로를
구분하려 했으나, **커스텀 GUC 는 `authenticated` 가 `set_config()` 로 직접 켤 수
있어 가드가 통째로 무력화됩니다.** 대신 `current_user` 가 해당 테이블의 소유자인지로
판별합니다 — `SECURITY DEFINER` RPC 는 함수 소유자(`postgres`)로 실행되고
클라이언트 직접 UPDATE 는 `authenticated` 로 실행되므로 위조가 불가능합니다.

### ⑦ 초대 코드 생성은 `gen_random_bytes(6)` 의 **하위 5비트 마스크**

§2.4 는 `gen_random_bytes(8) → base32` 라고만 합니다. 실제로 쓰면 "8바이트를 어떻게
6자로 줄이느냐"에서 모듈로 편향이 들어오기 쉽습니다. 균등분포 바이트의 `& 31` 은
0..31 위에서 **정확히 균등**하므로 나머지 연산 없이 편향이 0입니다.
바이트 6개 → 문자 6개, 1:1 입니다.

### ⑧ `pgcrypto` 를 `extensions` 스키마로 정규화

모든 함수가 `set search_path = ''` 이라 `gen_random_bytes` 를 스키마 수식해야 합니다.
0001 이 `pgcrypto` 의 현재 스키마를 조회해 `extensions` 가 아니면 옮깁니다
(호스팅 Supabase 는 이미 `extensions` 이므로 보통 no-op).

### ⑨ 추가한 것 (문서에 없지만 필요했던 것)

- `is_group_owner()` — 오너 위임/admin 강퇴에 `is_group_admin` 은 너무 넓습니다.
- `load_messages()` — §4.3 키셋 페이지네이션을 서버에서 못 박고, 작성자 프로필을 조인해 왕복을 줄입니다.
- `post_system_message()` — §2.10 RPC 여럿이 "system 메시지" 를 발행합니다. body 는 **이벤트 코드**(`joined`/`left`/`kicked`/`code_auto_revoked`)이고 사람이 읽는 문장은 렌더러가 만듭니다. 서버에 한국어를 박으면 문구 수정이 마이그레이션이 됩니다.
- `remove_friend()`, `blocked_ids()`, `realtime_group_id()` — 각각 친구 끊기, 렌더러 필터, realtime 토픽 파싱용.
- `leave_group()` 의 **오너 승계** — 문서에 없지만 오너가 나가면 그룹이 관리 불능이 됩니다. admin 우선 → 없으면 최고참 member, 아무도 없으면 그룹 소프트 삭제.

### ⑩ 문서가 덜 정한 것 — 여기서 정한 값

| 항목 | 정한 값 | 근거 |
|---|---|---|
| system 메시지 본문 형식 | 이벤트 코드 문자열 | 로컬라이즈·문구 수정을 마이그레이션에서 분리 |
| 메시지 편집 창 | 5분 (§2.7 언급, 값은 트리거에 고정) | |
| 그룹 소프트 삭제 시점 | 마지막 멤버 이탈 | §2.2 에 DELETE 정책이 없어 경로가 비어 있었음 |
| `blocks` 한도 | 60/일 | 문서에 없음. 차단 폭주를 막는 최소선 |
| `report_content` 한도 | 20/일 | 문서에 없음 |
| 보존 배치 상한 | 1회 20,000행 | 최초 정리에서 락을 오래 잡지 않게 |
| pg_cron 스케줄 | 매주 일 03:15 UTC (월 12:15 KST) | §6.2 "주 1회" |
| 초대 코드 정리 유예 | 만료/폐기 후 30일 | 문의 대응 여지 |
| `mark_read` 상한 | `least(요청 seq, 그룹의 last_msg_seq)` | 상한이 없으면 클라이언트 버그 하나로 이후 메시지가 영구히 "읽음"으로 묻힌다 |
| 실패 사유 노출 범위 | 코드 참여 실패는 전부 `invalid_code` | "만료됨" vs "없음"을 구분해 주면 그것만으로 코드 공간 탐색의 신호가 된다 |
| 잠금 순서 | 항상 `group_members` → `study_groups` | 메시지 INSERT 경로의 교착 방지. 새 코드도 이 순서를 지킬 것 |

---

## 9. 아직 없는 것 (의도적)

- **공유 태스크 보드** — §3.5 대로 P2 에서 만들지 않습니다. 스키마 스케치도 넣지 않았습니다(`sort_order` 대신 `rank text` 로 가야 하므로 지금 만들면 버릴 코드입니다).
- **타이핑 인디케이터** — §4.6. 인프라(private channel)는 깔려 있습니다.
- **모더레이션 큐** — §2.8. `reports` 는 접수만 하고 조회 경로가 없습니다.
- **파일/이미지 첨부** — §3.4 ①. Storage 를 쓰지 않으므로 남용 표면이 0입니다.

---

## 9. 실제 적용 기록 (2026-08-06)

`supabase db push`로 **원격 프로젝트 `ukacrkcwiqafwpppshxb`(bandal, ap-northeast-2 서울, PG 17.6)** 에 적용 완료.

| 항목 | 결과 |
|---|---|
| 마이그레이션 | **10/10 적용** (0001~0009 + 0010 pg_cron 재시도) |
| 테이블 | 10개 — blocks, friendships, group_invites, group_members, invite_codes, messages, profiles, rate_events, reports, study_groups |
| RLS 활성화 | **10/10 테이블** |
| RLS 정책 | 15개 (public) + **2개 (realtime.messages — 실시간 수신/발신 인가)** |
| 함수 | 53개 (RPC + SECURITY DEFINER 헬퍼) |
| 트리거 | 9개 · 인덱스 13개 |
| 익명 접근 차단 | ✅ 6개 테이블 전수 확인 — 전부 HTTP 401 `42501` (anon 롤에 grant 없음) |
| pg_cron | ❌ **미설치** — 아래 참조 |

### 남은 작업 1건 — pg_cron 활성화

`create extension pg_cron` 이 SQL 경로로는 걸리지 않았다(0009·0010 모두 가드에 걸려 NOTICE 후 통과).
**대시보드 → Database → Extensions → `pg_cron` 검색 → 활성화** 한 뒤 아래 한 줄을 SQL 에디터에서 실행하면 된다:

```sql
select cron.schedule('bandal-retention', '15 3 * * 0',
                     $j$ select public.run_retention(); $j$);
```

안 켜도 지금은 문제없다(데이터가 없다). 다만 §6.2대로 **무료 티어의 병목은 DB 500MB**이고
하루 13,000건 페이스면 약 60일에 포화하므로, 실사용 전에는 켜야 한다.
외부 스케줄러(GitHub Actions 주 1회 `select public.run_retention();`)로 대체해도 된다.

### 아직 검증하지 못한 것

`tests/rls_verification.sql` 38행 게이트는 **실제 로그인 계정 2개의 uuid가 필요**하다.
아직 가입한 사용자가 없어 실행하지 못했다. OAuth 로그인이 동작한 뒤 계정 2개를 만들고
파일 상단 두 줄을 치환해 실행할 것. 특히 **§6.3 실시간 스모크**(다른 계정 메시지가 3초 내 도착)는
스텁 검증으로 대체 불가능한 유일한 경로다.
