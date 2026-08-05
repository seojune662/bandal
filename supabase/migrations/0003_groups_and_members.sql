-- ============================================================================
-- [C9] Bandal Phase 2 — 0003_groups_and_members.sql   (§2.2 / §2.3)
--
-- 만드는 것:
--   * public.study_groups     — course_id 가 없다는 점이 핵심(§2.2). 결합은 로컬에서.
--   * public.group_members    — 읽음 상태(last_read_seq)와 토큰 버킷을 여기 접는다
--   * member_count 유지 트리거
--   * study_groups / group_members RLS (헬퍼만 호출 → 재귀 없음)
--   * RPC: create_group, leave_group, kick_member, set_member_role,
--          mark_read, unread_counts
--     (그룹 이름/색 변경과 음소거는 RPC 없이 컬럼 단위 GRANT + RLS 로 처리한다 —
--      6절 참고. 왕복 1회로 끝나고 서버 검증이 필요 없는 값들이다)
--
-- 의존: 0001(헬퍼), 0002(profiles FK)
-- 이 파일에 의존: 0004(invite_codes.group_id), 0005, 0006(messages.group_id), 0008
--
-- ⚠ create_group() 은 0004 의 public.mint_invite_code() 를 호출한다.
--   plpgsql 은 런타임 바인딩이므로 이 파일은 단독으로 적용되지만,
--   create_group() 을 실제로 호출하려면 0004 까지 적용돼 있어야 한다.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. study_groups (§2.2)
-- ---------------------------------------------------------------------------
-- ★ course_id 컬럼이 없다. 과목은 각자 디스크의 폴더이고 경로·과목명은 사적
--   정보다. 과목↔그룹 결합은 전적으로 로컬 course_group_links 가 한다(§3.1).
--   원격은 당신의 폴더 경로도 과목명도 모른다.
create table if not exists public.study_groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 40),
  color         text not null default 'moon',
  owner_id      uuid not null references public.profiles(id),
  member_count  int  not null default 1,      -- 트리거 유지 (사이드바 N+1 회피)
  last_msg_seq  bigint not null default 0,    -- §4.3 그룹별 단조 시퀀스의 카운터
  last_msg_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

comment on table public.study_groups is
  '§2.2 스터디 그룹. course_id 없음 — 과목 결합은 로컬 전용(§3.1).';
comment on column public.study_groups.last_msg_seq is
  '§4.3 그룹별 단조 시퀀스 카운터. messages BEFORE INSERT 트리거가 +1 하고 그 값을 seq 로 쓴다.';

drop trigger if exists study_groups_set_updated_at on public.study_groups;
create trigger study_groups_set_updated_at
  before update on public.study_groups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. group_members (§2.3) — 읽음 상태를 여기 접는다
