-- ============================================================================
-- [C9] Bandal Phase 2 — 0001_extensions_and_helpers.sql
--
-- 만드는 것:
--   * extensions 스키마 정규화 + pgcrypto (gen_random_bytes)
--   * public.set_updated_at()            — updated_at 자동 갱신 트리거 함수
--   * public.is_group_member()           — ★ RLS 재귀 차단 헬퍼 (§2.0)
--   * public.is_group_admin()            — ★ RLS 재귀 차단 헬퍼 (§2.0)
--   * public.shares_group_with()         — 프로필 노출 범위 헬퍼
--   * public.is_friend()                 — 프로필 노출 범위 헬퍼
--   * public.is_blocked_either_way()     — 차단 검사 헬퍼 (§6.4)
--   * public.check_rate() / check_rate_global()  — 레이트리밋 헬퍼 (§6.1)
--   * public.normalize_invite_code()     — 입력 정규화 (§5.2)
--   * public.new_invite_code()           — Crockford Base32 6자 생성 (§2.4)
--
-- 의존하는 것: 없음 (가장 먼저 적용)
-- 이 파일에 의존하는 것: 0002 ~ 0009 전부
--
-- ⚠ 전방 참조(forward reference)에 대하여
--   헬퍼들은 아직 존재하지 않는 테이블(group_members, friendships, blocks,
--   rate_events …)을 참조한다. `language sql` 함수는 생성 시점에 본문이 파싱·
--   검증되므로 이 파일 맨 위에서 check_function_bodies 를 끈다. 마이그레이션을
--   0001→0009 순서로 전부 적용하면 런타임에는 모든 참조가 해소된다.
--   ⇒ 0001만 단독으로 적용한 뒤 헬퍼를 호출하면 당연히 실패한다. 전부 적용할 것.
--
-- ⚠ 모든 SECURITY DEFINER 함수는 `set search_path = ''` 이다.
--   따라서 본문의 모든 식별자는 스키마 수식(public.x, auth.uid(), extensions.y)이
--   필수다. pg_catalog 만 암묵적으로 남으므로 gen_random_uuid() 는 수식 없이 동작.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. 확장 (extensions)
-- ---------------------------------------------------------------------------
-- Supabase 는 확장을 `extensions` 스키마에 둔다. 로컬/셀프호스트에서 public 에
-- 설치돼 있을 수 있으므로 위치를 정규화한다. 아래 코드 전체가
-- `extensions.gen_random_bytes` 를 수식해서 부르기 때문에 이 정규화가 필요하다.
create schema if not exists extensions;

do $$
declare
  v_nsp text;
begin
  select n.nspname
    into v_nsp
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  if v_nsp is null then
    execute 'create extension pgcrypto with schema extensions';
    raise notice '[0001] pgcrypto 를 extensions 스키마에 설치했습니다.';
  elsif v_nsp <> 'extensions' then
    execute 'alter extension pgcrypto set schema extensions';
    raise notice '[0001] pgcrypto 를 % → extensions 로 이동했습니다.', v_nsp;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. updated_at 트리거 함수
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (기본). 권한 상승이 필요 없는 순수 값 보정이다.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE 트리거: updated_at 을 now() 로 강제한다.';

-- ---------------------------------------------------------------------------
-- 3. ★ RLS 재귀 차단 헬퍼 (§2.0) — 가장 중요한 부분
-- ---------------------------------------------------------------------------
-- study_groups 정책이 group_members 를 직접 참조하고 group_members 정책이
-- study_groups 를 직접 참조하면 RLS 무한 재귀(42P17)로 전 쿼리가 죽는다.
-- SECURITY DEFINER 함수 안에서의 조회는 호출자의 RLS 를 타지 않으므로 고리가
-- 끊긴다. **모든 그룹 스코프 정책은 아래 함수만 호출한다.**

create or replace function public.is_group_member(gid uuid, uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.group_members m
     where m.group_id = gid
       and m.user_id  = uid
       and m.left_at is null
  );
$$;

comment on function public.is_group_member(uuid, uuid) is
  '§2.0 RLS 재귀 차단 헬퍼. uid 가 gid 그룹의 살아있는 멤버인가.';

create or replace function public.is_group_admin(gid uuid, uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.group_members m
     where m.group_id = gid
       and m.user_id  = uid
       and m.left_at is null
       and m.role in ('owner', 'admin')
  );
