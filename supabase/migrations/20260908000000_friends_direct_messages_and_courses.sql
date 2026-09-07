-- Friends hub: direct conversations and explicitly published course names.

alter table public.study_groups
  add column if not exists kind text not null default 'study';
alter table public.study_groups
  add column if not exists direct_key text;

do $$ begin
  alter table public.study_groups
    add constraint study_groups_kind_check check (kind in ('study', 'direct'));
exception when duplicate_object then null;
end $$;

create unique index if not exists study_groups_direct_key_live
  on public.study_groups (direct_key)
  where kind = 'direct' and deleted_at is null;

create table if not exists public.published_courses (
  id           uuid primary key,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists published_courses_set_updated_at on public.published_courses;
create trigger published_courses_set_updated_at
  before update on public.published_courses
  for each row execute function public.set_updated_at();

alter table public.published_courses enable row level security;
drop policy if exists published_courses_select_friend on public.published_courses;
create policy published_courses_select_friend on public.published_courses
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_friend(owner_id, (select auth.uid())));
drop policy if exists published_courses_insert_owner on public.published_courses;
create policy published_courses_insert_owner on public.published_courses
  for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists published_courses_update_owner on public.published_courses;
create policy published_courses_update_owner on public.published_courses
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
drop policy if exists published_courses_delete_owner on public.published_courses;
create policy published_courses_delete_owner on public.published_courses
  for delete to authenticated using (owner_id = (select auth.uid()));

revoke all on public.published_courses from public, anon;
grant select, insert, update, delete on public.published_courses to authenticated;

create or replace function public.ensure_direct_chat(p_peer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_group uuid;
  v_peer public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  if p_peer_id = v_uid then raise exception 'invalid_peer' using errcode = 'P0001'; end if;
  if not public.is_friend(v_uid, p_peer_id) then
    raise exception 'not_friends' using errcode = 'P0001';
  end if;
  if public.is_blocked_either_way(v_uid, p_peer_id) then
    raise exception 'blocked' using errcode = 'P0001';
  end if;

  v_key := least(v_uid::text, p_peer_id::text) || ':' || greatest(v_uid::text, p_peer_id::text);
  select id into v_group from public.study_groups
   where direct_key = v_key and kind = 'direct' and deleted_at is null;

  if v_group is null then
    insert into public.study_groups
      (name, color, owner_id, member_count, kind, direct_key)
      values ('Direct message', 'moon', v_uid, 0, 'direct', v_key)
      on conflict do nothing
      returning id into v_group;
    if v_group is null then
      select id into v_group from public.study_groups
       where direct_key = v_key and kind = 'direct' and deleted_at is null;
    end if;
  end if;

  insert into public.group_members (group_id, user_id, role)
    values (v_group, v_uid, 'owner')
    on conflict (group_id, user_id) do update set left_at = null;
  insert into public.group_members (group_id, user_id, role)
    values (v_group, p_peer_id, 'member')
    on conflict (group_id, user_id) do update set left_at = null;

  select * into v_peer from public.profiles where id = p_peer_id;
  return jsonb_build_object(
    'groupId', v_group,
    'peer', jsonb_build_object(
      'userId', v_peer.id,
      'nickname', v_peer.nickname,
      'avatarColor', v_peer.avatar_color,
      'avatarEmoji', v_peer.avatar_emoji,
      'status', 'accepted',
      'direction', 'outgoing'
    )
  );
end;
$$;

revoke execute on function public.ensure_direct_chat(uuid) from public, anon;
grant execute on function public.ensure_direct_chat(uuid) to authenticated;

-- A direct thread may only ever contain the two UUIDs encoded in direct_key.
-- This protects the 1:1 invariant even if a stale client calls a generic
-- group join/invite RPC with a direct group id.
create or replace function public.direct_group_member_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_key text;
begin
  select kind, direct_key into v_kind, v_key
    from public.study_groups where id = new.group_id;
  if v_kind = 'direct'
     and new.user_id::text <> split_part(v_key, ':', 1)
     and new.user_id::text <> split_part(v_key, ':', 2) then
    raise exception 'direct_chat_members_locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_direct_pair_guard on public.group_members;
create trigger group_members_direct_pair_guard
  before insert or update of user_id on public.group_members
  for each row execute function public.direct_group_member_guard();

create or replace function public.direct_group_invite_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.study_groups
     where id = new.group_id and kind = 'direct'
  ) then
    raise exception 'direct_chat_invites_disabled' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists group_invites_direct_guard on public.group_invites;
create trigger group_invites_direct_guard
  before insert on public.group_invites
  for each row execute function public.direct_group_invite_guard();

drop trigger if exists invite_codes_direct_guard on public.invite_codes;
create trigger invite_codes_direct_guard
  before insert on public.invite_codes
  for each row execute function public.direct_group_invite_guard();

revoke execute on function public.direct_group_member_guard() from public, anon, authenticated;
revoke execute on function public.direct_group_invite_guard() from public, anon, authenticated;

create or replace function public.direct_message_friend_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_peer uuid;
begin
  if new.kind <> 'text' or auth.uid() is null then return new; end if;
  select kind into v_kind from public.study_groups where id = new.group_id;
  if v_kind <> 'direct' then return new; end if;
  select user_id into v_peer from public.group_members
   where group_id = new.group_id and user_id <> auth.uid() and left_at is null limit 1;
  if v_peer is null or not public.is_friend(auth.uid(), v_peer)
     or public.is_blocked_either_way(auth.uid(), v_peer) then
    raise exception 'not_friends' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_direct_friend_guard on public.messages;
create trigger messages_direct_friend_guard
  before insert on public.messages
  for each row execute function public.direct_message_friend_guard();