-- ---------------------------------------------------------------------------
-- ★ 별도 read_states 테이블을 만들지 않는다. 읽음 상태는 (그룹, 사용자)당 정확히
--   한 행이고 그건 이미 이 테이블이다. 안읽음 수 = messages.seq > last_read_seq.
create table if not exists public.group_members (
  group_id      uuid not null references public.study_groups(id),
  user_id       uuid not null references public.profiles(id),
  role          text not null default 'member' check (role in ('owner','admin','member')),
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  muted         boolean not null default false,
  last_read_seq bigint not null default 0,
  msg_tokens    real not null default 20,     -- §6.1 토큰 버킷 (용량 20)
  tokens_at     timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_live_idx
  on public.group_members (user_id) where left_at is null;

comment on table public.group_members is
  '§2.3 멤버십 + 읽음 상태 + 토큰 버킷. INSERT 정책 없음 — 가입은 RPC 전용.';
comment on column public.group_members.msg_tokens is
  '§6.1 메시지 전송 토큰 버킷. 용량 20, 초당 2 리필. 0006 의 트리거만 갱신한다.';

-- ---------------------------------------------------------------------------
-- 3. member_count 유지 트리거
-- ---------------------------------------------------------------------------
-- 사이드바가 그룹당 count(*) 를 도는 걸 막는다(N+1 회피). left_at 전환도 반영.
create or replace function public.sync_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gid   uuid := coalesce(new.group_id, old.group_id);
  v_delta int  := 0;
begin
  if tg_op = 'INSERT' then
    v_delta := case when new.left_at is null then 1 else 0 end;
  elsif tg_op = 'UPDATE' then
    v_delta := (case when new.left_at is null then 1 else 0 end)
             - (case when old.left_at is null then 1 else 0 end);
  elsif tg_op = 'DELETE' then
    v_delta := case when old.left_at is null then -1 else 0 end;
  end if;

  if v_delta <> 0 then
    update public.study_groups
       set member_count = greatest(0, member_count + v_delta)
     where id = v_gid;
  end if;

  return null;   -- AFTER 트리거
end;
$$;

drop trigger if exists group_members_sync_count on public.group_members;
create trigger group_members_sync_count
  after insert or update of left_at or delete on public.group_members
  for each row execute function public.sync_member_count();

-- ---------------------------------------------------------------------------
-- 4. 컬럼 가드 트리거 — group_members
-- ---------------------------------------------------------------------------
-- 클라이언트가 직접 UPDATE 할 수 있는 건 last_read_seq / muted 뿐이다(6절 GRANT).
-- 트리거는 값 자체를 한 번 더 잠근다: 역할 승격·토큰 리필·재입장 위조 차단.
--
-- ★ RPC 경로 구분 방식: GUC 플래그를 쓰지 않는다. 커스텀 GUC 는 authenticated 가
--   set_config() 로 직접 켤 수 있어서 가드가 무력화된다. 대신 "지금 실행 중인
--   롤이 이 테이블의 소유자인가"로 판별한다 — SECURITY DEFINER RPC 는 함수
--   소유자(postgres)로, 클라이언트 직접 UPDATE 는 authenticated 로 실행된다.
create or replace function public.group_members_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = tg_relid)
     ) then
    return new;   -- SECURITY DEFINER RPC 경로 — RPC 가 자체 인가 검사를 한다
  end if;

  new.group_id  := old.group_id;
  new.user_id   := old.user_id;
  new.role      := old.role;
  new.joined_at := old.joined_at;
  new.left_at   := old.left_at;
  new.msg_tokens := old.msg_tokens;
  new.tokens_at  := old.tokens_at;

  -- 읽음 표시는 뒤로 갈 수 없다(멀티 디바이스에서 되감기 방지)
  new.last_read_seq := greatest(old.last_read_seq, new.last_read_seq);
  return new;
end;
$$;

drop trigger if exists group_members_guard_update_trg on public.group_members;
create trigger group_members_guard_update_trg
  before update on public.group_members
  for each row execute function public.group_members_guard_update();

-- ---------------------------------------------------------------------------
-- 5. RLS — ★ 헬퍼만 호출한다. 재귀 없음(§2.0)
-- ---------------------------------------------------------------------------
alter table public.study_groups  enable row level security;
alter table public.group_members enable row level security;

-- study_groups SELECT — 살아있는 멤버인 그룹만 보인다.
-- ★ group_members 를 서브쿼리로 직접 참조하지 않는다. 그러면 group_members 정책이
--   다시 study_groups 를 보게 되어 42P17 무한 재귀가 난다.
drop policy if exists study_groups_select_member on public.study_groups;
create policy study_groups_select_member on public.study_groups
  for select to authenticated
  using (
    deleted_at is null
    and public.is_group_member(id, (select auth.uid()))
  );

-- study_groups UPDATE — 관리자만. 어떤 컬럼인지는 GRANT + 가드 트리거가 정한다.
drop policy if exists study_groups_update_admin on public.study_groups;
create policy study_groups_update_admin on public.study_groups
  for update to authenticated
  using (deleted_at is null and public.is_group_admin(id, (select auth.uid())))
  with check (deleted_at is null and public.is_group_admin(id, (select auth.uid())));

-- INSERT 정책 없음 — 생성은 create_group() RPC 전용.
-- DELETE 정책 없음 — 하드 삭제 없음(소프트 삭제도 RPC 경유).

-- group_members SELECT — 내가 속한 그룹의 멤버 목록은 볼 수 있다.
-- ★ 여기서도 study_groups 를 참조하지 않는다(반대 방향 재귀 차단).
drop policy if exists group_members_select_same_group on public.group_members;
create policy group_members_select_same_group on public.group_members
  for select to authenticated
  using (public.is_group_member(group_id, (select auth.uid())));