$$;

comment on function public.is_group_admin(uuid, uuid) is
  '§2.0 RLS 재귀 차단 헬퍼. uid 가 gid 그룹의 owner/admin 인가.';

create or replace function public.is_group_owner(gid uuid, uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.group_members m
     where m.group_id = gid
       and m.user_id  = uid
       and m.left_at is null
       and m.role = 'owner'
  );
$$;

comment on function public.is_group_owner(uuid, uuid) is
  '오너 전용 동작(그룹 삭제·오너 위임)에 쓰는 헬퍼. is_group_admin 의 좁은 형제.';

-- 두 사용자가 살아있는 그룹을 하나라도 공유하는가. profiles SELECT 정책 전용.
create or replace function public.shares_group_with(other_uid uuid, uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.group_members a
      join public.group_members b on b.group_id = a.group_id
     where a.user_id = uid
       and b.user_id = other_uid
       and a.left_at is null
       and b.left_at is null
  );
$$;

comment on function public.shares_group_with(uuid, uuid) is
  '§2.1 profiles SELECT 범위. 같은 그룹에 있는 사람만 프로필을 본다(디렉토리 스크래핑 차단).';

-- ---------------------------------------------------------------------------
-- 4. 친구 / 차단 헬퍼
-- ---------------------------------------------------------------------------
-- friendships 는 user_a < user_b 정규 페어 저장(§2.5)이므로 least/greatest 로 조회.
create or replace function public.is_friend(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.friendships f
     where f.user_a = least(a, b)
       and f.user_b = greatest(a, b)
       and f.status = 'accepted'
  );
$$;

comment on function public.is_friend(uuid, uuid) is
  '§2.5 수락된 친구 관계인가. 인자 순서 무관(정규 페어로 정렬해 조회).';

-- 어느 방향이든 차단이 있으면 true. 초대·친구요청 RPC 가 이걸로 거절한다.
-- ★ 차단 "사실" 자체는 이 함수를 통해 노출되지 않는다 — boolean 만 돌려주고,
--   RPC 는 항상 동일한 일반 오류 메시지로 실패한다(누가 차단했는지 유추 불가).
create or replace function public.is_blocked_either_way(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.blocks bl
     where (bl.blocker_id = a and bl.blocked_id = b)
        or (bl.blocker_id = b and bl.blocked_id = a)
  );
$$;

comment on function public.is_blocked_either_way(uuid, uuid) is
  '§6.4 양방향 차단 검사. true 면 초대/친구요청/닉네임 검색이 거절된다.';

-- ---------------------------------------------------------------------------
-- 5. 레이트리밋 헬퍼 (§6.1 ② 진짜 방어선)
-- ---------------------------------------------------------------------------
-- 규약:
--   * p_scope 는 "그룹당" 같은 부분 스코프용. rate_events.scope 에 저장된다.
--   * 통과했을 때만 rate_events 에 1행 기록한다(거절 시에도 기록하면 증폭 공격).
--
-- ⚠⚠ 트랜잭션 롤백 함정 — 이 설계에서 가장 미묘한 지점이다.
--   RPC 가 `raise` 로 끝나면 그 트랜잭션 전체가 롤백되므로 **check_rate 가 방금
--   넣은 rate_events 행도 같이 사라진다.** 즉 "실패한 시도"는 절대 누적되지 않는다.
--   그래서 두 갈래로 나눈다:
--     * try_rate()   — raise 하지 않고 "남은 초"만 돌려준다. 실패 시도까지 세야 하는
--                      join_group_with_code() 가 이걸 쓰고, 거절도 예외가 아니라
--                      **정상 반환값**으로 표현해 트랜잭션을 커밋시킨다.
--     * check_rate() — 성공했을 때만 커밋되면 충분한 RPC(create_group, 초대,
--                      친구요청, 닉네임 검색 …)용 편의 래퍼. 초과 시 raise 한다.
--   메시지 전송의 토큰 버킷(0006)은 시간 기반 상태라 롤백돼도 정확하므로 raise 해도
--   문제가 없다 — 오히려 그래야 한다(§6.1).

