-- ============================================================================
-- [C9] Bandal Phase 2 — 20260806000011_whiteboards.sql
--
-- 만드는 것:
--   * public.whiteboards                    — 그룹당 활성 보드 1개
--   * public.whiteboard_shapes              — 완성 도형 1행, 클라이언트 생성 PK
--   * group_members 화이트보드 토큰 버킷   — 용량 200 / 초당 20 리필
--   * 도형 INSERT / 소프트삭제 Broadcast   — wb_shape / wb_remove
--   * public.prune_whiteboard_shapes()       — 소프트삭제 30일 후 물리 삭제
--   * public.run_retention() 확장            — 기존 0009 진입점에 도형 정리 등록
--
-- 의존: 0001(is_group_member/is_group_owner/set_updated_at), 0003(group_members),
--       0008(realtime.send + private group topic), 0009(run_retention)
--
-- ★ 도형 id 는 클라이언트가 만든다. 같은 id 재전송은 PK unique_violation 이므로
--   중복 도형이 생기지 않는다.
-- ★ Broadcast 는 허용된 도형의 data/style 전체를 보낸다. 직렬화 크기를 각각
--   64 KiB / 8 KiB 로 제한해 단일 이벤트가 비정상적으로 커지지 않게 한다.
-- ============================================================================

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.whiteboards (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.study_groups(id) on delete cascade,
  title       text not null,
  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- 소프트삭제된 보드는 같은 그룹의 새 활성 보드를 막지 않는다.
create unique index if not exists whiteboards_group_live_uq
  on public.whiteboards (group_id) where deleted_at is null;

comment on table public.whiteboards is
  '그룹 공유 화이트보드. 그룹당 deleted_at is null 인 보드는 최대 1개.';

drop trigger if exists whiteboards_set_updated_at on public.whiteboards;
create trigger whiteboards_set_updated_at
  before update on public.whiteboards
  for each row execute function public.set_updated_at();

create table if not exists public.whiteboard_shapes (
  id          uuid primary key,
  board_id    uuid not null references public.whiteboards(id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users(id),
  kind        text not null
                check (kind in ('ink','highlighter','rect','ellipse','arrow','line','textbox')),
  data_json   jsonb not null,
  style_json  jsonb not null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint whiteboard_shapes_data_size
    check (pg_catalog.octet_length(data_json::text) <= 65536),
  constraint whiteboard_shapes_style_size
    check (pg_catalog.octet_length(style_json::text) <= 8192)
);

create index if not exists whiteboard_shapes_board_created_idx
  on public.whiteboard_shapes (board_id, created_at, id)
  where deleted_at is null;

create index if not exists whiteboard_shapes_deleted_idx
  on public.whiteboard_shapes (deleted_at)
  where deleted_at is not null;

comment on table public.whiteboard_shapes is
  '완성 도형 1행. id 는 클라이언트 생성이며 data/style 은 Broadcast 가능한 크기로 제한한다.';
comment on column public.whiteboard_shapes.data_json is
  '도형 데이터. UTF-8 JSON 직렬화 기준 최대 64 KiB.';
comment on column public.whiteboard_shapes.style_json is
  '도형 스타일. UTF-8 JSON 직렬화 기준 최대 8 KiB.';

-- ---------------------------------------------------------------------------
-- 2. 화이트보드 전용 토큰 버킷 — 용량 200 / 초당 20
-- ---------------------------------------------------------------------------
-- 메시지 버킷(20 / 초당 2)과 분리한다. 획을 놓는 순간 완성 도형이 몰려도 10초치
-- 버스트를 흡수하고, 장기 지속 전송은 사용자·그룹당 초당 20개로 제한한다.
alter table public.group_members
  add column if not exists wb_tokens real not null default 200,
  add column if not exists wb_tokens_at timestamptz not null default now();

comment on column public.group_members.wb_tokens is
  '화이트보드 도형 INSERT 토큰 버킷. 용량 200, 초당 20 리필.';
comment on column public.group_members.wb_tokens_at is
  '화이트보드 토큰 버킷을 마지막으로 계산한 시각.';

-- 0003 가드는 클라이언트가 직접 바꿀 수 없는 새 버킷 컬럼도 되돌려야 한다.
create or replace function public.group_members_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = tg_relid)
     ) then
    return new;
  end if;

  new.group_id    := old.group_id;
  new.user_id     := old.user_id;
  new.role        := old.role;
  new.joined_at   := old.joined_at;
  new.left_at     := old.left_at;
  new.msg_tokens  := old.msg_tokens;
  new.tokens_at   := old.tokens_at;
  new.wb_tokens   := old.wb_tokens;
  new.wb_tokens_at := old.wb_tokens_at;

  new.last_read_seq := greatest(old.last_read_seq, new.last_read_seq);
  return new;
