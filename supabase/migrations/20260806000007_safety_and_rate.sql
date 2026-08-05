-- ============================================================================
-- [C9] Bandal Phase 2 — 0007_safety_and_rate.sql   (§2.8 / §2.9 / §6.4)
--
-- 만드는 것:
--   * public.blocks       — 차단. 차단 사실은 차단당한 쪽에 노출되지 않는다
--   * public.reports      — 신고. SELECT 정책이 **없다** = 누구도 못 읽는다
--   * public.rate_events  — 0001 헬퍼들이 쓰는 레이트리밋 원장
--   * RPC: block_user, unblock_user, report_content, blocked_ids
--
-- 의존: 0001(check_rate 가 rate_events 를 쓴다), 0002, 0003, 0006
-- 이 파일에 의존: 0001 의 check_rate / try_rate / is_blocked_either_way 가
--                 여기 테이블을 참조한다. **0007 이 적용되기 전에는 어떤 RPC 도
--                 동작하지 않는다.** 반드시 0001~0009 를 전부 적용할 것.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. blocks (§2.8)
-- ---------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id),
  blocked_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

comment on table public.blocks is
  '§2.8 차단. SELECT 가 blocker 한정이라 "차단당한 사실"이 구조적으로 노출되지 않는다.';

-- ---------------------------------------------------------------------------
-- 2. reports (§2.8) — 스텁이지만 접수 경로는 실재한다
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  target_type text not null check (target_type in ('message','profile','group')),
  target_id   uuid not null,
  reason      text not null check (char_length(reason) <= 500),
  snapshot    jsonb,          -- 신고 시점 본문 사본 (삭제 후에도 트리아지 가능)
  created_at  timestamptz not null default now()
);

create index if not exists reports_created_idx on public.reports (created_at desc);

comment on table public.reports is
  '§2.8 신고. INSERT 정책 하나만 존재한다 — SELECT/UPDATE/DELETE 정책이 없어 누구도 읽지 못한다.';

-- ---------------------------------------------------------------------------
-- 3. rate_events (§2.9)
-- ---------------------------------------------------------------------------
-- ⚠ 설계 문서 대비 추가 컬럼: scope
--   §2.9 원안은 (user_id, action, created_at) 3컬럼이다. 그런데 §6.1 에는
--   "invite_by_nickname 10/시간/**그룹**", "같은 그룹 가입 30/시간/**그룹**" 처럼
--   그룹 단위 한도가 있다. 이걸 action 문자열에 group_id 를 이어붙여 인코딩하면
--   인덱스가 고르지 않고 정리 쿼리도 지저분해진다. scope 컬럼 하나가 정직하다.
create table if not exists public.rate_events (
  user_id    uuid not null references public.profiles(id),
  action     text not null,
  scope      text,            -- 보통 group_id::text. 전역 한도면 NULL
  created_at timestamptz not null default now()
);

create index if not exists rate_events_lookup_idx
  on public.rate_events (user_id, action, created_at desc);

-- 스코프(그룹) 단위 집계용. check_rate_global() 이 이 인덱스를 탄다.
create index if not exists rate_events_scope_idx
  on public.rate_events (action, scope, created_at desc) where scope is not null;

-- pg_cron 정리(0009)가 이 인덱스를 탄다.
create index if not exists rate_events_created_idx on public.rate_events (created_at);

comment on table public.rate_events is
  '§2.9 레이트리밋 원장. 0001 의 try_rate/check_rate 만 쓴다. pg_cron 이 2일 초과분을 지운다.';

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.blocks      enable row level security;
alter table public.reports     enable row level security;
alter table public.rate_events enable row level security;

-- blocks — 전부 blocker_id = auth.uid(). 내가 건 차단만 보이고 만질 수 있다.
drop policy if exists blocks_select_own on public.blocks;
create policy blocks_select_own on public.blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists blocks_insert_own on public.blocks;
create policy blocks_insert_own on public.blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()) and blocked_id <> (select auth.uid()));

drop policy if exists blocks_delete_own on public.blocks;
create policy blocks_delete_own on public.blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- reports — ★ INSERT 정책 하나만. SELECT/UPDATE/DELETE 정책이 없으므로 접수 후에는
--   신고자 본인조차 읽을 수 없다. 신고자 보호와 남용 억제를 동시에 만든다.
--   트리아지는 대시보드에서 수동으로 한다(§2.8).
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()));

-- rate_events — ★ 정책을 하나도 만들지 않는다. SECURITY DEFINER 헬퍼만 닿는다.
--   클라이언트가 읽을 수 있으면 "남은 시도 횟수"가 노출되고, 쓸 수 있으면
--   레이트리밋 자체가 무의미해진다.

-- ---------------------------------------------------------------------------
-- 5. 권한
-- ---------------------------------------------------------------------------
revoke all on public.blocks      from public, anon, authenticated;
revoke all on public.reports     from public, anon, authenticated;
revoke all on public.rate_events from public, anon, authenticated;