-- 통과하면 0, 거절이면 "재시도까지 남은 초(≥1)"를 돌려준다. 절대 raise 하지 않는다.
create or replace function public.try_rate(
  p_action text,
  p_limit  int,
  p_window interval,
  p_scope  text default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_count  int;
  v_oldest timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select count(*), min(r.created_at)
    into v_count, v_oldest
    from public.rate_events r
   where r.user_id = v_uid
     and r.action  = p_action
     and r.scope   is not distinct from p_scope
     and r.created_at > now() - p_window;

  if v_count >= p_limit then
    return greatest(1, ceil(extract(epoch from (v_oldest + p_window - now())))::int);
  end if;

  insert into public.rate_events (user_id, action, scope) values (v_uid, p_action, p_scope);
  return 0;
end;
$$;

comment on function public.try_rate(text, int, interval, text) is
  '§6.1 raise 하지 않는 레이트리밋. 0=통과, 양수=재시도까지 남은 초. 실패 시도까지 세야 하는 경로 전용.';

-- 초과 시 errcode 'P0001' + message 'rate_limited' 로 raise 하는 래퍼.
-- DETAIL = action, HINT = 재시도까지 남은 초 → UI 카운트다운.
-- 메시지 전송 토큰 버킷(0006)과 errcode/message 를 일부러 통일했다:
-- 메인 프로세스는 sqlstate='P0001' AND message='rate_limited' 하나로 분기한다.
create or replace function public.check_rate(
  p_action text,
  p_limit  int,
  p_window interval,
  p_scope  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retry int := public.try_rate(p_action, p_limit, p_window, p_scope);
begin
  if v_retry > 0 then
    raise exception 'rate_limited'
      using errcode = 'P0001',
            detail  = p_action,
            hint    = v_retry::text;
  end if;
end;
$$;

comment on function public.check_rate(text, int, interval, text) is
  '§6.1 사용자별 레이트리밋. 초과 시 errcode P0001 / message rate_limited / hint=재시도까지 초.';

-- 사용자 무관, 스코프(주로 group_id) 단위 한도. "같은 그룹 가입 30회/시간/그룹" 용.
create or replace function public.check_rate_global(
  p_action text,
  p_scope  text,
  p_limit  int,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*)
    into v_count
    from public.rate_events r
   where r.action = p_action
     and r.scope  = p_scope
     and r.created_at > now() - p_window;

  return v_count >= p_limit;
end;
$$;

comment on function public.check_rate_global(text, text, int, interval) is
  '스코프(그룹) 단위 한도 초과 여부만 돌려준다. 호출자가 revoke 등 후속 조치를 결정.';

-- 실패 카운터 조회 전용(연속 실패 잠금 §6.1). 기록은 호출자가 record_rate_event 로.
create or replace function public.count_rate_events(
  p_action text,
  p_window interval,
  p_scope  text default null
)
returns int
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)::int
    from public.rate_events r
   where r.user_id = auth.uid()
     and r.action  = p_action
     and r.scope   is not distinct from p_scope
     and r.created_at > now() - p_window;
$$;

create or replace function public.record_rate_event(
  p_action text,
  p_scope  text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.rate_events (user_id, action, scope)
  select auth.uid(), p_action, p_scope
   where auth.uid() is not null;
$$;

create or replace function public.clear_rate_events(
  p_action text,
  p_scope  text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_events r
   where r.user_id = auth.uid()
     and r.action  = p_action
     and r.scope   is not distinct from p_scope;
$$;

comment on function public.clear_rate_events(text, text) is
  '성공 시 "연속 실패" 카운터를 리셋한다(join_group_with_code 성공 경로).';

-- ---------------------------------------------------------------------------
-- 6. 초대 코드 — Crockford Base32 (§2.4)
-- ---------------------------------------------------------------------------
-- 알파벳 32자: 0-9 A-Z 에서 혼동문자 I, L, O, U 제거.
--   0123456789 ABCDEFGH JK MN PQRST VWXYZ
-- 체크 제약 정규식 '^[0-9A-HJ-KM-NP-TV-Z]{6}$' 와 정확히 일치한다.

-- 입력 정규화(§5.2): 대문자화 → O→0, I/L→1 → 알파벳 외 문자 제거.
-- IMMUTABLE 이므로 인덱스/제약에서도 쓸 수 있다.
create or replace function public.normalize_invite_code(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           translate(upper(coalesce(raw, '')), 'OIL', '011'),
           '[^0-9A-HJ-KM-NP-TV-Z]', '', 'g'
         );
$$;

comment on function public.normalize_invite_code(text) is
  '§5.2 코드 입력 정규화: 대문자화 + O→0 + I/L→1 + 공백·하이픈 등 제거.';

-- 6자 코드 생성. ★ 모듈로 바이어스 없음:
--   균등분포 바이트의 하위 5비트(byte & 31)는 0..31 위에서 정확히 균등하다.
--   (`% 32` 가 아니라 비트마스크이므로 나머지 연산 편향이 원천적으로 없다)
create or replace function public.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(6);
  v_out   text := '';
  i       int;
begin
  for i in 0..5 loop
    v_out := v_out || substr(c_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_out;
end;
$$;

comment on function public.new_invite_code() is
  '§2.4 Crockford Base32 6자(32^6 ≈ 1.07e9). gen_random_bytes 하위 5비트 → 모듈로 바이어스 0.';

-- ---------------------------------------------------------------------------
-- 7. 권한 (§ "authenticated 는 정책이 요구하는 것만, anon 은 아무것도")
-- ---------------------------------------------------------------------------
-- ⚠⚠ Supabase 의 default privileges 함정 — 실제로 두 번 물린 지점이다.
--   Supabase 프로젝트에는
--     alter default privileges in schema public
--       grant all on functions to anon, authenticated, service_role;
--   이 걸려 있다. 즉 새로 만든 함수는 **authenticated 에게 직접(direct) EXECUTE 가
--   부여된 채로 태어난다.** `revoke … from public, anon` 만 하면 PUBLIC 경유 권한만
--   사라지고 authenticated 의 직접 권한은 그대로 남아, 내부 전용 함수를 클라이언트가
--   그냥 호출할 수 있다.
--   ⇒ 내부 전용 함수는 반드시 `from public, anon, authenticated` 로 회수한다.
--     공개할 함수는 회수 후 명시적으로 다시 grant 한다(의도를 코드에 남기기 위해).

-- (A) 내부 전용 — 어떤 클라이언트 롤도 호출할 수 없다
revoke execute on function public.set_updated_at()                             from public, anon, authenticated;
revoke execute on function public.is_blocked_either_way(uuid, uuid)            from public, anon, authenticated;
revoke execute on function public.try_rate(text, int, interval, text)          from public, anon, authenticated;
revoke execute on function public.check_rate(text, int, interval, text)        from public, anon, authenticated;
revoke execute on function public.check_rate_global(text, text, int, interval) from public, anon, authenticated;
revoke execute on function public.count_rate_events(text, interval, text)      from public, anon, authenticated;
revoke execute on function public.record_rate_event(text, text)                from public, anon, authenticated;
revoke execute on function public.clear_rate_events(text, text)                from public, anon, authenticated;
revoke execute on function public.new_invite_code()                            from public, anon, authenticated;

-- (B) 정책 평가·클라이언트 호출에 필요한 것 — 회수 후 authenticated 에만 재부여
revoke execute on function public.is_group_member(uuid, uuid)               from public, anon;
revoke execute on function public.is_group_admin(uuid, uuid)                from public, anon;
revoke execute on function public.is_group_owner(uuid, uuid)                from public, anon;
revoke execute on function public.shares_group_with(uuid, uuid)             from public, anon;
revoke execute on function public.is_friend(uuid, uuid)                     from public, anon;
revoke execute on function public.normalize_invite_code(text)               from public, anon;

grant execute on function public.is_group_member(uuid, uuid)       to authenticated;
grant execute on function public.is_group_admin(uuid, uuid)        to authenticated;
grant execute on function public.is_group_owner(uuid, uuid)        to authenticated;
grant execute on function public.shares_group_with(uuid, uuid)     to authenticated;
grant execute on function public.is_friend(uuid, uuid)             to authenticated;
grant execute on function public.normalize_invite_code(text)       to authenticated;

-- ★ 레이트리밋·코드생성 계열은 authenticated 에게 주지 않는다.
--   RPC(SECURITY DEFINER) 내부에서만 호출된다. 클라이언트가 직접 부를 수 있으면
--   check_rate 를 임의로 소모시키거나(다른 사용자 방해) 코드를 대량 생성할 수 있다.
-- ★ is_blocked_either_way 도 주지 않는다. "내가 차단당했는지"를 알 수 있게 되어
--   §6.4 "차단 사실은 상대에게 노출되지 않는다"가 깨진다.

reset check_function_bodies;
