-- ============================================================================
-- Shared whiteboard in-place edits. Authors may change only their own shape
-- data/style; identity, ownership, board, kind, and z-order timestamp stay fixed.
-- ============================================================================

set check_function_bodies = off;

alter table public.whiteboard_shapes
  add column if not exists updated_at timestamptz;

update public.whiteboard_shapes
   set updated_at = created_at
 where updated_at is null;

alter table public.whiteboard_shapes
  alter column updated_at set default now(),
  alter column updated_at set not null;

-- Preserve the existing soft-delete path while admitting data/style edits.
-- An update that also deletes is treated strictly as a delete: content changes
-- in the same statement are discarded.
create or replace function public.whiteboard_shapes_before_update()
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

  new.id         := old.id;
  new.board_id   := old.board_id;
  new.author_id  := old.author_id;
  new.kind       := old.kind;
  new.created_at := old.created_at;

  if old.deleted_at is not null then
    raise exception 'whiteboard_shape_already_deleted' using errcode = 'P0001';
  end if;

  if new.deleted_at is not null then
    new.data_json  := old.data_json;
    new.style_json := old.style_json;
    new.deleted_at := now();
  else
    new.deleted_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- This policy is deliberately author-only. The existing author-or-owner
-- policy remains responsible solely for soft deletion.
drop policy if exists whiteboard_shapes_update_author on public.whiteboard_shapes;
create policy whiteboard_shapes_update_author on public.whiteboard_shapes
  for update to authenticated
  using (
    deleted_at is null
    and author_id = (select auth.uid())
    and public.is_group_member(
      (select w.group_id
         from public.whiteboards w
        where w.id = whiteboard_shapes.board_id),
      (select auth.uid())
    )
  )
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

grant update (data_json, style_json)
  on public.whiteboard_shapes to authenticated;

-- Reuse wb_shape for both inserts and edits: consumers already merge the full
-- shape payload by stable id, so a second event kind would add no information.
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
      'updatedAt',  new.updated_at,
      'deletedAt',  new.deleted_at
    ),
    'wb_shape',
    'group:' || v_gid::text,
    true
  );
  return null;
end;
$$;

drop trigger if exists whiteboard_shapes_broadcast_update
  on public.whiteboard_shapes;
create trigger whiteboard_shapes_broadcast_update
  after update of data_json, style_json on public.whiteboard_shapes
  for each row
  when (new.deleted_at is null)
  execute function public.broadcast_whiteboard_shape_insert();

revoke execute on function public.whiteboard_shapes_before_update()
  from public, anon, authenticated;
revoke execute on function public.broadcast_whiteboard_shape_insert()
  from public, anon, authenticated;

reset check_function_bodies;
