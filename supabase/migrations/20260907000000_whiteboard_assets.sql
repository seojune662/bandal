-- Private, group-scoped images for shared whiteboards.
-- Bytes stay out of realtime JSON; shapes carry only the UUID reference.

alter table public.whiteboard_shapes
  drop constraint if exists whiteboard_shapes_kind_check;
alter table public.whiteboard_shapes
  add constraint whiteboard_shapes_kind_check
  check (kind in (
    'ink', 'highlighter', 'rect', 'ellipse', 'arrow', 'line', 'textbox', 'image'
  ));

create table if not exists public.whiteboard_assets (
  id           uuid primary key,
  board_id     uuid not null references public.whiteboards(id) on delete cascade,
  group_id     uuid not null references public.study_groups(id) on delete cascade,
  author_id    uuid not null default auth.uid() references auth.users(id),
  storage_path text not null unique,
  label        text not null check (length(label) between 1 and 240),
  mime_type    text not null check (mime_type = 'image/webp'),
  width_px     integer not null check (width_px between 1 and 4096),
  height_px    integer not null check (height_px between 1 and 4096),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists whiteboard_assets_board_idx
  on public.whiteboard_assets(board_id, created_at);

drop trigger if exists whiteboard_assets_set_updated_at on public.whiteboard_assets;
create trigger whiteboard_assets_set_updated_at
  before update on public.whiteboard_assets
  for each row execute function public.set_updated_at();

alter table public.whiteboard_assets enable row level security;
revoke all on public.whiteboard_assets from public, anon, authenticated;
grant select on public.whiteboard_assets to authenticated;
grant insert (id, board_id, group_id, author_id, storage_path, label, mime_type, width_px, height_px)
  on public.whiteboard_assets to authenticated;
grant update (label, mime_type, width_px, height_px, storage_path)
  on public.whiteboard_assets to authenticated;

drop policy if exists whiteboard_assets_select_member on public.whiteboard_assets;
create policy whiteboard_assets_select_member on public.whiteboard_assets
  for select to authenticated using (
    public.is_group_member(group_id, (select auth.uid()))
  );

drop policy if exists whiteboard_assets_insert_member on public.whiteboard_assets;
create policy whiteboard_assets_insert_member on public.whiteboard_assets
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and public.is_group_member(group_id, (select auth.uid()))
    and exists (
      select 1 from public.whiteboards w
       where w.id = board_id and w.group_id = group_id and w.deleted_at is null
    )
  );

drop policy if exists whiteboard_assets_update_author on public.whiteboard_assets;
create policy whiteboard_assets_update_author on public.whiteboard_assets
  for update to authenticated
  using (
    author_id = (select auth.uid())
    and public.is_group_member(group_id, (select auth.uid()))
  )
  with check (
    author_id = (select auth.uid())
    and public.is_group_member(group_id, (select auth.uid()))
  );

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('whiteboard-assets', 'whiteboard-assets', false, 8388608, array['image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object paths are group/board/asset.webp. Both ids must agree with a live
-- board, preventing a member from writing into a different group's prefix.
drop policy if exists whiteboard_asset_objects_select on storage.objects;
create policy whiteboard_asset_objects_select on storage.objects
  for select to authenticated using (
    bucket_id = 'whiteboard-assets'
    and exists (
      select 1 from public.whiteboards w
       where w.group_id::text = (storage.foldername(name))[1]
         and w.id::text = (storage.foldername(name))[2]
         and w.deleted_at is null
         and public.is_group_member(w.group_id, (select auth.uid()))
    )
  );

drop policy if exists whiteboard_asset_objects_insert on storage.objects;
create policy whiteboard_asset_objects_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'whiteboard-assets'
    and exists (
      select 1 from public.whiteboards w
       where w.group_id::text = (storage.foldername(name))[1]
         and w.id::text = (storage.foldername(name))[2]
         and w.deleted_at is null
         and public.is_group_member(w.group_id, (select auth.uid()))
    )
  );

drop policy if exists whiteboard_asset_objects_update on storage.objects;
create policy whiteboard_asset_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'whiteboard-assets'
    and owner_id = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'whiteboard-assets'
    and owner_id = (select auth.uid()::text)
  );