-- group_members UPDATE — 본인 행만. 실제 변경 가능 컬럼은 last_read_seq / muted.
drop policy if exists group_members_update_self on public.group_members;
create policy group_members_update_self on public.group_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ★ INSERT 정책 없음(§2.3). 직접 INSERT 를 허용하면 group_id 만 알면 무단 입장이다.
--   가입은 join_group_with_code() / respond_group_invite() 전용.
-- ★ DELETE 정책 없음. 탈퇴/강퇴는 left_at 소프트 처리.

-- ---------------------------------------------------------------------------
-- 6. 권한
-- ---------------------------------------------------------------------------
revoke all on public.study_groups  from public, anon, authenticated;
revoke all on public.group_members from public, anon, authenticated;

grant select on public.study_groups to authenticated;
grant update (name, color) on public.study_groups to authenticated;   -- 인라인 이름 편집(§5.1)

grant select on public.group_members to authenticated;
grant update (last_read_seq, muted) on public.group_members to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC
-- ---------------------------------------------------------------------------

-- create_group(name, color) — 그룹 + 오너 멤버십 + 초대코드를 한 트랜잭션에.
-- §5.1 "1 스텝": 다이얼로그 없이 과목명/과목색을 그대로 받아 즉시 만든다.
-- 한도 10/일.
create or replace function public.create_group(p_name text, p_color text default 'moon')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_gid  uuid;
  v_code jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'invalid_group_name' using errcode = 'P0001';
  end if;
  if p_color is null or char_length(p_color) > 24 then
    raise exception 'invalid_group_color' using errcode = 'P0001';
  end if;

  perform public.check_rate('create_group', 10, interval '1 day');

  -- member_count 는 0 으로 넣는다. 아래 멤버십 INSERT 가 트리거로 1 을 만든다.
  insert into public.study_groups (name, color, owner_id, member_count)
  values (v_name, p_color, v_uid, 0)
  returning id into v_gid;
  insert into public.group_members (group_id, user_id, role)
  values (v_gid, v_uid, 'owner');

  -- 0004 의 함수. 초대 코드를 즉시 발급해 클립보드로 넘긴다(§5.1).
  v_code := public.mint_invite_code(v_gid, 0, interval '7 days');

  return jsonb_build_object(
    'id',          v_gid,
    'name',        v_name,
    'color',       p_color,
    'ownerId',     v_uid,
    'memberCount', 1,
    'lastMsgSeq',  0,
    'invite',      v_code
  );
end;
$$;

comment on function public.create_group(text, text) is
  '§2.10 그룹+오너멤버십+초대코드를 한 트랜잭션에. 10/일.';

-- leave_group(group_id) — 소프트 탈퇴. 오너는 다른 관리자에게 넘기고 나가야 한다.
create or replace function public.leave_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_next uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select m.role into v_role
    from public.group_members m
   where m.group_id = p_group_id and m.user_id = v_uid and m.left_at is null;
  if not found then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  if v_role = 'owner' then
    -- 오너 승계: admin 우선, 없으면 가장 오래된 member.
    select m.user_id into v_next
      from public.group_members m
     where m.group_id = p_group_id and m.user_id <> v_uid and m.left_at is null
     order by (m.role = 'admin') desc, m.joined_at asc
     limit 1;

    if v_next is null then
      -- 마지막 한 명이 나가면 그룹은 소프트 삭제된다.
      update public.study_groups set deleted_at = now() where id = p_group_id;
    else
      update public.group_members set role = 'owner'
       where group_id = p_group_id and user_id = v_next;
      update public.study_groups set owner_id = v_next where id = p_group_id;
    end if;
  end if;

  update public.group_members
     set left_at = now(), role = 'member'
   where group_id = p_group_id and user_id = v_uid;

  perform public.post_system_message(p_group_id, v_uid, 'left');
  return jsonb_build_object('ok', true, 'ownerTransferredTo', v_next);
end;
$$;