grant select, insert, delete on public.blocks to authenticated;
grant insert on public.reports to authenticated;
-- rate_events 에는 authenticated 권한을 일절 주지 않는다.

-- ---------------------------------------------------------------------------
-- 6. RPC
-- ---------------------------------------------------------------------------

-- block_user / unblock_user — 정책만으로도 되지만, 차단 시 대기 중인 친구요청·
-- 그룹초대를 함께 정리해야 하므로 RPC 를 둔다(§6.4).
create or replace function public.block_user(p_user_id uuid)
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
  if p_user_id = v_uid then
    raise exception 'cannot_block_self' using errcode = 'P0001';
  end if;

  perform public.check_rate('block_user', 60, interval '1 day');

  insert into public.blocks (blocker_id, blocked_id)
  values (v_uid, p_user_id)
  on conflict do nothing;

  -- 친구 관계 / pending 요청 정리
  delete from public.friendships
   where user_a = least(v_uid, p_user_id) and user_b = greatest(v_uid, p_user_id);

  -- 서로에게 보낸 pending 그룹 초대 만료 처리
  update public.group_invites
     set status = 'expired', responded_at = now()
   where status = 'pending'
     and ((invitee_id = v_uid and inviter_id = p_user_id)
       or (invitee_id = p_user_id and inviter_id = v_uid));

  -- ★ 그룹에서 강제 분리하지 않는다(P3). 렌더러가 해당 작성자 메시지를
  --   "차단한 사용자의 메시지" 접힌 행으로 대체한다.
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
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
  delete from public.blocks where blocker_id = v_uid and blocked_id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- blocked_ids() — 렌더러 필터용. 내가 차단한 사람 목록만(내가 차단당한 목록 아님).
create or replace function public.blocked_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select b.blocked_id from public.blocks b where b.blocker_id = auth.uid();
$$;

-- report_content(target_type, target_id, reason)
-- ★ snapshot 은 서버가 만든다. 클라이언트가 보낸 사본을 그대로 저장하면
--   트리아지 근거가 신고자에 의해 위조될 수 있다.
create or replace function public.report_content(
  p_target_type text,
  p_target_id   uuid,
  p_reason      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_snap jsonb;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_target_type not in ('message','profile','group') then
    raise exception 'invalid_target_type' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(p_reason) = 0 or char_length(p_reason) > 500 then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  perform public.check_rate('report_content', 20, interval '1 day');

  if p_target_type = 'message' then
    -- 신고자가 실제로 볼 수 있는 메시지여야 한다
    select jsonb_build_object(
             'messageId', m.id, 'groupId', m.group_id, 'seq', m.seq,
             'authorId', m.author_id, 'kind', m.kind, 'body', m.body,
             'createdAt', m.created_at, 'deletedAt', m.deleted_at
           )
      into v_snap
      from public.messages m
     where m.id = p_target_id
       and public.is_group_member(m.group_id, v_uid);

  elsif p_target_type = 'profile' then
    select jsonb_build_object(
             'userId', p.id, 'nickname', p.nickname,
             'avatarColor', p.avatar_color, 'avatarEmoji', p.avatar_emoji
           )
      into v_snap
      from public.profiles p where p.id = p_target_id;

  else
    select jsonb_build_object('groupId', g.id, 'name', g.name, 'memberCount', g.member_count)
      into v_snap
      from public.study_groups g
     where g.id = p_target_id
       and public.is_group_member(g.id, v_uid);
  end if;

  if v_snap is null then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;

  insert into public.reports (reporter_id, target_type, target_id, reason, snapshot)
  values (v_uid, p_target_type, p_target_id, p_reason, v_snap)
  returning id into v_id;

  -- ★ 신고 id 를 돌려주되 그 이후 조회 경로는 없다(정책 부재).
  return jsonb_build_object('ok', true, 'reportId', v_id);
end;
$$;

comment on function public.report_content(text, uuid, text) is
  '§2.8 신고 접수. snapshot 은 서버가 생성한다. 접수 후 조회 경로는 존재하지 않는다.';

-- ---------------------------------------------------------------------------
-- 7. RPC 권한
-- ---------------------------------------------------------------------------
revoke execute on function public.block_user(uuid)                   from public, anon;
revoke execute on function public.unblock_user(uuid)                 from public, anon;
revoke execute on function public.blocked_ids()                      from public, anon;
revoke execute on function public.report_content(text, uuid, text)   from public, anon;

grant execute on function public.block_user(uuid)                    to authenticated;
grant execute on function public.unblock_user(uuid)                  to authenticated;
grant execute on function public.blocked_ids()                       to authenticated;
grant execute on function public.report_content(text, uuid, text)    to authenticated;

reset check_function_bodies;
