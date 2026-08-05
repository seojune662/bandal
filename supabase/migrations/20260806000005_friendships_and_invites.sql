-- ============================================================================
-- [C9] Bandal Phase 2 — 0005_friendships_and_invites.sql   (§2.5 / §2.6 / §5.3)
--
-- 만드는 것:
--   * public.friendships     — user_a < user_b 정규 페어 (방향은 requested_by 가 기억)
--   * public.group_invites   — 닉네임 직접 초대
--   * RLS 전수
--   * RPC: send_friend_request, respond_friend_request, remove_friend,
--          invite_by_nickname, respond_group_invite
--
-- 의존: 0001(is_friend, is_blocked_either_way, check_rate), 0002, 0003
-- 이 파일에 의존: 없음 (0002 profiles_select 정책이 is_friend 를 호출하므로
--                    friendships 테이블이 없으면 profiles SELECT 가 런타임 실패한다.
--                    → 0002 만 적용한 상태로 방치하지 말 것)
--
-- ★ 친구여야 초대할 수 있는 게 아니다(§2.6). 닉네임만 알면 바로 초대가 간다.
--   친구 관계는 "예전에 같이 한 사람"을 자동완성 상단에 띄우는 캐시일 뿐이고,
--   그게 §5.3 의 "재초대 2스텝, 타이핑 0"을 만든다.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. friendships (§2.5)
-- ---------------------------------------------------------------------------
-- ★ user_a < user_b 정규화로 A→B / B→A 중복 행이 원천 차단된다.
-- ★ status 에 'blocked' 를 섞지 않는다 — 누가 누구를 차단했는지 구분이 안 된다.
--   차단은 별도 blocks 테이블(0007).
create table if not exists public.friendships (
  user_a       uuid not null references public.profiles(id),
  user_b       uuid not null references public.profiles(id),
  requested_by uuid not null references public.profiles(id),
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint canonical_pair check (user_a < user_b)
);

create index if not exists friendships_user_b_idx on public.friendships (user_b, status);