end;
$$;

-- board_id → group_id 를 먼저 해석한 뒤 group_members 한 행을 잠근다.
-- 거절된 INSERT 는 문장 전체가 롤백되므로 버킷 상태도 정확히 원상복구된다.
create or replace function public.whiteboard_shapes_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_gid    uuid;
  v_tokens real;
begin
  new.created_at := coalesce(new.created_at, now());
  new.deleted_at := null;

  select w.group_id
    into v_gid
    from public.whiteboards w
   where w.id = new.board_id
     and w.deleted_at is null;

  if v_gid is null then
    raise exception 'whiteboard_not_found' using errcode = 'P0001';
  end if;

  if v_uid is not null then
    select least(
             200::real,
             m.wb_tokens
               + (extract(epoch from (now() - m.wb_tokens_at)) * 20)::real
           )
      into v_tokens
      from public.group_members m
     where m.group_id = v_gid
       and m.user_id  = v_uid
       and m.left_at is null
     for update;

    if v_tokens is null then
      raise exception 'not_a_member' using errcode = 'P0001';
    end if;

    if v_tokens < 1 then
      raise exception 'rate_limited'
        using errcode = 'P0001', detail = 'whiteboard_shape_insert', hint = '1';
    end if;

    update public.group_members
       set wb_tokens    = v_tokens - 1,
           wb_tokens_at = now()
     where group_id = v_gid
       and user_id  = v_uid;
  end if;

  return new;
end;
$$;

comment on function public.whiteboard_shapes_before_insert() is
  '화이트보드 도형 토큰 버킷. 사용자·그룹당 용량 200 / 초당 20, 초과 시 P0001 rate_limited.';

drop trigger if exists whiteboard_shapes_before_insert_trg on public.whiteboard_shapes;
create trigger whiteboard_shapes_before_insert_trg
  before insert on public.whiteboard_shapes
  for each row execute function public.whiteboard_shapes_before_insert();

-- ---------------------------------------------------------------------------
-- 3. UPDATE 가드 — 직접 UPDATE 는 deleted_at 단방향 전환만
-- ---------------------------------------------------------------------------
create or replace function public.whiteboard_shapes_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 보존/관리 작업처럼 테이블 소유자로 실행되는 경로는 통과시킨다.
  if current_user = pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = tg_relid)
     ) then
    return new;
  end if;

  new.id         := old.id;
  new.board_id   := old.board_id;
  new.author_id  := old.author_id;
  new.kind       := old.kind;
  new.data_json  := old.data_json;
  new.style_json := old.style_json;
  new.created_at := old.created_at;

  if old.deleted_at is not null then
    raise exception 'whiteboard_shape_already_deleted' using errcode = 'P0001';
  end if;

  if new.deleted_at is null then
    raise exception 'whiteboard_shape_soft_delete_only' using errcode = 'P0001';
  end if;

  new.deleted_at := now();
  return new;
end;
$$;

drop trigger if exists whiteboard_shapes_before_update_trg on public.whiteboard_shapes;
create trigger whiteboard_shapes_before_update_trg
  before update on public.whiteboard_shapes
  for each row execute function public.whiteboard_shapes_before_update();