-- kick_member(group_id, user_id) — 관리자만. 오너는 강퇴 불가.
create or replace function public.kick_member(p_group_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_group_admin(p_group_id, v_uid) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_kick_self' using errcode = 'P0001';
  end if;

  select m.role into v_role
    from public.group_members m
   where m.group_id = p_group_id and m.user_id = p_user_id and m.left_at is null;
  if not found then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;
  if v_role = 'owner' then
    raise exception 'cannot_kick_owner' using errcode = 'P0001';
  end if;
  -- admin 을 자를 수 있는 건 owner 뿐이다.
  if v_role = 'admin' and not public.is_group_owner(p_group_id, v_uid) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  update public.group_members
     set left_at = now()
   where group_id = p_group_id and user_id = p_user_id;

  perform public.post_system_message(p_group_id, p_user_id, 'kicked');
  return jsonb_build_object('ok', true);
end;
$$;

-- set_member_role(group_id, user_id, role) — 오너만. owner 지정은 위임이다.
create or replace function public.set_member_role(
  p_group_id uuid,
  p_user_id  uuid,
  p_role     text
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
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'invalid_role' using errcode = 'P0001';
  end if;
  if not public.is_group_owner(p_group_id, v_uid) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if not public.is_group_member(p_group_id, p_user_id) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  if p_role = 'owner' then
    -- 위임: 기존 오너는 admin 으로 내려간다. 오너는 항상 정확히 한 명.
    update public.group_members set role = 'admin'
     where group_id = p_group_id and user_id = v_uid;
    update public.group_members set role = 'owner'
     where group_id = p_group_id and user_id = p_user_id;
    update public.study_groups set owner_id = p_user_id where id = p_group_id;
  else
    if p_user_id = v_uid then
      raise exception 'cannot_demote_self' using errcode = 'P0001';
    end if;
    update public.group_members set role = p_role
     where group_id = p_group_id and user_id = p_user_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- mark_read(group_id, seq) — last_read_seq = greatest(...). 되감기 없음.
-- (RLS UPDATE 로도 가능하지만, 왕복 1회 + 되감기 방지를 서버에서 보장하려고 RPC 도 둔다)
create or replace function public.mark_read(p_group_id uuid, p_seq bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_seq bigint;
  v_max bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if not public.is_group_member(p_group_id, v_uid) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;

  -- ★ 그룹의 현재 last_msg_seq 를 넘겨서 읽음 표시를 할 수는 없다.
  --   넘길 수 있으면 이후 도착할 메시지가 영구히 "읽음"으로 묻힌다.
  select g.last_msg_seq into v_max from public.study_groups g where g.id = p_group_id;

  update public.group_members
     set last_read_seq = greatest(last_read_seq,
                                  least(coalesce(p_seq, 0), coalesce(v_max, 0)))
   where group_id = p_group_id and user_id = v_uid
   returning last_read_seq into v_seq;

  return jsonb_build_object('groupId', p_group_id, 'lastReadSeq', v_seq);
end;
$$;

-- unread_counts() — 사이드바 배지를 왕복 1회로(§2.10).
-- messages 를 스캔하지 않는다: last_msg_seq - last_read_seq 산술 하나면 끝난다.
create or replace function public.unread_counts()
returns table (
  group_id     uuid,
  unread       bigint,
  last_msg_seq bigint,
  last_msg_at  timestamptz,
  muted        boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select g.id,
         greatest(0, g.last_msg_seq - m.last_read_seq) as unread,
         g.last_msg_seq,
         g.last_msg_at,
         m.muted
    from public.group_members m
    join public.study_groups g on g.id = m.group_id
   where m.user_id = auth.uid()
     and m.left_at is null
     and g.deleted_at is null;
$$;

comment on function public.unread_counts() is
  '§2.10 사이드바 배지용. messages 스캔 없이 last_msg_seq - last_read_seq 로 계산.';

-- ---------------------------------------------------------------------------
-- 8. RPC 권한
-- ---------------------------------------------------------------------------
revoke execute on function public.sync_member_count()                     from public, anon, authenticated;
revoke execute on function public.group_members_guard_update()            from public, anon, authenticated;

revoke execute on function public.create_group(text, text)                from public, anon;
revoke execute on function public.leave_group(uuid)                       from public, anon;
revoke execute on function public.kick_member(uuid, uuid)                 from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, text)       from public, anon;
revoke execute on function public.mark_read(uuid, bigint)                 from public, anon;
revoke execute on function public.unread_counts()                         from public, anon;

grant execute on function public.create_group(text, text)                 to authenticated;
grant execute on function public.leave_group(uuid)                        to authenticated;
grant execute on function public.kick_member(uuid, uuid)                  to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text)        to authenticated;
grant execute on function public.mark_read(uuid, bigint)                  to authenticated;
grant execute on function public.unread_counts()                          to authenticated;

reset check_function_bodies;