comment on table public.friendships is
  '§2.5 친구 관계. 정규 페어(user_a < user_b) 저장, 방향은 requested_by 가 기억한다.';

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. group_invites (§2.6)
-- ---------------------------------------------------------------------------
create table if not exists public.group_invites (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.study_groups(id),
  invitee_id   uuid not null references public.profiles(id),
  inviter_id   uuid not null references public.profiles(id),
  status       text not null default 'pending'
                 check (status in ('pending','accepted','declined','expired')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);

-- 같은 사람에게 같은 그룹 초대가 두 번 pending 으로 쌓이지 않는다.
create unique index if not exists group_invites_pending_uq
  on public.group_invites (group_id, invitee_id) where status = 'pending';

create index if not exists group_invites_invitee_idx
  on public.group_invites (invitee_id) where status = 'pending';

comment on table public.group_invites is
  '§2.6 닉네임 직접 초대. 친구 관계는 전제가 아니다.';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.friendships    enable row level security;
alter table public.group_invites  enable row level security;

-- friendships SELECT — 당사자 두 명만. 제3자에게는 관계 자체가 보이지 않는다.
drop policy if exists friendships_select_party on public.friendships;
create policy friendships_select_party on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- INSERT / UPDATE / DELETE 정책 없음 — 전부 RPC 전용.
-- 직접 INSERT 를 열면 차단 검사와 레이트리밋을 건너뛴 친구요청 스팸이 가능해진다.

-- group_invites SELECT — 받은 사람 본인, 또는 그 그룹의 멤버(관리 화면용).
-- ★ is_group_member 헬퍼만 쓴다 → group_members 정책을 다시 타지 않는다(재귀 없음).
drop policy if exists group_invites_select_scope on public.group_invites;
create policy group_invites_select_scope on public.group_invites
  for select to authenticated
  using (
    invitee_id = (select auth.uid())
    or public.is_group_member(group_id, (select auth.uid()))
  );

-- INSERT / UPDATE / DELETE 정책 없음 — invite_by_nickname / respond_group_invite 전용.

revoke all on public.friendships   from public, anon, authenticated;
revoke all on public.group_invites from public, anon, authenticated;

grant select on public.friendships   to authenticated;
grant select on public.group_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC: 친구
-- ---------------------------------------------------------------------------
-- send_friend_request(nickname) — 완전일치로 상대를 찾아 pending 을 만든다. 20/일.
-- ★ 상대가 이미 나에게 요청을 보내 둔 상태면 곧바로 accepted 로 승격한다
--   (서로 요청 = 상호 수락. 한 스텝을 없앤다)
create or replace function public.send_friend_request(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid;
  v_a      uuid;
  v_b      uuid;
  v_row    public.friendships%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  perform public.check_rate('send_friend_request', 20, interval '1 day');

  select p.id into v_target
    from public.profiles p
   where p.nickname_key = lower(coalesce(p_nickname, ''))
     and p.deleted_at is null;

  -- ★ 없는 사람과 차단한 사람을 구분해 주지 않는다(§6.4 차단 사실 비노출).
  if not found or v_target = v_uid or public.is_blocked_either_way(v_uid, v_target) then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;

  v_a := least(v_uid, v_target);
  v_b := greatest(v_uid, v_target);

  select * into v_row from public.friendships f
   where f.user_a = v_a and f.user_b = v_b
   for update;

  if found then
    if v_row.status = 'accepted' then
      return jsonb_build_object('status', 'accepted', 'userId', v_target);
    end if;
    -- 상대가 먼저 보낸 pending 이면 이건 사실상 '수락'이다
    if v_row.requested_by <> v_uid then
      update public.friendships set status = 'accepted'
       where user_a = v_a and user_b = v_b;
      return jsonb_build_object('status', 'accepted', 'userId', v_target);
    end if;
    return jsonb_build_object('status', 'pending', 'userId', v_target);
  end if;

  insert into public.friendships (user_a, user_b, requested_by)
  values (v_a, v_b, v_uid);

  return jsonb_build_object('status', 'pending', 'userId', v_target);
end;
$$;

-- respond_friend_request(requester_id, accept)
create or replace function public.respond_friend_request(
  p_requester_id uuid,
  p_accept       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_a   uuid;
  v_b   uuid;
  v_row public.friendships%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  v_a := least(v_uid, p_requester_id);
  v_b := greatest(v_uid, p_requester_id);

  select * into v_row from public.friendships f
   where f.user_a = v_a and f.user_b = v_b and f.status = 'pending'
   for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  -- 내가 보낸 요청을 내가 수락할 수는 없다
  if v_row.requested_by = v_uid then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_accept then
    update public.friendships set status = 'accepted'
     where user_a = v_a and user_b = v_b;
    return jsonb_build_object('status', 'accepted');
  end if;

  -- 거절은 행을 지운다. "거절당함"이라는 상태를 남기지 않는다(재요청 가능).
  delete from public.friendships where user_a = v_a and user_b = v_b;
  return jsonb_build_object('status', 'declined');
end;
$$;

-- remove_friend(user_id) — 친구 끊기. 양쪽 모두 행 삭제(정규 페어라 1행).
create or replace function public.remove_friend(p_user_id uuid)
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

  delete from public.friendships
   where user_a = least(v_uid, p_user_id)
     and user_b = greatest(v_uid, p_user_id);

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC: 그룹 초대 (§5.3)
-- ---------------------------------------------------------------------------
-- invite_by_nickname(group_id, nickname)
--   멤버 확인 → 완전일치 → 차단 검사 → pending invite
--   한도: 20/일/사용자, 10/시간/그룹
create or replace function public.invite_by_nickname(p_group_id uuid, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- ★ 관리자가 아니라 "멤버"면 초대할 수 있다. 조별과제에서 초대권을 관리자로
  --   좁히면 §5.3 의 속도가 죽는다.
  if not public.is_group_member(p_group_id, v_uid) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  perform public.check_rate('invite_by_nickname',   20, interval '1 day');
  perform public.check_rate('invite_by_nickname_g', 10, interval '1 hour', p_group_id::text);

  select p.id into v_target
    from public.profiles p
   where p.nickname_key = lower(coalesce(p_nickname, ''))
     and p.deleted_at is null;

  if not found or public.is_blocked_either_way(v_uid, v_target) then
    raise exception 'profile_not_found' using errcode = 'P0001';
  end if;

  if public.is_group_member(p_group_id, v_target) then
    return jsonb_build_object('status', 'already_member', 'userId', v_target);
  end if;

  insert into public.group_invites (group_id, invitee_id, inviter_id)
  values (p_group_id, v_target, v_uid)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('status', 'already_pending', 'userId', v_target);
  end if;
  return jsonb_build_object('status', 'pending', 'inviteId', v_id, 'userId', v_target);
end;
$$;

-- respond_group_invite(invite_id, accept) — 수락 시 멤버십 생성(§2.10)
create or replace function public.respond_group_invite(p_invite_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_inv   public.group_invites%rowtype;
  v_group public.study_groups%rowtype;
  v_prev  public.group_members%rowtype;
  v_had   boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_inv from public.group_invites i
   where i.id = p_invite_id and i.invitee_id = v_uid and i.status = 'pending'
   for update;
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0001';
  end if;

  if not p_accept then
    update public.group_invites set status = 'declined', responded_at = now()
     where id = p_invite_id;
    return jsonb_build_object('status', 'declined');
  end if;

  select * into v_group from public.study_groups g where g.id = v_inv.group_id;
  if not found or v_group.deleted_at is not null then
    update public.group_invites set status = 'expired', responded_at = now()
     where id = p_invite_id;
    raise exception 'group_not_found' using errcode = 'P0001';
  end if;

  select * into v_prev from public.group_members m
   where m.group_id = v_group.id and m.user_id = v_uid;
  v_had := found;

  if v_had then
    update public.group_members
       set left_at = null, joined_at = now(),
           msg_tokens = 20, tokens_at = now()
     where group_id = v_group.id and user_id = v_uid;
  else
    insert into public.group_members (group_id, user_id, role)
    values (v_group.id, v_uid, 'member');
  end if;

  update public.group_invites set status = 'accepted', responded_at = now()
   where id = p_invite_id;

  perform public.post_system_message(v_group.id, v_uid, 'joined');

  return jsonb_build_object(
    'status', 'accepted',
    'groupId', v_group.id,
    'name',    v_group.name,
    'color',   v_group.color,
    'lastMsgSeq', v_group.last_msg_seq
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 권한
-- ---------------------------------------------------------------------------
revoke execute on function public.send_friend_request(text)             from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.remove_friend(uuid)                   from public, anon;
revoke execute on function public.invite_by_nickname(uuid, text)        from public, anon;
revoke execute on function public.respond_group_invite(uuid, boolean)   from public, anon;

grant execute on function public.send_friend_request(text)              to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean)  to authenticated;
grant execute on function public.remove_friend(uuid)                    to authenticated;
grant execute on function public.invite_by_nickname(uuid, text)         to authenticated;
grant execute on function public.respond_group_invite(uuid, boolean)    to authenticated;

reset check_function_bodies;