-- ---------------------------------------------------------------------------
-- 4. RLS — 그룹 스코프 판정은 is_group_member/is_group_owner 헬퍼만 쓴다
-- ---------------------------------------------------------------------------
alter table public.whiteboards       enable row level security;
alter table public.whiteboard_shapes enable row level security;

drop policy if exists whiteboards_select_member on public.whiteboards;
create policy whiteboards_select_member on public.whiteboards
  for select to authenticated
  using (
    deleted_at is null
    and public.is_group_member(group_id, (select auth.uid()))
  );

drop policy if exists whiteboards_insert_member on public.whiteboards;
create policy whiteboards_insert_member on public.whiteboards
  for insert to authenticated
  with check (
    deleted_at is null
    and created_by = (select auth.uid())
    and public.is_group_member(group_id, (select auth.uid()))
  );

drop policy if exists whiteboard_shapes_select_member on public.whiteboard_shapes;
create policy whiteboard_shapes_select_member on public.whiteboard_shapes
  for select to authenticated
  using (
    deleted_at is null
    and public.is_group_member(
      (select w.group_id
         from public.whiteboards w
        where w.id = whiteboard_shapes.board_id),
      (select auth.uid())
    )
  );

drop policy if exists whiteboard_shapes_insert_member on public.whiteboard_shapes;
create policy whiteboard_shapes_insert_member on public.whiteboard_shapes
  for insert to authenticated
  with check (
    deleted_at is null
    and author_id = (select auth.uid())
    and public.is_group_member(
      (select w.group_id
         from public.whiteboards w
        where w.id = whiteboard_shapes.board_id),
      (select auth.uid())
    )
  );

-- 작성자 또는 그룹 owner 만 활성 도형을 소프트삭제할 수 있다. 실제 변경 가능
-- 컬럼은 아래 GRANT 와 before_update 트리거가 deleted_at 하나로 더 좁힌다.
drop policy if exists whiteboard_shapes_soft_delete_author_or_owner on public.whiteboard_shapes;
create policy whiteboard_shapes_soft_delete_author_or_owner on public.whiteboard_shapes
  for update to authenticated
  using (
    deleted_at is null
    and public.is_group_member(
      (select w.group_id
         from public.whiteboards w
        where w.id = whiteboard_shapes.board_id),
      (select auth.uid())
    )
    and (
      author_id = (select auth.uid())
      or public.is_group_owner(
           (select w.group_id
              from public.whiteboards w
             where w.id = whiteboard_shapes.board_id),
           (select auth.uid())
         )
    )
  )
  with check (
    deleted_at is not null
    and public.is_group_member(
      (select w.group_id
         from public.whiteboards w
        where w.id = whiteboard_shapes.board_id),
      (select auth.uid())
    )
    and (
      author_id = (select auth.uid())
      or public.is_group_owner(
           (select w.group_id
              from public.whiteboards w
             where w.id = whiteboard_shapes.board_id),
           (select auth.uid())
         )
    )
  );

-- DELETE 정책은 의도적으로 없다. 물리 삭제는 보존 함수만 한다.
revoke all on public.whiteboards       from public, anon, authenticated;
revoke all on public.whiteboard_shapes from public, anon, authenticated;

grant select on public.whiteboards to authenticated;
grant insert (id, group_id, title) on public.whiteboards to authenticated;

grant select on public.whiteboard_shapes to authenticated;
grant insert (id, board_id, kind, data_json, style_json)
  on public.whiteboard_shapes to authenticated;
grant update (deleted_at) on public.whiteboard_shapes to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Broadcast from Database
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_whiteboard_shape_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gid uuid;
begin
  select w.group_id into v_gid
    from public.whiteboards w
   where w.id = new.board_id;

  if v_gid is null then
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'id',         new.id,
      'boardId',    new.board_id,
      'groupId',    v_gid,
      'authorId',   new.author_id,
      'kind',       new.kind,
      'dataJson',   new.data_json,
      'styleJson',  new.style_json,
      'createdAt',  new.created_at,
      'deletedAt',  new.deleted_at
    ),
    'wb_shape',
    'group:' || v_gid::text,
    true
  );
  return null;
