-- ============================================================================
-- [C9] Bandal Phase 2 — 0004_invite_codes.sql   (§2.4 / §5.2 / §6.1)
--
-- 만드는 것:
--   * public.invite_codes            — 6자 Crockford Base32, 그룹당 살아있는 코드 1개
--   * public.mint_invite_code()      — 내부 전용(발급 + 충돌 재시도 ≤5)
--   * RPC: regenerate_invite_code, current_invite_code, join_group_with_code
--
-- 의존: 0001(new_invite_code, normalize_invite_code, check_rate), 0002, 0003
-- 이 파일에 의존: 0003.create_group() 이 mint_invite_code() 를 호출한다
--
-- ⚠ join_group_with_code() 는 0006 의 post_system_message() 를 호출한다(런타임 바인딩).
--
-- ★★ 이 파일의 가장 중요한 성질 ★★
--   invite_codes 에는 **SELECT 정책이 하나도 없고 authenticated 에게 테이블 권한도
--   주지 않는다.** 코드 → 그룹 해석은 오직 join_group_with_code() 내부에서만
--   일어난다. 클라이언트가 code 로 조회할 수 있으면 레이트리밋을 걸 지점이
--   사라지고 32^6 공간을 오프라인으로 훑을 수 있게 된다(§2.4).
--   관리자가 자기 그룹 코드를 보는 경로는 current_invite_code() RPC 다.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. 테이블 (§2.4)
-- ---------------------------------------------------------------------------
create table if not exists public.invite_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[0-9A-HJ-KM-NP-TV-Z]{6}$'),
  group_id    uuid not null references public.study_groups(id),
  created_by  uuid not null references public.profiles(id),
  expires_at  timestamptz not null,
  max_uses    int  not null default 0 check (max_uses >= 0),  -- 0 = 무제한
  use_count   int  not null default 0 check (use_count >= 0),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- ★ 그룹당 살아있는 코드는 항상 1개(§2.4). "코드 새로 만들기"가 사실상 초대 잠금
--   장치가 된다. 만료 조건(now())은 IMMUTABLE 이 아니라 부분 인덱스에 못 넣으므로
--   revoked_at 만으로 판정하고, mint_invite_code() 가 항상 먼저 revoke 한다.
create unique index if not exists invite_codes_live_per_group_uq
  on public.invite_codes (group_id) where revoked_at is null;

create index if not exists invite_codes_expiry_idx
  on public.invite_codes (expires_at) where revoked_at is null;

comment on table public.invite_codes is
  '§2.4 6자 Crockford Base32 초대 코드. code 로 SELECT 하는 경로는 존재하지 않는다.';

-- ---------------------------------------------------------------------------
-- 2. RLS — 정책을 "하나도" 만들지 않는다
-- ---------------------------------------------------------------------------
-- RLS 를 켜고 정책이 없으면 authenticated 는 어떤 행도 읽/쓰지 못한다.
-- SECURITY DEFINER RPC 만 이 테이블에 닿는다.
alter table public.invite_codes enable row level security;

drop policy if exists invite_codes_no_direct_select on public.invite_codes;
-- (의도적으로 비어 있음 — 정책 부재가 곧 정책이다)

revoke all on public.invite_codes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. mint_invite_code — 내부 전용 발급기
-- ---------------------------------------------------------------------------
-- 기존 살아있는 코드를 revoke 하고 새 코드를 발급한다.
-- ★ 충돌 처리: unique(code) 위반을 잡아 최대 5회 재시도한다. 동시 활성 1만 개
--   기준 1회 충돌 확률 ≈ 9.3e-6 이므로 5회 실패 확률은 사실상 0이다(§2.4).
-- ★ authenticated 에게 EXECUTE 를 주지 않는다. create_group / regenerate 만 부른다.
create or replace function public.mint_invite_code(
  p_group_id uuid,
  p_max_uses int      default 0,
  p_ttl      interval default interval '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
  v_row  public.invite_codes%rowtype;
  i      int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_max_uses < 0 then
    raise exception 'invalid_max_uses' using errcode = 'P0001';
  end if;
  if p_ttl < interval '5 minutes' or p_ttl > interval '90 days' then
    raise exception 'invalid_ttl' using errcode = 'P0001';
  end if;

  -- 살아있는 코드는 그룹당 1개. 새로 만들면 이전 코드는 즉시 죽는다.
  update public.invite_codes
     set revoked_at = now()
   where group_id = p_group_id and revoked_at is null;

  for i in 1..5 loop
    v_code := public.new_invite_code();
    begin
      insert into public.invite_codes (code, group_id, created_by, expires_at, max_uses)
      values (v_code, p_group_id, v_uid, now() + p_ttl, p_max_uses)
      returning * into v_row;

      return jsonb_build_object(
        'code',      v_row.code,
        'groupId',   v_row.group_id,
        'expiresAt', v_row.expires_at,
        'maxUses',   v_row.max_uses,
        'useCount',  v_row.use_count
      );
    exception when unique_violation then
      null;   -- 코드 충돌 → 다시 뽑는다
    end;
  end loop;

  raise exception 'invite_code_collision' using errcode = 'P0001';
end;
$$;

comment on function public.mint_invite_code(uuid, int, interval) is
  '§2.4 내부 전용 코드 발급기. 기존 코드 revoke + 충돌 재시도 5회. RPC 만 호출한다.';

-- ---------------------------------------------------------------------------
-- 4. RPC: regenerate_invite_code (관리자, 10/시간)
-- ---------------------------------------------------------------------------
create or replace function public.regenerate_invite_code(
  p_group_id uuid,
  p_max_uses int      default 0,
  p_ttl      interval default interval '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_group_admin(p_group_id, v_uid) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  perform public.check_rate('regenerate_invite_code', 10, interval '1 hour', p_group_id::text);
  return public.mint_invite_code(p_group_id, p_max_uses, p_ttl);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC: current_invite_code (관리자만) — §4.8 'groups:currentCode'
-- ---------------------------------------------------------------------------
-- 테이블 SELECT 를 열지 않고도 관리자가 자기 그룹 코드를 볼 수 있게 하는 유일한 문.
-- 반환은 항상 "이 그룹의 코드"이지 "이 코드의 그룹"이 아니다 → 역방향 조회 불가.
create or replace function public.current_invite_code(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.invite_codes%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_group_admin(p_group_id, v_uid) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.invite_codes c
   where c.group_id = p_group_id
     and c.revoked_at is null
     and c.expires_at > now()
   limit 1;

  if not found then
    return null;   -- 렌더러는 "코드 새로 만들기"를 띄운다
  end if;

  return jsonb_build_object(
    'code',      v_row.code,
    'groupId',   v_row.group_id,
    'expiresAt', v_row.expires_at,
    'maxUses',   v_row.max_uses,
    'useCount',  v_row.use_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RPC: join_group_with_code — ★ 레이트리밋 핵심 지점 (§6.1)
-- ---------------------------------------------------------------------------
-- 순서가 중요하다:
--   ① 연속 실패 잠금 확인  → ② 시도 카운트(5회/5분, 20회/시간)를 **조회 전에** 소모
--   → ③ 정규화·조회·검증 → ④ 그룹당 가입 폭주 검사 → ⑤ 멤버십 + system 메시지
--
-- ②를 조회보다 먼저 하는 이유: 존재하지 않는 코드로도 시도가 카운트돼야 한다.
-- 그래야 32^6 공간 탐색이 5회/5분으로 묶인다(§2.4 "기대 1회 적중까지 약 12년").
--
-- ★★ 이 RPC 만 예외를 던지지 않고 { ok:false, error } 를 **반환**한다 ★★
--   이유는 하나다: `raise` 는 트랜잭션을 롤백하고, 롤백되면 방금 기록한
--   rate_events 도 같이 사라져 **레이트리밋이 영원히 누적되지 않는다.**
--   거절을 정상 반환값으로 만들어야 시도 기록이 커밋된다. 0001 try_rate 주석 참고.
--   반환 계약:
--     { ok:true,  groupId, name, color, memberCount, lastMsgSeq, alreadyMember }
--     { ok:false, error:'invalid_code' }
--     { ok:false, error:'rate_limited', reason, retryAfter }   -- 초 단위
create or replace function public.join_group_with_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_code     text;
  v_row      public.invite_codes%rowtype;
  v_existing public.group_members%rowtype;
  v_rejoin   boolean := false;
  v_group    public.study_groups%rowtype;
  v_retry    int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- ① 연속 실패 10회 → 1시간 잠금 (§6.1)
  if public.count_rate_events('join_code_fail', interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited',
                              'reason', 'join_code_locked', 'retryAfter', 3600);
  end if;

  -- ② 시도 자체를 카운트한다. 조회보다 먼저다.
  v_retry := public.try_rate('join_group_with_code', 5, interval '5 minutes');
  if v_retry > 0 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited',
                              'reason', 'join_5m', 'retryAfter', v_retry);
  end if;

  v_retry := public.try_rate('join_group_with_code_h', 20, interval '1 hour');
  if v_retry > 0 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited',
                              'reason', 'join_1h', 'retryAfter', v_retry);
  end if;

  -- ③ 정규화 → 조회 → 검증
  -- ★ 실패 사유를 세분화하지 않는다. "만료됨" vs "없음"을 구분해 주면 그것만으로
  --   코드 공간 탐색의 신호가 된다. 전부 invalid_code 하나로 응답한다.
  v_code := public.normalize_invite_code(p_code);
  if v_code !~ '^[0-9A-HJ-KM-NP-TV-Z]{6}$' then
    perform public.record_rate_event('join_code_fail');
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select * into v_row
    from public.invite_codes c
   where c.code = v_code
   for update;

  if not found
     or v_row.revoked_at is not null
     or v_row.expires_at <= now()
     or (v_row.max_uses > 0 and v_row.use_count >= v_row.max_uses)
  then
    perform public.record_rate_event('join_code_fail');
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select * into v_group from public.study_groups g where g.id = v_row.group_id;
  if not found or v_group.deleted_at is not null then
    perform public.record_rate_event('join_code_fail');
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  -- 성공 경로 — 연속 실패 카운터 리셋
  perform public.clear_rate_events('join_code_fail');

  -- 이미 멤버면 멱등하게 성공 반환(딥링크/재클릭 대비)
  select * into v_existing
    from public.group_members m
   where m.group_id = v_group.id and m.user_id = v_uid;
  v_rejoin := found;

  if v_rejoin and v_existing.left_at is null then
    return jsonb_build_object(
      'ok', true, 'groupId', v_group.id, 'name', v_group.name, 'color', v_group.color,
      'memberCount', v_group.member_count, 'lastMsgSeq', v_group.last_msg_seq,
      'alreadyMember', true
    );
  end if;

  -- ④ 그룹당 가입 폭주: 30회/시간/그룹 초과면 코드를 자동 revoke 하고 거절(§6.1)
  if public.check_rate_global('join_group_ok', v_group.id::text, 30, interval '1 hour') then
    update public.invite_codes set revoked_at = now()
     where group_id = v_group.id and revoked_at is null;
    perform public.post_system_message(v_group.id, v_group.owner_id, 'code_auto_revoked');
    return jsonb_build_object('ok', false, 'error', 'rate_limited',
                              'reason', 'group_join_flood', 'retryAfter', 3600);
  end if;

  -- ⑤ 멤버십 + 사용 횟수 + system 메시지
  if v_rejoin then
    update public.group_members
       set left_at = null, joined_at = now(), role = 'member',
           msg_tokens = 20, tokens_at = now()
     where group_id = v_group.id and user_id = v_uid;
  else
    insert into public.group_members (group_id, user_id, role)
    values (v_group.id, v_uid, 'member');
  end if;

  update public.invite_codes set use_count = use_count + 1 where id = v_row.id;
  perform public.record_rate_event('join_group_ok', v_group.id::text);
  perform public.post_system_message(v_group.id, v_uid, 'joined');

  return jsonb_build_object(
    'ok',          true,
    'groupId',     v_group.id,
    'name',        v_group.name,
    'color',       v_group.color,
    'memberCount', v_group.member_count + 1,
    'lastMsgSeq',  v_group.last_msg_seq,
    'alreadyMember', false
  );
end;
$$;

comment on function public.join_group_with_code(text) is
  '§2.10/§6.1 코드 참여. 5회/5분·20회/시간·연속실패 10회→1시간 잠금. 거절은 raise 가 아니라 {ok:false} 반환(레이트리밋 기록을 커밋시키기 위해).';

-- ---------------------------------------------------------------------------
-- 7. 권한
-- ---------------------------------------------------------------------------
-- ★ mint_invite_code 는 authenticated 에게 주지 않는다(RPC 내부 전용).
revoke execute on function public.mint_invite_code(uuid, int, interval)        from public, anon, authenticated;
revoke execute on function public.regenerate_invite_code(uuid, int, interval)  from public, anon;
revoke execute on function public.current_invite_code(uuid)                    from public, anon;
revoke execute on function public.join_group_with_code(text)                   from public, anon;

grant execute on function public.regenerate_invite_code(uuid, int, interval)   to authenticated;
grant execute on function public.current_invite_code(uuid)                     to authenticated;
grant execute on function public.join_group_with_code(text)                    to authenticated;

reset check_function_bodies;