end;
$$;

drop trigger if exists whiteboard_shapes_broadcast_insert on public.whiteboard_shapes;
create trigger whiteboard_shapes_broadcast_insert
  after insert on public.whiteboard_shapes
  for each row execute function public.broadcast_whiteboard_shape_insert();

create or replace function public.broadcast_whiteboard_shape_remove()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gid uuid;
begin
  if old.deleted_at is not null or new.deleted_at is null then
    return null;
  end if;

  select w.group_id into v_gid
    from public.whiteboards w
   where w.id = new.board_id;

  if v_gid is null then
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'id',        new.id,
      'boardId',   new.board_id,
      'groupId',   v_gid,
      'authorId',  new.author_id,
      'deletedAt', new.deleted_at
    ),
    'wb_remove',
    'group:' || v_gid::text,
    true
  );
  return null;
end;
$$;

drop trigger if exists whiteboard_shapes_broadcast_remove on public.whiteboard_shapes;
create trigger whiteboard_shapes_broadcast_remove
  after update of deleted_at on public.whiteboard_shapes
  for each row execute function public.broadcast_whiteboard_shape_remove();

-- ---------------------------------------------------------------------------
-- 6. 보존 정책 — 소프트삭제 30일 후 배치 물리 삭제
-- ---------------------------------------------------------------------------
create or replace function public.prune_whiteboard_shapes(
  p_max_age interval default interval '30 days',
  p_batch   int      default 20000
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  with doomed as (
    select s.id
      from public.whiteboard_shapes s
     where s.deleted_at < now() - p_max_age
     order by s.deleted_at
     limit greatest(coalesce(p_batch, 20000), 1)
  )
  delete from public.whiteboard_shapes s
   using doomed d
   where s.id = d.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_whiteboard_shapes(interval, int) is
  '소프트삭제된 화이트보드 도형을 30일 뒤 물리 삭제한다. 기본 배치 상한 20,000행.';

-- 0009 의 진입점을 새 도형 정리까지 포함하도록 교체한다. 기존 반환 키는 유지한다.
create or replace function public.run_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msgs   int;
  v_shapes int;
  v_rates  int;
  v_revoke int;
  v_codes  int;
begin
  v_msgs   := public.prune_messages();
  v_shapes := public.prune_whiteboard_shapes();
  v_rates  := public.prune_rate_events();
  v_revoke := public.revoke_expired_invite_codes();
  v_codes  := public.prune_invite_codes();

  return jsonb_build_object(
    'messagesDeleted',         v_msgs,
    'whiteboardShapesDeleted', v_shapes,
    'rateEventsDeleted',       v_rates,
    'codesRevoked',            v_revoke,
    'codesDeleted',            v_codes,
    'ranAt',                   now()
  );
end;
$$;

comment on function public.run_retention() is
  '보존 정책 일괄 실행. 메시지/레이트 이벤트/초대 코드와 소프트삭제 30일 지난 화이트보드 도형을 정리한다.';

-- ---------------------------------------------------------------------------
-- 7. 함수 권한
-- ---------------------------------------------------------------------------
revoke execute on function public.group_members_guard_update()                  from public, anon, authenticated;
revoke execute on function public.whiteboard_shapes_before_insert()             from public, anon, authenticated;
revoke execute on function public.whiteboard_shapes_before_update()             from public, anon, authenticated;
revoke execute on function public.broadcast_whiteboard_shape_insert()           from public, anon, authenticated;
revoke execute on function public.broadcast_whiteboard_shape_remove()           from public, anon, authenticated;
revoke execute on function public.prune_whiteboard_shapes(interval, int)         from public, anon, authenticated;
revoke execute on function public.run_retention()                               from public, anon, authenticated;

reset check_function_bodies;
